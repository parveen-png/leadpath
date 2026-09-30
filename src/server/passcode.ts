import "server-only";

import { cookies } from "next/headers";

import { getServerEnv } from "@/lib/env";
import { PASSCODE_COOKIE, passcodeCookieMatches, passcodeToken } from "@/lib/passcode";

export const APP_PASSCODE = "Parveen@2026";

export async function hasPasscodeSession() {
  const env = getServerEnv();
  const jar = await cookies();
  return passcodeCookieMatches(jar.get(PASSCODE_COOKIE)?.value, env.APP_ENCRYPTION_KEY);
}

export async function grantPasscodeSession() {
  const env = getServerEnv();
  const jar = await cookies();
  jar.set(PASSCODE_COOKIE, await passcodeToken(env.APP_ENCRYPTION_KEY), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearPasscodeSession() {
  const jar = await cookies();
  jar.set(PASSCODE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
