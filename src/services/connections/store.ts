import "server-only";

import { decryptJson, decryptSecret, encryptJson } from "@/lib/encryption/secrets";
import { getServerEnv } from "@/lib/env";
import type { AdminClient } from "@/lib/database/admin";
import type { FubCredentials } from "@/lib/follow-up-boss/client";

export type MetaStoredCredentials = {
  appSecret?: string;
  verifyToken?: string;
  userAccessToken?: string;
};

export type FubStoredCredentials = {
  apiKey?: string;
  systemName?: string;
  systemKey?: string;
};

type ConnectionRow = {
  id: string;
  provider: string;
  status: string;
  account_label: string | null;
  encrypted_credentials: string | null;
  public_config: Record<string, unknown>;
  last_tested_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
};

export type PublicConnection = {
  id: string;
  provider: "meta" | "follow_up_boss";
  status: string;
  accountLabel: string | null;
  publicConfig: Record<string, unknown>;
  lastTestedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  hasSecret: boolean;
};

export async function getConnection(admin: AdminClient, workspaceId: string, provider: "meta" | "follow_up_boss") {
  const result = await admin
    .from("connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  return (result.data as ConnectionRow | null) ?? null;
}

export function toPublicConnection(row: ConnectionRow | null, provider: "meta" | "follow_up_boss"): PublicConnection | null {
  if (!row) return null;
  return {
    id: row.id,
    provider,
    status: row.status,
    accountLabel: row.account_label,
    publicConfig: row.public_config ?? {},
    lastTestedAt: row.last_tested_at,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    hasSecret: Boolean(row.encrypted_credentials),
  };
}

export function readMetaStored(row: ConnectionRow | null): MetaStoredCredentials {
  if (!row?.encrypted_credentials) return {};
  return decryptJson<MetaStoredCredentials>(row.encrypted_credentials);
}

export function readFubStored(row: ConnectionRow | null): FubStoredCredentials {
  if (!row?.encrypted_credentials) return {};
  return decryptJson<FubStoredCredentials>(row.encrypted_credentials);
}

export async function resolveMetaAccess(admin: AdminClient, workspaceId: string, graphVersion: string | null) {
  const env = getServerEnv();
  const row = await getConnection(admin, workspaceId, "meta");
  const stored = readMetaStored(row);
  const config = row?.public_config ?? {};
  return {
    row,
    appId: stringValue(config.appId) || env.META_APP_ID,
    appSecret: stored.appSecret || env.META_APP_SECRET,
    verifyToken: stored.verifyToken || env.META_VERIFY_TOKEN,
    userAccessToken: stored.userAccessToken,
    graphVersion: graphVersion || env.META_GRAPH_API_VERSION,
  };
}

export async function resolveFubAccess(admin: AdminClient, workspaceId: string): Promise<FubCredentials | null> {
  const env = getServerEnv();
  const row = await getConnection(admin, workspaceId, "follow_up_boss");
  const stored = readFubStored(row);
  const apiKey = stored.apiKey || env.FUB_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    systemName: stored.systemName || env.FUB_SYSTEM_NAME,
    systemKey: stored.systemKey || env.FUB_SYSTEM_KEY,
  };
}

export async function pageAccessToken(admin: AdminClient, workspaceId: string, pageId: string) {
  const result = await admin
    .from("meta_pages")
    .select("encrypted_access_token")
    .eq("workspace_id", workspaceId)
    .eq("page_id", pageId)
    .maybeSingle();
  const token = (result.data as { encrypted_access_token: string | null } | null)?.encrypted_access_token;
  if (!token) {
    const meta = await resolveMetaAccess(admin, workspaceId, null);
    return meta.userAccessToken ?? null;
  }
  return decryptSecret(token);
}

export async function collectWebhookSecrets(admin: AdminClient) {
  const env = getServerEnv();
  const secrets = new Set<string>();
  const tokens = new Set<string>();
  if (env.META_APP_SECRET) secrets.add(env.META_APP_SECRET);
  if (env.META_VERIFY_TOKEN) tokens.add(env.META_VERIFY_TOKEN);
  const result = await admin.from("connections").select("encrypted_credentials").eq("provider", "meta").limit(50);
  const rows = (result.data ?? []) as Array<{ encrypted_credentials: string | null }>;
  for (const row of rows) {
    if (!row.encrypted_credentials) continue;
    try {
      const stored = decryptJson<MetaStoredCredentials>(row.encrypted_credentials);
      if (stored.appSecret) secrets.add(stored.appSecret);
      if (stored.verifyToken) tokens.add(stored.verifyToken);
    } catch {
      continue;
    }
  }
  return { secrets: [...secrets], tokens: [...tokens] };
}

export async function saveConnection(
  admin: AdminClient,
  input: {
    workspaceId: string;
    provider: "meta" | "follow_up_boss";
    status: "connected" | "disconnected" | "error";
    accountLabel?: string | null;
    credentials?: MetaStoredCredentials | FubStoredCredentials | null;
    publicConfig?: Record<string, unknown>;
    lastError?: string | null;
    tested?: boolean;
    synced?: boolean;
  },
) {
  const existing = await getConnection(admin, input.workspaceId, input.provider);
  const payload = {
    workspace_id: input.workspaceId,
    provider: input.provider,
    status: input.status,
    account_label: input.accountLabel ?? existing?.account_label ?? null,
    encrypted_credentials:
      input.credentials === undefined
        ? existing?.encrypted_credentials ?? null
        : input.credentials
          ? encryptJson(input.credentials)
          : null,
    public_config: input.publicConfig ?? existing?.public_config ?? {},
    last_error: input.lastError ?? null,
    last_tested_at: input.tested ? new Date().toISOString() : existing?.last_tested_at ?? null,
    last_synced_at: input.synced ? new Date().toISOString() : existing?.last_synced_at ?? null,
  };
  if (existing) {
    await admin.from("connections").update(payload).eq("id", existing.id).eq("workspace_id", input.workspaceId);
    return existing.id;
  }
  const inserted = await admin.from("connections").insert(payload).select("id").single();
  return (inserted.data as { id: string }).id;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
