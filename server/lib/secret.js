import crypto from "node:crypto";

// Encrypts small secrets (PDF statement passwords) at rest, keyed off JWT_SECRET
// so nothing new needs provisioning. Not for anything security-critical --
// anyone with server access already has DATABASE_URL and JWT_SECRET.
const key = crypto.scryptSync(process.env.JWT_SECRET || "change-me-in-env", "khata-pdf-password", 32);

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decrypt(blob) {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
