export const PASSCODE_COOKIE = "leadpath_gate";

const PAYLOAD = "leadpath-access-v1";

export async function passcodeToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(PAYLOAD));
  return bytesToBase64Url(new Uint8Array(mac));
}

export async function passcodeCookieMatches(cookie: string | undefined, secret: string): Promise<boolean> {
  if (!cookie || !secret) return false;
  const expected = await passcodeToken(secret);
  return tokensEqual(cookie, expected);
}

function tokensEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index]! ^ b[index]!;
  return diff === 0;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
