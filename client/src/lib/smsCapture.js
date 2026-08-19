import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Bridge to the native SmsCapturePlugin (android/.../SmsCapturePlugin.java).
 * There is no iOS implementation — Apple gives no third-party app a way to
 * read the SMS inbox, in the background or otherwise, so this stays an
 * Android-only feature. registerPlugin() is safe to call on web/iOS; it just
 * has nothing to talk to there, which is why every export below is gated on
 * isAndroidNative() first.
 */
const SmsCapture = registerPlugin("SmsCapture");

export const isAndroidNative = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

/** Resolves once the OS permission dialog is answered; throws if refused. */
export async function enableSmsCapture(token) {
  const perm = await SmsCapture.requestPermission();
  if (!perm.granted) throw new Error("SMS permission was not granted.");
  await SmsCapture.enable({ token });
}

export async function disableSmsCapture() {
  await SmsCapture.disable();
}
