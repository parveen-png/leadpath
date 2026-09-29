import "server-only";

import { decryptString, encryptString, loadEncryptionKey } from "@/lib/encryption/crypto";
import { getServerEnv } from "@/lib/env";

function key() {
  return loadEncryptionKey(getServerEnv().APP_ENCRYPTION_KEY);
}

export function encryptSecret(plaintext: string): string {
  return encryptString(plaintext, key());
}

export function decryptSecret(payload: string): string {
  return decryptString(payload, key());
}

export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(payload: string): T {
  return JSON.parse(decryptSecret(payload)) as T;
}
