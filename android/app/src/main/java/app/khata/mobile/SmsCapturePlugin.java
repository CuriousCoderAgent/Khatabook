package app.khata.mobile;

import android.Manifest;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Bridge for client/src/lib/smsCapture.js. Only RECEIVE_SMS is requested —
 * that's the one permission SmsReceiver actually needs to see alerts as they
 * arrive, and asking for no more than that is also what keeps Play Store's
 * sensitive-permission review to a single, honest use case.
 */
@CapacitorPlugin(
    name = "SmsCapture",
    permissions = {
      @Permission(alias = "sms", strings = { Manifest.permission.RECEIVE_SMS })
    }
)
public class SmsCapturePlugin extends Plugin {

  @PluginMethod
  public void requestPermission(PluginCall call) {
    if (getPermissionState("sms") == com.getcapacitor.PermissionState.GRANTED) {
      JSObject ret = new JSObject();
      ret.put("granted", true);
      call.resolve(ret);
      return;
    }
    requestPermissionForAlias("sms", call, "permissionCallback");
  }

  @PermissionCallback
  private void permissionCallback(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("granted", getPermissionState("sms") == com.getcapacitor.PermissionState.GRANTED);
    call.resolve(ret);
  }

  @PluginMethod
  public void enable(PluginCall call) {
    String token = call.getString("token");
    if (token == null || token.isEmpty()) {
      call.reject("A device token is required.");
      return;
    }
    if (getPermissionState("sms") != com.getcapacitor.PermissionState.GRANTED) {
      call.reject("SMS permission has not been granted.");
      return;
    }
    SmsPrefs.enable(getContext(), token);
    call.resolve();
  }

  @PluginMethod
  public void disable(PluginCall call) {
    SmsPrefs.disable(getContext());
    call.resolve();
  }
}
