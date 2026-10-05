import "server-only";

import { explainFubFailure } from "@/lib/follow-up-boss/client";
import { FollowUpBossClient } from "@/lib/follow-up-boss/client";
import { mergeDestinationFields } from "@/lib/follow-up-boss/catalog";
import type { AdminClient } from "@/lib/database/admin";
import { createAdminClient } from "@/lib/database/admin";
import { safeResponseSummary } from "@/lib/errors/normalize";
import { HttpRequestError } from "@/lib/http/client";
import { createCorrelationId, createLogger } from "@/lib/logger/logger";
import { MetaClient, metaErrorMessage } from "@/lib/meta/client";
import { extractLeadgenNotices, readVerifyChallenge, verifyMetaSignature, type LeadgenNotice } from "@/lib/meta/webhook";
import { buildFubPayload } from "@/services/mapping/payload";
import { classifyRetry, nextRetryAt } from "@/services/mapping/retry";
import { leadValuesFromParts } from "@/services/mapping/sources";
import { matchWorkflow } from "@/services/mapping/workflow-match";
import { isDemoIdentifier } from "@/services/demo/fixtures";
import {
  collectWebhookSecrets,
  pageAccessToken,
  resolveFubAccess,
  resolveMetaAccess,
  saveConnection,
} from "@/services/connections/store";
import { recordActivity, requireWorkspace } from "@/server/session";
import type {
  DestinationField,
  FieldMapping,
  LeadStatus,
  StaticValue,
  Transform,
  ValueTranslation,
  WorkflowRule,
  WorkflowTag,
} from "@/types/domain";

type JobRow = {
  id: string;
  workspace_id: string;
  lead_id: string;
  status: string;
  stage: string;
  attempt_count: number;
  max_attempts: number;
  next_run_at: string;
  locked_at: string | null;
};

type LeadRow = {
  id: string;
  workspace_id: string;
  workflow_id: string | null;
  meta_lead_id: string;
  page_id: string | null;
  page_name: string | null;
  form_id: string | null;
  form_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  platform: string | null;
  status: LeadStatus;
  fub_person_id: string | null;
  fub_account_domain: string | null;
  is_test: boolean;
  is_demo: boolean;
  correlation_id: string;
  friendly_error: string | null;
};

type WorkflowRow = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused";
  page_id: string | null;
  form_id: string | null;
  form_scope: "specific" | "any";
  event_type: string;
  source_name: string;
  campaign_source: string;
  system_name: string | null;
  is_demo: boolean;
  updated_at: string;
};

const logger = createLogger({ service: "lead-pipeline" });

export async function ingestMetaWebhook(rawBody: string, signature: string | null): Promise<Response> {
  if (rawBody.length > 1_000_000) return new Response("Payload too large", { status: 413 });
  const admin = createAdminClient();
  const { secrets } = await collectWebhookSecrets(admin);
  const valid = secrets.some((secret) => verifyMetaSignature(rawBody, signature, secret));
  const correlationId = createCorrelationId();
  if (!valid) {
    logger.warn("Rejected Meta webhook", { correlationId, reason: "signature" });
    return new Response("Invalid signature", { status: 403 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const notices = extractLeadgenNotices(parsed);
  for (const notice of notices) {
    await receiveNotice(admin, notice, correlationId);
  }
  if (notices.length === 0) {
    await admin.from("webhook_events").insert({
      provider: "meta",
      payload: { noticeCount: 0 },
      signature_valid: true,
      status: "ignored",
      correlation_id: correlationId,
    });
  }
  return new Response("OK", { status: 200 });
}

export async function verifyMetaWebhook(params: URLSearchParams): Promise<Response> {
  const admin = createAdminClient();
  const { tokens } = await collectWebhookSecrets(admin);
  for (const token of tokens) {
    const result = readVerifyChallenge(params, token);
    if (result.ok) return new Response(result.challenge, { status: 200 });
  }
  return new Response("Verification failed", { status: 403 });
}

async function receiveNotice(admin: AdminClient, notice: LeadgenNotice, correlationId: string) {
  const pageResult = await admin
    .from("meta_pages")
    .select("workspace_id, name, page_id")
    .eq("page_id", notice.pageId)
    .limit(1)
    .maybeSingle();
  const page = pageResult.data as { workspace_id: string; name: string; page_id: string } | null;
  await admin.from("webhook_events").insert({
    workspace_id: page?.workspace_id ?? null,
    provider: "meta",
    external_id: notice.leadgenId,
    payload: notice,
    signature_valid: true,
    status: page ? "queued" : "unmatched",
    correlation_id: correlationId,
  });
  if (!page) {
    logger.warn("Lead webhook did not match a connected Page", { correlationId, pageId: notice.pageId });
    return;
  }
  const existing = await admin
    .from("leads")
    .select("id")
    .eq("workspace_id", page.workspace_id)
    .eq("meta_lead_id", notice.leadgenId)
    .maybeSingle();
  if (existing.data) {
    await admin.from("duplicate_webhook_attempts").insert({
      workspace_id: page.workspace_id,
      meta_lead_id: notice.leadgenId,
      lead_id: (existing.data as { id: string }).id,
      correlation_id: correlationId,
    });
    logger.info("Ignored duplicate Meta lead", { correlationId, metaLeadId: notice.leadgenId });
    return;
  }
  const inserted = await admin
    .from("leads")
    .insert({
      workspace_id: page.workspace_id,
      meta_lead_id: notice.leadgenId,
      page_id: notice.pageId,
      page_name: page.name,
      form_id: notice.formId,
      ad_id: notice.adId ?? null,
      adset_id: notice.adgroupId ?? null,
      lead_created_at: notice.createdTime ?? null,
      status: "queued",
      correlation_id: correlationId,
      is_demo: isDemoIdentifier(notice.leadgenId),
    })
    .select("id")
    .single();
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      logger.info("Ignored duplicate Meta lead", { correlationId, metaLeadId: notice.leadgenId });
      return;
    }
    throw new Error(inserted.error.message);
  }
  const leadId = (inserted.data as { id: string }).id;
  await admin.from("lead_payloads").insert({
    workspace_id: page.workspace_id,
    lead_id: leadId,
    facebook_raw: { notice },
    timeline: [{ at: new Date().toISOString(), label: "Lead received from Facebook" }],
  });
  await admin.from("delivery_jobs").insert({
    workspace_id: page.workspace_id,
    lead_id: leadId,
    status: "queued",
    stage: "fetch",
    next_run_at: new Date().toISOString(),
  });
  logger.info("Queued Facebook lead", { correlationId, leadId, metaLeadId: notice.leadgenId });
}

const RECENT_LEAD_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export async function importRecentLeads(): Promise<{ imported: number; message: string | null }> {
  const ctx = await requireWorkspace();
  const meta = await resolveMetaAccess(ctx.admin, ctx.workspaceId, ctx.metaGraphVersion);
  if (!meta.userAccessToken) {
    return { imported: 0, message: "Add a Facebook access token on Connections before leads can come in." };
  }
  const workflows = await ctx.admin
    .from("workflows")
    .select("page_id, form_id, form_scope, is_demo")
    .eq("workspace_id", ctx.workspaceId)
    .eq("status", "active");
  const active = ((workflows.data ?? []) as Array<{ page_id: string | null; form_id: string | null; form_scope: string; is_demo: boolean }>).filter(
    (workflow) => workflow.page_id && workflow.form_id && workflow.form_scope !== "any" && !workflow.is_demo && !isDemoIdentifier(workflow.page_id),
  );
  if (!active.length) return { imported: 0, message: null };
  const client = new MetaClient({ version: meta.graphVersion });
  const since = Date.now() - RECENT_LEAD_WINDOW_MS;
  let imported = 0;
  for (const workflow of active) {
    const token = (await pageAccessToken(ctx.admin, ctx.workspaceId, workflow.page_id!)) || meta.userAccessToken;
    let leads;
    try {
      leads = await client.listRecentLeads(workflow.form_id!, token);
    } catch (error) {
      const explained = metaErrorMessage(error);
      const expired = explained.technical.includes("code 190") || /expired/i.test(explained.technical);
      if (expired) {
        await saveConnection(ctx.admin, {
          workspaceId: ctx.workspaceId,
          provider: "meta",
          status: "error",
          lastError: "The Facebook access token expired, so new leads could not be read.",
          tested: true,
        });
        return {
          imported,
          message: "The Facebook access token expired, so these leads never reached Leadpath. Paste a new token on Connections. Opening Leads after that brings in leads from the last 3 days.",
        };
      }
      return { imported, message: explained.friendly };
    }
    for (const lead of leads) {
      const created = lead.created_time ? Date.parse(lead.created_time) : 0;
      if (!created || created < since) continue;
      const existing = await ctx.admin
        .from("leads")
        .select("id")
        .eq("workspace_id", ctx.workspaceId)
        .eq("meta_lead_id", lead.id)
        .maybeSingle();
      if (existing.data) continue;
      await receiveNotice(
        ctx.admin,
        {
          leadgenId: lead.id,
          pageId: workflow.page_id!,
          formId: lead.form_id ?? workflow.form_id!,
          adId: lead.ad_id,
          adgroupId: lead.adset_id,
          createdTime: lead.created_time,
        },
        createCorrelationId(),
      );
      imported += 1;
    }
  }
  await processDueJobs(25);
  return { imported, message: null };
}

export async function processDueJobs(limit = 8): Promise<number> {
  const admin = createAdminClient();
  const claimed = await admin.rpc("claim_delivery_jobs", { batch_size: limit });
  if (claimed.error) {
    logger.error("Could not claim delivery jobs", { message: claimed.error.message });
    return 0;
  }
  const jobs = (claimed.data ?? []) as JobRow[];
  for (const job of jobs) {
    await processJob(admin, job);
  }
  return jobs.length;
}

export async function processJob(admin: AdminClient, job: JobRow) {
  const attempt = job.attempt_count + 1;
  await admin.from("delivery_jobs").update({ attempt_count: attempt }).eq("id", job.id);
  const log = logger.child({ jobId: job.id, leadId: job.lead_id, attempt, correlationId: job.id });
  try {
    await executeJob(admin, job, attempt, log);
  } catch (error) {
    const permanent = error instanceof PermanentError;
    const httpStatus = error instanceof HttpRequestError ? error.status : permanent ? 400 : null;
    const explained = explainJobError(error);
    await finishAttempt(admin, job, attempt, {
      success: false,
      httpStatus,
      retry: permanent ? "permanent" : classifyRetry({ httpStatus, networkError: httpStatus == null }),
      friendly: explained.friendly,
      technical: explained.technical,
      stage: job.stage,
    });
    log.error("Delivery attempt failed", { httpStatus, stage: job.stage });
  }
}

async function executeJob(admin: AdminClient, job: JobRow, attempt: number, log: ReturnType<typeof logger.child>) {
  const leadResult = await admin.from("leads").select("*").eq("id", job.lead_id).single();
  const lead = leadResult.data as LeadRow | null;
  if (!lead) throw new Error("Lead record is missing.");
  if (lead.status === "delivered") {
    await admin.from("delivery_jobs").update({ status: "delivered", stage: "done", locked_at: null }).eq("id", job.id);
    return;
  }
  if (lead.is_demo) {
    await updateLead(admin, lead.id, { status: "ignored", friendly_error: "Demo data is never sent to Follow Up Boss." });
    await admin.from("delivery_jobs").update({ status: "ignored", locked_at: null }).eq("id", job.id);
    return;
  }

  const payloadRow = await admin.from("lead_payloads").select("*").eq("lead_id", lead.id).single();
  const stored = (payloadRow.data ?? {}) as {
    facebook_raw: { notice?: LeadgenNotice; values?: Record<string, string>; raw?: unknown };
    timeline?: Array<{ at: string; label: string; detail?: string }>;
  };
  let stage = job.stage;
  let values = stored.facebook_raw?.values ?? null;

  if (stage === "fetch" || !values) {
    values = await fetchLeadValues(admin, lead);
    stage = "event";
    await admin.from("delivery_jobs").update({ stage }).eq("id", job.id);
    log.info("Facebook lead data retrieved", { fieldCount: Object.keys(values).length });
  }

  const workflow = await chooseWorkflow(admin, lead);
  if (!workflow) {
    await updateLead(admin, lead.id, {
      status: "ignored",
      friendly_error: "No active workflow is set up for this Facebook Page and form.",
    });
    await appendTimeline(admin, lead, "No active workflow matched this lead");
    await admin.from("delivery_jobs").update({ status: "ignored", locked_at: null, stage: "done" }).eq("id", job.id);
    return;
  }
  if (lead.workflow_id !== workflow.id) {
    await updateLead(admin, lead.id, { workflow_id: workflow.id, form_name: lead.form_name });
    await appendTimeline(admin, lead, `Workflow matched: ${workflow.name}`);
  }

  const bundle = await loadBundle(admin, lead.workspace_id, workflow);
  const built = buildFubPayload({
    values,
    mappings: bundle.mappings,
    staticValues: bundle.staticValues,
    tags: bundle.tags,
    rules: bundle.rules,
    translations: bundle.translations,
    destinations: bundle.destinations,
    sourceName: workflow.source_name,
    systemName: workflow.system_name || "Leadpath",
    eventType: workflow.event_type,
    campaignSource: workflow.campaign_source,
  });
  if (!built.ok) {
    await finishAttempt(admin, job, attempt, {
      success: false,
      httpStatus: 400,
      retry: "permanent",
      friendly: built.error.friendly,
      technical: built.error.technical,
      stage: "event",
      expected: built.error.expected,
    });
    return;
  }
  await admin
    .from("lead_payloads")
    .update({ mapped: { preview: built.preview, warnings: built.warnings }, fub_event: built.payload })
    .eq("lead_id", lead.id);
  await appendTimeline(admin, lead, `${built.preview.length} mapped values prepared`);

  const fub = await resolveFubAccess(admin, lead.workspace_id);
  if (!fub) {
    await finishAttempt(admin, job, attempt, {
      success: false,
      httpStatus: 401,
      retry: "permanent",
      friendly: "Follow Up Boss is not connected yet.",
      technical: "No Follow Up Boss API key is saved for this workspace.",
      stage,
    });
    return;
  }
  const client = new FollowUpBossClient(fub);
  let personId = lead.fub_person_id;

  if (stage === "event" && !personId) {
    const event = await client.createEvent(built.payload);
    await admin.from("lead_payloads").update({ fub_response: event.body ?? { status: event.status } }).eq("lead_id", lead.id);
    if (event.status === 204 || !event.personId) {
      await finishAttempt(admin, job, attempt, {
        success: false,
        httpStatus: event.status,
        retry: "permanent",
        friendly: "Follow Up Boss ignored this lead because the lead flow for this source is archived.",
        technical: "POST /v1/events returned no contact id.",
        stage: "event",
      });
      return;
    }
    personId = event.personId;
    const domain = (await getConnectionDomain(admin, lead.workspace_id)) ?? null;
    await updateLead(admin, lead.id, { fub_person_id: personId, fub_account_domain: domain, status: "processing" });
    await appendTimeline(admin, lead, `Contact #${personId} returned`);
    await recordAttempt(admin, job, attempt, "event", event.status, true, null);
    stage = Object.keys(built.personUpdates).length > 0 ? "person" : built.tags.length > 0 ? "tags" : "done";
    await admin.from("delivery_jobs").update({ stage }).eq("id", job.id);
    log.info("Lead sent to Follow Up Boss", { personId, httpStatus: event.status });
  }

  if (stage === "person" && personId && Object.keys(built.personUpdates).length > 0) {
    try {
      const update = await client.updatePerson(personId, built.personUpdates, false);
      await recordAttempt(admin, job, attempt, "person", update.status, true, null);
      stage = built.tags.length > 0 ? "tags" : "done";
      await admin.from("delivery_jobs").update({ stage }).eq("id", job.id);
    } catch (error) {
      const httpStatus = error instanceof HttpRequestError ? error.status : null;
      const explained = explainJobError(error);
      await finishAttempt(admin, job, attempt, {
        success: false,
        httpStatus,
        retry: classifyRetry({ httpStatus, networkError: httpStatus == null }),
        friendly: "The contact was created, but a follow-up detail could not be saved.",
        technical: explained.technical,
        stage: "person",
        warning: true,
      });
      return;
    }
  }

  if (stage === "tags" && personId && built.tags.length > 0) {
    try {
      const tagged = await client.mergeTags(personId, built.tags);
      await admin
        .from("lead_payloads")
        .update({ tags_request: { tags: built.tags, mergeTags: true }, tags_response: tagged.body ?? { status: tagged.status } })
        .eq("lead_id", lead.id);
      await appendTimeline(admin, lead, `${built.tags.length} tags merged`);
      await recordAttempt(admin, job, attempt, "tags", tagged.status, true, null);
      stage = "done";
    } catch (error) {
      const httpStatus = error instanceof HttpRequestError ? error.status : null;
      const explained = error instanceof HttpRequestError ? explainFubFailure(error.status, error.body) : explainJobError(error);
      await admin.from("lead_payloads").update({ tags_request: { tags: built.tags, mergeTags: true } }).eq("lead_id", lead.id);
      await finishAttempt(admin, job, attempt, {
        success: false,
        httpStatus,
        retry: classifyRetry({ httpStatus, networkError: httpStatus == null }),
        friendly: "The contact was created, but tags could not be added.",
        technical: explained.technical,
        stage: "tags",
        warning: true,
      });
      return;
    }
  }

  await updateLead(admin, lead.id, {
    status: "delivered",
    friendly_error: null,
    last_error: null,
    delivered_at: new Date().toISOString(),
  });
  await appendTimeline(admin, lead, "Completed");
  await admin.from("delivery_jobs").update({ status: "delivered", stage: "done", locked_at: null, last_error: null }).eq("id", job.id);
}

async function fetchLeadValues(admin: AdminClient, lead: LeadRow): Promise<Record<string, string>> {
  const meta = await resolveMetaAccess(admin, lead.workspace_id, null);
  const token = lead.page_id ? await pageAccessToken(admin, lead.workspace_id, lead.page_id) : meta.userAccessToken;
  if (!token) {
    throw new PermanentError("Facebook is missing a Page access token. Reconnect Facebook and refresh Pages.");
  }
  const client = new MetaClient({ version: meta.graphVersion });
  const remote = await client.getLead(lead.meta_lead_id, token);
  const form = lead.form_id
    ? ((
        await admin
          .from("meta_forms")
          .select("name")
          .eq("workspace_id", lead.workspace_id)
          .eq("form_id", lead.form_id)
          .maybeSingle()
      ).data as { name: string } | null)
    : null;
  const answers: Record<string, string> = {};
  for (const field of remote.field_data ?? []) {
    const value = field.values.map((item) => item.trim()).filter(Boolean).join(", ");
    if (value) answers[field.name] = value;
  }
  const values = leadValuesFromParts({
    answers,
    leadId: remote.id,
    createdTime: remote.created_time,
    pageId: lead.page_id,
    pageName: lead.page_name,
    formId: remote.form_id ?? lead.form_id,
    formName: form?.name ?? lead.form_name,
    campaignId: remote.campaign_id,
    campaignName: remote.campaign_name,
    adsetId: remote.adset_id ?? lead.adset_id,
    adsetName: remote.adset_name,
    adId: remote.ad_id ?? lead.ad_id,
    adName: remote.ad_name,
    platform: remote.platform,
  });
  await admin
    .from("lead_payloads")
    .update({ facebook_raw: { values, raw: remote } })
    .eq("lead_id", lead.id);
  await updateLead(admin, lead.id, {
    form_id: values.form_id ?? lead.form_id,
    form_name: values.form_name ?? lead.form_name,
    campaign_id: values.campaign_id ?? null,
    campaign_name: values.campaign_name ?? null,
    adset_id: values.adset_id ?? null,
    adset_name: values.adset_name ?? null,
    ad_id: values.ad_id ?? null,
    ad_name: values.ad_name ?? null,
    platform: values.platform ?? null,
    display_name: values.full_name || values.email || "Facebook lead",
    email: values.email ?? null,
    phone: values.phone_number || values.phone || null,
    status: "processing",
  });
  await appendTimeline(admin, lead, "Facebook lead data retrieved");
  return values;
}

async function chooseWorkflow(admin: AdminClient, lead: LeadRow) {
  if (lead.workflow_id && lead.is_test) {
    const chosen = await admin.from("workflows").select("*").eq("id", lead.workflow_id).maybeSingle();
    return (chosen.data as WorkflowRow | null) ?? null;
  }
  const result = await admin
    .from("workflows")
    .select("*")
    .eq("workspace_id", lead.workspace_id)
    .eq("status", "active")
    .eq("page_id", lead.page_id);
  const workflows = ((result.data ?? []) as WorkflowRow[]).map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    status: workflow.status,
    pageId: workflow.page_id,
    formId: workflow.form_id,
    formScope: workflow.form_scope,
    updatedAt: workflow.updated_at,
  }));
  const matched = matchWorkflow(workflows, lead.page_id ?? "", lead.form_id ?? "");
  if (!matched.workflow) return null;
  return (result.data as WorkflowRow[]).find((workflow) => workflow.id === matched.workflow?.id) ?? null;
}

async function loadBundle(admin: AdminClient, workspaceId: string, workflow: WorkflowRow) {
  const [mappings, staticValues, tags, rules, translations, fields] = await Promise.all([
    admin.from("workflow_mappings").select("*").eq("workflow_id", workflow.id).order("sort_order"),
    admin.from("workflow_static_values").select("*").eq("workflow_id", workflow.id),
    admin.from("workflow_tags").select("*").eq("workflow_id", workflow.id),
    admin.from("workflow_rules").select("*").eq("workflow_id", workflow.id).order("sort_order"),
    admin.from("workflow_translations").select("*").eq("workflow_id", workflow.id),
    admin.from("fub_fields").select("*").eq("workspace_id", workspaceId).is("removed_at", null),
  ]);
  const fieldRows = (fields.data ?? []) as Array<{
    fub_id: string | null;
    label: string;
    api_name: string;
    field_type: string;
    category: string;
    is_custom: boolean;
    is_recurring: boolean | null;
    choices: string[];
    choice_map: Record<string, string>;
    write_target: string;
  }>;
  const custom: DestinationField[] = fieldRows
    .filter((field) => field.is_custom)
    .map((field) => ({
      apiName: field.api_name,
      label: field.label,
      type: field.field_type,
      category: "Custom Fields",
      filter: "custom",
      custom: true,
      writeTarget: field.write_target,
      choices: field.choices ?? [],
      choiceMap: field.choice_map ?? {},
      isRecurring: field.is_recurring ?? undefined,
      fubId: field.fub_id ?? undefined,
    }));
  const lookups: DestinationField[] = fieldRows
    .filter((field) => !field.is_custom)
    .map((field) => ({
      apiName: field.api_name,
      label: field.label,
      type: field.field_type,
      category: field.category,
      filter: "standard",
      custom: false,
      writeTarget: field.write_target,
      choices: field.choices ?? [],
      choiceMap: field.choice_map ?? {},
    }));
  return {
    mappings: ((mappings.data ?? []) as Array<Record<string, unknown>>).map(mapMapping),
    staticValues: ((staticValues.data ?? []) as Array<Record<string, string>>).map(
      (row): StaticValue => ({
        destinationApiName: row.destination_api_name ?? "",
        destinationLabel: row.destination_label ?? "",
        value: row.value ?? "",
      }),
    ),
    tags: ((tags.data ?? []) as Array<{ kind: "static" | "dynamic"; value: string }>).map(
      (row): WorkflowTag => ({ kind: row.kind, value: row.value }),
    ),
    rules: ((rules.data ?? []) as Array<Record<string, unknown>>).map(mapRule),
    translations: ((translations.data ?? []) as Array<Record<string, string>>).map(
      (row): ValueTranslation => ({
        destinationApiName: row.destination_api_name ?? "",
        fromValue: row.from_value ?? "",
        toValue: row.to_value ?? "",
      }),
    ),
    destinations: mergeDestinationFields(custom, lookups),
  };
}

function mapMapping(row: Record<string, unknown>): FieldMapping {
  return {
    sourceKey: String(row.source_key ?? ""),
    sourceLabel: String(row.source_label ?? ""),
    sourceGroup: (row.source_group as FieldMapping["sourceGroup"]) ?? "question",
    destinationApiName: row.destination_api_name ? String(row.destination_api_name) : null,
    destinationLabel: row.destination_label ? String(row.destination_label) : null,
    transform: (row.transform as Transform) ?? { type: "none" },
    ignored: Boolean(row.ignored),
    saveToBackground: Boolean(row.save_to_background),
  };
}

function mapRule(row: Record<string, unknown>): WorkflowRule {
  return {
    id: String(row.id ?? ""),
    combinator: row.combinator === "or" ? "or" : "and",
    conditions: Array.isArray(row.conditions) ? (row.conditions as WorkflowRule["conditions"]) : [],
    tag: String(row.tag ?? ""),
  };
}

async function finishAttempt(
  admin: AdminClient,
  job: JobRow,
  attempt: number,
  input: {
    success: boolean;
    httpStatus: number | null;
    retry: "retry" | "permanent";
    friendly: string;
    technical: string;
    stage: string;
    expected?: string[];
    warning?: boolean;
  },
) {
  await recordAttempt(admin, job, attempt, input.stage, input.httpStatus, false, input.technical);
  const exhausted = input.retry === "permanent" || attempt >= job.max_attempts;
  const next = exhausted ? null : nextRetryAt(attempt);
  const leadStatus: LeadStatus = input.warning
    ? exhausted
      ? "delivered_with_warning"
      : "retrying"
    : exhausted
      ? "failed"
      : "retrying";
  await updateLead(admin, job.lead_id, {
    status: leadStatus,
    friendly_error: input.expected?.length
      ? `${input.friendly} Expected: ${input.expected.join(", ")}.`
      : input.friendly,
    last_error: input.technical,
  });
  await appendTimeline(admin, { id: job.lead_id, workspace_id: job.workspace_id } as LeadRow, input.friendly);
  await admin
    .from("delivery_jobs")
    .update({
      status: exhausted ? (input.warning ? "delivered_with_warning" : "failed") : "retrying",
      stage: input.stage,
      locked_at: null,
      next_run_at: next ? next.toISOString() : new Date().toISOString(),
      last_error: input.technical,
      last_http_status: input.httpStatus,
      safe_response_summary: input.technical.slice(0, 500),
    })
    .eq("id", job.id);
}

async function recordAttempt(
  admin: AdminClient,
  job: JobRow,
  attempt: number,
  stage: string,
  httpStatus: number | null,
  success: boolean,
  errorSummary: string | null,
) {
  await admin.from("delivery_attempts").insert({
    workspace_id: job.workspace_id,
    job_id: job.id,
    lead_id: job.lead_id,
    attempt_number: attempt,
    stage,
    http_status: httpStatus,
    success,
    error_summary: errorSummary,
    safe_response: errorSummary ? { summary: safeResponseSummary(errorSummary) } : null,
  });
}

async function updateLead(admin: AdminClient, leadId: string, patch: Record<string, unknown>) {
  await admin.from("leads").update(patch).eq("id", leadId);
}

async function appendTimeline(admin: AdminClient, lead: Pick<LeadRow, "id" | "workspace_id">, label: string) {
  const current = await admin.from("lead_payloads").select("timeline").eq("lead_id", lead.id).maybeSingle();
  const timeline = ((current.data as { timeline?: Array<{ at: string; label: string }> } | null)?.timeline ?? []).concat({
    at: new Date().toISOString(),
    label,
  });
  await admin.from("lead_payloads").update({ timeline }).eq("lead_id", lead.id);
}

async function getConnectionDomain(admin: AdminClient, workspaceId: string) {
  const result = await admin
    .from("connections")
    .select("public_config")
    .eq("workspace_id", workspaceId)
    .eq("provider", "follow_up_boss")
    .maybeSingle();
  const config = (result.data as { public_config?: { domain?: string } } | null)?.public_config;
  return config?.domain;
}

function explainJobError(error: unknown): { friendly: string; technical: string } {
  if (error instanceof PermanentError) return { friendly: error.message, technical: error.message };
  if (error instanceof HttpRequestError) return explainFubFailure(error.status, error.body);
  return metaErrorMessage(error);
}

class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

export async function retryLeadDelivery(admin: AdminClient, workspaceId: string, leadId: string, actorId: string) {
  const leadResult = await admin.from("leads").select("*").eq("id", leadId).eq("workspace_id", workspaceId).single();
  const lead = leadResult.data as LeadRow | null;
  if (!lead) return { ok: false as const, error: "That lead could not be found." };
  if (lead.is_demo) return { ok: false as const, error: "Demo leads are not sent to Follow Up Boss." };
  const stage = lead.fub_person_id ? "tags" : "fetch";
  const jobResult = await admin.from("delivery_jobs").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const job = jobResult.data as JobRow | null;
  if (job) {
    await admin
      .from("delivery_jobs")
      .update({ status: "queued", stage: lead.fub_person_id && job.stage === "tags" ? "tags" : stage === "tags" ? "person" : "fetch", next_run_at: new Date().toISOString(), locked_at: null, attempt_count: 0 })
      .eq("id", job.id);
  } else {
    await admin.from("delivery_jobs").insert({
      workspace_id: workspaceId,
      lead_id: lead.id,
      status: "queued",
      stage: "fetch",
      next_run_at: new Date().toISOString(),
    });
  }
  await updateLead(admin, lead.id, { status: "queued", friendly_error: null });
  await recordActivity(admin, {
    workspaceId,
    actorId,
    action: "lead.retried",
    summary: "A failed delivery was queued again.",
    entityType: "lead",
    entityId: lead.id,
  });
  await processDueJobs(3);
  return { ok: true as const };
}
