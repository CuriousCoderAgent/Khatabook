package app.khata.mobile;

import android.content.Context;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Does the actual network call SmsReceiver couldn't risk doing inline: POSTs
 * one captured alert to POST /api/import/sms/device, authenticated with the
 * device's bearer token instead of the web session's cookie (see
 * server/routes/devices.js). WorkManager owns retry/backoff for us — Result
 * .retry() is enough to get another attempt once connectivity is back.
 */
public class SmsForwardWorker extends Worker {
  static final String KEY_SENDER = "sender";
  static final String KEY_BODY = "body";
  static final String KEY_RECEIVED_AT = "receivedAt";
  private static final String TAG = "SmsForwardWorker";

  public SmsForwardWorker(@NonNull Context context, @NonNull WorkerParameters params) {
    super(context, params);
  }

  @NonNull
  @Override
  public Result doWork() {
    Context context = getApplicationContext();
    if (!SmsPrefs.isEnabled(context)) return Result.success(); // turned off since this was queued

    String token = SmsPrefs.getToken(context);
    if (token == null) return Result.failure();

    String baseUrl = context.getString(R.string.khata_api_base_url);
    if (baseUrl == null || baseUrl.contains("REPLACE_WITH")) {
      Log.e(TAG, "khata_api_base_url is not configured — see strings.xml");
      return Result.failure();
    }

    Data input = getInputData();
    String sender = input.getString(KEY_SENDER);
    String body = input.getString(KEY_BODY);
    long receivedAt = input.getLong(KEY_RECEIVED_AT, System.currentTimeMillis());
    if (body == null || body.isEmpty()) return Result.failure();

    try {
      JSONObject message = new JSONObject();
      message.put("sender", sender == null ? "" : sender);
      message.put("body", body);
      message.put("receivedAt", receivedAt);
      JSONObject payload = new JSONObject();
      payload.put("messages", new JSONArray().put(message));

      int status = post(baseUrl + "/api/import/sms/device", token, payload.toString());
      if (status >= 200 && status < 300) return Result.success();
      if (status == 401) {
        // Token was revoked from Settings; retrying can never succeed.
        SmsPrefs.disable(context);
        return Result.failure();
      }
      return Result.retry();
    } catch (JSONException e) {
      Log.e(TAG, "could not build request body", e);
      return Result.failure();
    } catch (IOException e) {
      Log.w(TAG, "network error forwarding SMS, will retry", e);
      return Result.retry();
    }
  }

  private static int post(String url, String token, String jsonBody) throws IOException {
    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
    try {
      conn.setRequestMethod("POST");
      conn.setConnectTimeout(15000);
      conn.setReadTimeout(15000);
      conn.setDoOutput(true);
      conn.setRequestProperty("Content-Type", "application/json");
      conn.setRequestProperty("Authorization", "Bearer " + token);
      byte[] out = jsonBody.getBytes(StandardCharsets.UTF_8);
      try (OutputStream os = conn.getOutputStream()) {
        os.write(out);
      }
      return conn.getResponseCode();
    } finally {
      conn.disconnect();
    }
  }
}
