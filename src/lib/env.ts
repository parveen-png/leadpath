import "server-only";

import { z } from "zod";

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const serverEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  APP_ENCRYPTION_KEY: z.string().min(32),
  APP_URL: optionalString,
  META_APP_ID: optionalString,
  META_APP_SECRET: optionalString,
  META_VERIFY_TOKEN: optionalString,
  META_GRAPH_API_VERSION: z.preprocess(
    (value) => emptyToUndefined(value) ?? "v25.0",
    z.string().regex(/^v\d+\.\d+$/, "META_GRAPH_API_VERSION must look like v25.0"),
  ),
  FUB_API_KEY: optionalString,
  FUB_SYSTEM_NAME: optionalString,
  FUB_SYSTEM_KEY: optionalString,
  CRON_SECRET: optionalString,
  DEMO_MODE: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).optional()),
  LOG_LEVEL: z.preprocess(
    (value) => emptyToUndefined(value) ?? "info",
    z.enum(["debug", "info", "warn", "error"]),
  ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function readServerEnv(): { ok: true; env: ServerEnv } | { ok: false; message: string } {
  try {
    return { ok: true, env: getServerEnv() };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Environment variables are incomplete.",
    };
  }
}

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse({
    SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY,
    APP_URL: process.env.APP_URL,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN,
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
    FUB_API_KEY: process.env.FUB_API_KEY,
    FUB_SYSTEM_NAME: process.env.FUB_SYSTEM_NAME,
    FUB_SYSTEM_KEY: process.env.FUB_SYSTEM_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    DEMO_MODE: process.env.DEMO_MODE,
    LOG_LEVEL: process.env.LOG_LEVEL,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join(".") || "environment")
      .filter((value, index, all) => all.indexOf(value) === index);
    throw new Error(
      `Missing or invalid environment variables: ${missing.join(", ")}. Copy .env.example to .env.local and fill in the required values.`,
    );
  }
  cached = parsed.data;
  return parsed.data;
}

export function isDemoModeEnabled(): boolean {
  return getServerEnv().DEMO_MODE === "true";
}

export function resetServerEnvCache(): void {
  cached = null;
}
