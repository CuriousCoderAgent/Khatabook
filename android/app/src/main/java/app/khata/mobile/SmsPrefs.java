package app.khata.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import java.io.IOException;
import java.security.GeneralSecurityException;

/**
 * Where the device's bearer token lives between app launches. The SMS
 * listener (SmsReceiver -> SmsForwardWorker) reads this with no WebView and
 * no login cookie around, so the token has to survive here instead —
 * Android-Keystore-backed, not the httpOnly cookie every other request uses.
 */
final class SmsPrefs {
  private static final String FILE = "khata_sms_capture";
  private static final String KEY_ENABLED = "enabled";
  private static final String KEY_TOKEN = "token";

  private SmsPrefs() {}

  private static SharedPreferences open(Context context) {
    try {
      MasterKey key = new MasterKey.Builder(context)
          .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
          .build();
      return EncryptedSharedPreferences.create(
          context, FILE, key,
          EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
          EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
    } catch (GeneralSecurityException | IOException e) {
      // Keystore is unavailable on this device (custom ROM, corrupted
      // keystore). Falling back to a plain file keeps the feature working
      // rather than silently dropping every SMS; the token is still
      // sandboxed to this app's private storage either way.
      Log.w("SmsPrefs", "EncryptedSharedPreferences unavailable, falling back", e);
      return context.getSharedPreferences(FILE + "_fallback", Context.MODE_PRIVATE);
    }
  }

  static void enable(Context context, String token) {
    open(context).edit().putBoolean(KEY_ENABLED, true).putString(KEY_TOKEN, token).apply();
  }

  static void disable(Context context) {
    open(context).edit().putBoolean(KEY_ENABLED, false).remove(KEY_TOKEN).apply();
  }

  static boolean isEnabled(Context context) {
    return open(context).getBoolean(KEY_ENABLED, false);
  }

  static String getToken(Context context) {
    return open(context).getString(KEY_TOKEN, null);
  }
}
