import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";

export type AdminClient = SupabaseClient;

let admin: AdminClient | null = null;

export function createAdminClient(): AdminClient {
  if (admin) return admin;
  const env = getServerEnv();
  admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
