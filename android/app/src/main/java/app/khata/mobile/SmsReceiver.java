package app.khata.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Registered in AndroidManifest.xml for android.provider.Telephony.SMS_RECEIVED
 * with android:permission="android.permission.BROADCAST_SMS", so only the OS's
 * own telephony stack can trigger it — no other app can forge this broadcast.
 *
 * Does nothing unless SmsPrefs.isEnabled() (the user turned this on from
 * Settings) and the message clears a cheap on-device filter first. Neither
 * check exists to be clever — they exist so a message that is obviously not a
 * transaction alert (an OTP, a friend's text) never leaves the phone at all.
 */
public class SmsReceiver extends BroadcastReceiver {
  private static final String TAG = "SmsReceiver";

  // Indian bank/DLT sender IDs are 6-character alphanumeric codes like
  // "VM-HDFCBK", "AD-ICICIB", "JD-SBIINB", or a short numeric shortcode.
  private static final Pattern SENDER_LOOKS_LIKE_BANK =
      Pattern.compile("^[A-Z]{2}-[A-Z0-9]{5,7}$|^[A-Z0-9]{6}$|^\\d{5,6}$");

  private static final String[] TXN_KEYWORDS = {
      "debited", "credited", "withdrawn", "spent", "paid", "purchase",
      "avl bal", "a/c", "acct", "card ending", "upi", "inr", "rs.", "rs ",
  };

  @Override
  public void onReceive(Context context, Intent intent) {
    if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
    if (!SmsPrefs.isEnabled(context)) return;

    SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
    if (messages == null || messages.length == 0) return;

    // A multi-part SMS arrives as several PDUs from the same sender; Android
    // hands them over as separate SmsMessage objects with the body already
    // split, so join them back into the one message they were sent as.
    String sender = messages[0].getOriginatingAddress();
    StringBuilder body = new StringBuilder();
    for (SmsMessage m : messages) {
      if (m.getMessageBody() != null) body.append(m.getMessageBody());
    }
    String text = body.toString();
    if (!looksLikeBankAlert(sender, text)) return;

    PendingResult pending = goAsync();
    Data input = new Data.Builder()
        .putString(SmsForwardWorker.KEY_SENDER, sender == null ? "" : sender)
        .putString(SmsForwardWorker.KEY_BODY, text)
        .putLong(SmsForwardWorker.KEY_RECEIVED_AT, System.currentTimeMillis())
        .build();
    OneTimeWorkRequest work = new OneTimeWorkRequest.Builder(SmsForwardWorker.class)
        .setInputData(input)
        .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .build();
    // Enqueueing is what WorkManager persists to disk — once this call
    // returns, the OS killing this process a moment later (which it will;
    // broadcast receivers get only a few seconds) can no longer lose the work.
    WorkManager.getInstance(context).enqueue(work);
    Log.d(TAG, "queued a bank alert for forwarding");
    pending.finish();
  }

  private static boolean looksLikeBankAlert(String sender, String text) {
    if (text == null || text.isEmpty()) return false;
    boolean senderMatches = sender != null && SENDER_LOOKS_LIKE_BANK.matcher(sender.toUpperCase(Locale.ROOT)).find();
    String lower = text.toLowerCase(Locale.ROOT);
    boolean hasKeyword = false;
    for (String kw : TXN_KEYWORDS) {
      if (lower.contains(kw)) { hasKeyword = true; break; }
    }
    return senderMatches || hasKeyword;
  }
}
