"use server";

import { maskSecret } from "@/lib/encryption/crypto";
import { encryptSecret } from "@/lib/encryption/secrets";
import { FollowUpBossClient } from "@/lib/follow-up-boss/client";
import { STANDARD_FUB_FIELDS } from "@/lib/follow-up-boss/catalog";
import { MetaClient } from "@/lib/meta/client";
import { allowRequest, recordActivity, requireWorkspace } from "@/server/session";
import {
  getConnection,
  readFubStored,
  readMetaStored,
  resolveFubAccess,
  resolveMetaAccess,
  saveConnection,
  toPublicConnection,
} from "@/services/connections/store";
import { isDemoModeEnabled } from "@/lib/env";

export async function saveMetaConnection(formData: FormData) {
  const ctx = await requireWorkspace();
  if (!(await allowRequest(ctx.admin, `meta-save:${ctx.userId}`, 15, 60_000))) {
    return { ok: false as const, error: "Please wait a moment before saving again." };
  }
  const existing = await getConnection(ctx.admin, ctx.workspaceId, "meta");
  const stored = readMetaStored(existing);
  const appSecret = String(formData.get("appSecret") ?? "").trim();
  const verifyToken = String(formData.get("verifyToken") ?? "").trim();
  const userAccessToken = String(formData.get("userAccessToken") ?? "").trim();
  const appId = String(formData.get("appId") ?? "").trim();
  const credentials = {
    appSecret: appSecret || stored.appSecret,
    verifyToken: verifyToken || stored.verifyToken,
    userAccessToken: userAccessToken || stored.userAccessToken,
  };
  const id = await saveConnection(ctx.admin, {
    workspaceId: ctx.workspaceId,
    provider: "meta",
    status: credentials.userAccessToken && (existing?.status === "connected" || existing?.status === "error") ? existing.status : "disconnected",
    credentials,
    publicConfig: {
      ...(existing?.public_config ?? {}),
      appId: appId || undefined,
      maskedAppSecret: credentials.appSecret ? maskSecret(credentials.appSecret) : "",
      maskedAccessToken: credentials.userAccessToken ? maskSecret(credentials.userAccessToken) : "",
    },
  });
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: existing ? "connection.updated" : "connection.added",
    summary: "Facebook connection details were saved.",
    entityType: "connection",
    entityId: id,
  });
  return { ok: true as const };
}

export async function testMetaConnection() {
  const ctx = await requireWorkspace();
  if (!(await allowRequest(ctx.admin, `meta-test:${ctx.userId}`, 8, 60_000))) {
    return { ok: false as const, friendly: "Please wait a moment before testing again.", technical: "" };
  }
  const meta = await resolveMetaAccess(ctx.admin, ctx.workspaceId, ctx.metaGraphVersion);
  if (!meta.userAccessToken) {
    return {
      ok: false as const,
      friendly: "Add a Facebook Page or user access token before testing.",
      technical: "No access token is stored.",
    };
  }
  const client = new MetaClient({ version: meta.graphVersion });
  const result = await client.testConnection(meta.userAccessToken);
  if (!result.ok) {
    await saveConnection(ctx.admin, {
      workspaceId: ctx.workspaceId,
      provider: "meta",
      status: "error",
      lastError: result.friendly,
      tested: true,
    });
    return result;
  }
  await replacePages(ctx, result.pages);
  let formCount = 0;
  for (const page of result.pages.slice(0, 15)) {
    const forms = await client.listForms(page.id, page.access_token || meta.userAccessToken);
    formCount += forms.length;
    await replaceForms(ctx.workspaceId, page.id, forms);
  }
  await saveConnection(ctx.admin, {
    workspaceId: ctx.workspaceId,
    provider: "meta",
    status: "connected",
    accountLabel: result.accountName,
    tested: true,
    synced: true,
    lastError: null,
    publicConfig: {
      ...((await getConnection(ctx.admin, ctx.workspaceId, "meta"))?.public_config ?? {}),
      pageCount: result.pages.length,
      formCount,
      accountName: result.accountName,
    },
  });
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "connection.tested",
    summary: "Facebook connection was tested.",
  });
  return { ok: true as const, accountName: result.accountName, pageCount: result.pages.length, formCount, pages: result.pages.map((page) => ({ id: page.id, name: page.name })) };
}

export async function subscribeMetaPage(pageId: string) {
  const ctx = await requireWorkspace();
  const meta = await resolveMetaAccess(ctx.admin, ctx.workspaceId, ctx.metaGraphVersion);
  const page = await ctx.admin
    .from("meta_pages")
    .select("encrypted_access_token, name")
    .eq("workspace_id", ctx.workspaceId)
    .eq("page_id", pageId)
    .maybeSingle();
  const row = page.data as { encrypted_access_token: string | null; name: string } | null;
  if (!row) return { ok: false as const, error: "Choose a Page that has been refreshed." };
  const { decryptSecret } = await import("@/lib/encryption/secrets");
  const token = row.encrypted_access_token ? decryptSecret(row.encrypted_access_token) : meta.userAccessToken;
  if (!token) return { ok: false as const, error: "This Page does not have an access token yet." };
  const client = new MetaClient({ version: meta.graphVersion });
  try {
    await client.subscribePage(pageId, token);
  } catch {
    return { ok: false as const, error: "Facebook could not turn on lead notifications for this Page. Check that the token can manage the Page." };
  }
  await ctx.admin.from("meta_pages").update({ subscribed: true }).eq("workspace_id", ctx.workspaceId).eq("page_id", pageId);
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "connection.updated",
    summary: `Lead notifications were turned on for ${row.name}.`,
  });
  return { ok: true as const };
}

export async function removeMetaConnection() {
  const ctx = await requireWorkspace();
  await ctx.admin.from("meta_pages").delete().eq("workspace_id", ctx.workspaceId);
  await ctx.admin.from("meta_forms").delete().eq("workspace_id", ctx.workspaceId);
  await ctx.admin.from("meta_form_fields").delete().eq("workspace_id", ctx.workspaceId);
  await ctx.admin.from("connections").delete().eq("workspace_id", ctx.workspaceId).eq("provider", "meta");
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "connection.removed",
    summary: "Facebook was disconnected.",
  });
  return { ok: true as const };
}

export async function saveFubConnection(formData: FormData) {
  const ctx = await requireWorkspace();
  if (!(await allowRequest(ctx.admin, `fub-save:${ctx.userId}`, 15, 60_000))) {
    return { ok: false as const, error: "Please wait a moment before saving again." };
  }
  const existing = await getConnection(ctx.admin, ctx.workspaceId, "follow_up_boss");
  const stored = readFubStored(existing);
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const systemName = String(formData.get("systemName") ?? "").trim();
  const systemKey = String(formData.get("systemKey") ?? "").trim();
  const credentials = {
    apiKey: apiKey || stored.apiKey,
    systemName: systemName || stored.systemName,
    systemKey: systemKey || stored.systemKey,
  };
  const id = await saveConnection(ctx.admin, {
    workspaceId: ctx.workspaceId,
    provider: "follow_up_boss",
    status: credentials.apiKey && (existing?.status === "connected" || existing?.status === "error") ? existing.status : "disconnected",
    credentials,
    publicConfig: {
      ...(existing?.public_config ?? {}),
      systemName: credentials.systemName,
      maskedApiKey: credentials.apiKey ? maskSecret(credentials.apiKey) : "",
      maskedSystemKey: credentials.systemKey ? maskSecret(credentials.systemKey) : "",
    },
  });
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: existing ? "connection.updated" : "connection.added",
    summary: "Follow Up Boss connection details were saved.",
    entityType: "connection",
    entityId: id,
  });
  return { ok: true as const };
}

export async function testFubConnection() {
  const ctx = await requireWorkspace();
  if (!(await allowRequest(ctx.admin, `fub-test:${ctx.userId}`, 8, 60_000))) {
    return { ok: false as const, friendly: "Please wait a moment before testing again.", technical: "" };
  }
  const credentials = await resolveFubAccess(ctx.admin, ctx.workspaceId);
  if (!credentials) {
    return { ok: false as const, friendly: "Add a Follow Up Boss API key before testing.", technical: "No API key is stored." };
  }
  const client = new FollowUpBossClient(credentials);
  const result = await client.testConnection();
  if (!result.ok) {
    await saveConnection(ctx.admin, {
      workspaceId: ctx.workspaceId,
      provider: "follow_up_boss",
      status: "error",
      lastError: result.friendly,
      tested: true,
    });
    return result;
  }
  await syncFields(ctx.workspaceId, client);
  const standardCount = STANDARD_FUB_FIELDS.length;
  await saveConnection(ctx.admin, {
    workspaceId: ctx.workspaceId,
    provider: "follow_up_boss",
    status: "connected",
    accountLabel: result.accountName,
    tested: true,
    synced: true,
    lastError: null,
    publicConfig: {
      ...((await getConnection(ctx.admin, ctx.workspaceId, "follow_up_boss"))?.public_config ?? {}),
      accountName: result.accountName,
      domain: result.domain,
      userName: result.userName,
      customFieldCount: result.customFieldCount,
      standardFieldCount: standardCount,
    },
  });
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "fields.refreshed",
    summary: "Follow Up Boss fields were refreshed.",
  });
  return {
    ok: true as const,
    accountName: result.accountName,
    customFieldCount: result.customFieldCount,
    standardFieldCount: standardCount,
    domain: result.domain,
  };
}

export async function refreshFubFields() {
  const ctx = await requireWorkspace();
  const credentials = await resolveFubAccess(ctx.admin, ctx.workspaceId);
  if (!credentials) return { ok: false as const, error: "Connect Follow Up Boss before refreshing fields." };
  const client = new FollowUpBossClient(credentials);
  const count = await syncFields(ctx.workspaceId, client);
  await saveConnection(ctx.admin, {
    workspaceId: ctx.workspaceId,
    provider: "follow_up_boss",
    status: "connected",
    synced: true,
    publicConfig: {
      ...((await getConnection(ctx.admin, ctx.workspaceId, "follow_up_boss"))?.public_config ?? {}),
      customFieldCount: count,
    },
  });
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "fields.refreshed",
    summary: "Follow Up Boss fields were refreshed.",
  });
  return { ok: true as const, customFieldCount: count };
}

export async function removeFubConnection() {
  const ctx = await requireWorkspace();
  await ctx.admin.from("connections").delete().eq("workspace_id", ctx.workspaceId).eq("provider", "follow_up_boss");
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "connection.removed",
    summary: "Follow Up Boss was disconnected.",
  });
  return { ok: true as const };
}

export async function connectionSummary() {
  const ctx = await requireWorkspace();
  const meta = await getConnection(ctx.admin, ctx.workspaceId, "meta");
  const fub = await getConnection(ctx.admin, ctx.workspaceId, "follow_up_boss");
  return {
    demo: ctx.demoMode || isDemoModeEnabled(),
    meta: toPublicConnection(meta, "meta"),
    fub: toPublicConnection(fub, "follow_up_boss"),
    webhookUrl: webhookUrl(),
  };
}

function webhookUrl() {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  return base ? `${base}/api/webhooks/meta` : "/api/webhooks/meta";
}

async function replacePages(
  ctx: Awaited<ReturnType<typeof requireWorkspace>>,
  pages: Array<{ id: string; name: string; access_token?: string; category?: string }>,
) {
  for (const page of pages) {
    await ctx.admin.from("meta_pages").upsert(
      {
        workspace_id: ctx.workspaceId,
        page_id: page.id,
        name: page.name,
        category: page.category ?? null,
        encrypted_access_token: page.access_token ? encryptSecret(page.access_token) : null,
        is_demo: false,
      },
      { onConflict: "workspace_id,page_id" },
    );
  }
}

async function replaceForms(
  workspaceId: string,
  pageId: string,
  forms: Array<{ id: string; name: string; status?: string; created_time?: string; questions?: Array<{ key: string; label?: string; type?: string; options?: unknown[] }> }>,
) {
  const { createAdminClient } = await import("@/lib/database/admin");
  const admin = createAdminClient();
  for (const form of forms) {
    await admin.from("meta_forms").upsert(
      {
        workspace_id: workspaceId,
        page_id: pageId,
        form_id: form.id,
        name: form.name,
        status: form.status ?? null,
        field_count: form.questions?.length ?? 0,
        meta_updated_time: form.created_time ?? null,
        is_demo: false,
      },
      { onConflict: "workspace_id,form_id" },
    );
    await admin.from("meta_form_fields").delete().eq("workspace_id", workspaceId).eq("form_id", form.id);
    if (form.questions?.length) {
      await admin.from("meta_form_fields").insert(
        form.questions.map((question, index) => ({
          workspace_id: workspaceId,
          form_id: form.id,
          field_key: question.key,
          label: question.label || question.key,
          field_type: question.type ?? null,
          options: question.options ?? [],
          sort_order: index,
        })),
      );
    }
  }
}

async function syncFields(workspaceId: string, client: FollowUpBossClient) {
  const { createAdminClient } = await import("@/lib/database/admin");
  const admin = createAdminClient();
  const custom = await client.listCustomFields();
  const [users, timeframes, ponds] = await Promise.all([
    client.listFlexible("/users?limit=100"),
    client.listFlexible("/timeframes?limit=100"),
    client.listFlexible("/ponds?limit=100"),
  ]);
  const now = new Date().toISOString();
  const rows = [
    ...custom.map((field) => ({
      workspace_id: workspaceId,
      fub_id: String(field.id),
      label: field.label,
      api_name: field.name,
      field_type: field.type,
      category: "Custom Fields",
      is_custom: true,
      is_recurring: field.isRecurring ?? null,
      choices: field.choices ?? [],
      choice_map: {},
      write_target: "event.person.custom",
      removed_at: null,
      synced_at: now,
    })),
    lookupRow(workspaceId, "assignedUserId", "Assigned Agent On Team", users, "event.person", now),
    lookupRow(workspaceId, "timeframeId", "Timeframe", timeframes, "person.timeframeId", now),
    lookupRow(workspaceId, "assignedPondId", "Assigned Pond", ponds, "person.assignedPondId", now),
  ].filter((row) => row.choices.length > 0 || row.is_custom);
  if (rows.length > 0) {
    await admin.from("fub_fields").upsert(rows, { onConflict: "workspace_id,api_name" });
  }
  const existing = await admin.from("fub_fields").select("api_name").eq("workspace_id", workspaceId).eq("is_custom", true);
  const seen = new Set(custom.map((field) => field.name));
  const stale = ((existing.data ?? []) as Array<{ api_name: string }>).filter((field) => !seen.has(field.api_name)).map((field) => field.api_name);
  if (stale.length > 0) {
    await admin.from("fub_fields").update({ removed_at: now }).eq("workspace_id", workspaceId).in("api_name", stale);
  }
  return custom.length;
}

function lookupRow(
  workspaceId: string,
  apiName: string,
  label: string,
  records: Array<{ id: string; name: string }>,
  writeTarget: string,
  syncedAt: string,
) {
  const choiceMap: Record<string, string> = {};
  const choices: string[] = [];
  for (const record of records) {
    const key = choices.includes(record.name) ? `${record.name} (${record.id})` : record.name;
    choices.push(key);
    choiceMap[key] = record.id;
  }
  return {
    workspace_id: workspaceId,
    fub_id: null,
    label,
    api_name: apiName,
    field_type: "dropdown",
    category: apiName === "timeframeId" ? "Lead Information" : "Assignment",
    is_custom: false,
    is_recurring: null,
    choices,
    choice_map: choiceMap,
    write_target: writeTarget,
    removed_at: null,
    synced_at: syncedAt,
  };
}
