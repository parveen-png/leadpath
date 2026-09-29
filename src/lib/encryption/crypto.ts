import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";

export function loadEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  if (Buffer.byteLength(trimmed, "utf8") === 32 && !trimmed.includes("=")) {
    const asUtf8 = Buffer.from(trimmed, "utf8");
    if (asUtf8.length === 32 && !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
      return asUtf8;
    }
  }
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === trimmed.replace(/=+$/, "")) {
    return decoded;
  }
  throw new Error(
    "APP_ENCRYPTION_KEY must be 32 bytes, encoded as base64 (openssl rand -base64 32) or 64 hex characters.",
  );
}

export function encryptString(plaintext: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptString(payload: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes.");
  }
  const [version, ivPart, tagPart, dataPart] = payload.split(":");
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error("Stored credential could not be read. Check APP_ENCRYPTION_KEY.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error("Stored credential could not be read. Check APP_ENCRYPTION_KEY.");
  }
}

export function maskSecret(secret: string | null | undefined): string {
  if (!secret) return "";
  const trimmed = secret.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••••••••••${trimmed.slice(-4)}`;
}

export function secretsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
