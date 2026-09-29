"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { mergeDestinationFields } from "@/lib/follow-up-boss/catalog";
import { MetaClient } from "@/lib/meta/client";
import { isDemoModeEnabled } from "@/lib/env";
import { allowRequest, recordActivity, requireWorkspace } from "@/server/session";
import { demoForms, demoPages, demoQuestions, demoSampleValues, isDemoIdentifier } from "@/services/demo/fixtures";
import { buildFubPayload } from "@/services/mapping/payload";
import { sourceFieldsForQuestions } from "@/services/mapping/sources";
import { activationConflicts } from "@/services/mapping/workflow-match";
import { pageAccessToken, resolveFubAccess, resolveMetaAccess } from "@/services/connections/store";
import { processDueJobs } from "@/services/leads/pipeline";
import type { DestinationField, FieldMapping, SourceField, WorkflowRule } from "@/types/domain";
import { FUB_EVENT_TYPES } from "@/types/domain";
import type { WorkflowDraft } from "@/types/workflow";

export async function createWorkflow() {
  const ctx = await requireWorkspace();
  const inserted = await ctx.admin
    .from("workflows")
    .insert({
      workspace_id: ctx.workspaceId,
      name: "New workflow",
      status: "draft",
      event_type: ctx.defaultEventType,
      system_name: "Leadpath",
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) throw new Error("The workflow could not be created.");
  const id = (inserted.data as { id: string }).id;
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "workflow.created",
    summary: "A workflow draft was created.",
    entityType: "workflow",
    entityId: id,
  });
  redirect(`/workflows/${id}`);
}

export async function saveWorkflow(draft: WorkflowDraft) {
  const ctx = await requireWorkspace();
  const owned = await ctx.admin.from("workflows").select("id").eq("id", draft.id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!owned.data) return { ok: false as const, error: "That workflow could not be found." };
  if (!FUB_EVENT_TYPES.includes(draft.eventType as (typeof FUB_EVENT_TYPES)[number]) && draft.eventType !== "General Inquiry") {
    return { ok: false as const, error: "Choose a Follow Up Boss lead type from the list." };
  }
  await ctx.admin
    .from("workflows")
    .update({
      name: draft.name.trim() || "Untitled workflow",
      page_id: draft.pageId,
      page_name: draft.pageName,
      form_id: draft.formScope === "any" ? null : draft.formId,
      form_name: draft.formScope === "any" ? "Any form" : draft.formName,
      form_scope: draft.formScope,
      event_type: draft.eventType || "General Inquiry",
      source_name: draft.sourceName || "Facebook",
      campaign_source: draft.campaignSource || "Facebook",
      system_name: draft.systemName || "Leadpath",
      is_demo: draft.isDemo || isDemoIdentifier(draft.pageId),
    })
    .eq("id", draft.id)
    .eq("workspace_id", ctx.workspaceId);

  await ctx.admin.from("workflow_mappings").delete().eq("workflow_id", draft.id);
  await ctx.admin.from("workflow_static_values").delete().eq("workflow_id", draft.id);
  await ctx.admin.from("workflow_tags").delete().eq("workflow_id", draft.id);
  await ctx.admin.from("workflow_rules").delete().eq("workflow_id", draft.id);
  await ctx.admin.from("workflow_translations").delete().eq("workflow_id", draft.id);

  if (draft.mappings.length) {
    await ctx.admin.from("workflow_mappings").insert(
      draft.mappings.map((mapping, index) => ({
        workspace_id: ctx.workspaceId,
        workflow_id: draft.id,
        source_key: mapping.sourceKey,
        source_label: mapping.sourceLabel,
        source_group: mapping.sourceGroup,
        destination_api_name: mapping.destinationApiName,
        destination_label: mapping.destinationLabel,
        transform: mapping.transform,
        ignored: mapping.ignored,
        save_to_background: mapping.saveToBackground,
        sort_order: index,
      })),
    );
  }
  if (draft.staticValues.length) {
    await ctx.admin.from("workflow_static_values").insert(
      draft.staticValues
        .filter((value) => value.destinationApiName && value.value.trim())
        .map((value) => ({
          workspace_id: ctx.workspaceId,
          workflow_id: draft.id,
          destination_api_name: value.destinationApiName,
          destination_label: value.destinationLabel,
          value: value.value,
        })),
    );
  }
  if (draft.tags.length) {
    await ctx.admin.from("workflow_tags").insert(
      draft.tags
        .filter((tag) => tag.value.trim())
        .map((tag) => ({ workspace_id: ctx.workspaceId, workflow_id: draft.id, kind: tag.kind, value: tag.value.trim() })),
    );
  }
  if (draft.rules.length) {
    await ctx.admin.from("workflow_rules").insert(
      draft.rules.map((rule, index) => ({
        workspace_id: ctx.workspaceId,
        workflow_id: draft.id,
        combinator: rule.combinator,
        conditions: rule.conditions,
        tag: rule.tag,
        sort_order: index,
      })),
    );
  }
  if (draft.translations.length) {
    await ctx.admin.from("workflow_translations").insert(
      draft.translations
        .filter((item) => item.fromValue.trim() && item.toValue.trim())
        .map((item) => ({
          workspace_id: ctx.workspaceId,
          workflow_id: draft.id,
          destination_api_name: item.destinationApiName,
          from_value: item.fromValue,
          to_value: item.toValue,
        })),
    );
  }
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "workflow.mapping_changed",
    summary: `“${draft.name}” was saved.`,
    entityType: "workflow",
    entityId: draft.id,
  });
  revalidatePath(`/workflows/${draft.id}`);
  return { ok: true as const };
}

export async function setWorkflowStatus(id: string, status: "active" | "paused" | "draft") {
  const ctx = await requireWorkspace();
  const current = await loadDraft(id);
  if (!current) return { ok: false as const, error: "That workflow could not be found." };
  if (status === "active") {
    if (!current.pageId) return { ok: false as const, error: "Choose a Facebook Page before turning this workflow on." };
    if (current.formScope === "specific" && !current.formId) {
      return { ok: false as const, error: "Choose a lead form, or use any form on the Page." };
    }
    const others = await ctx.admin.from("workflows").select("*").eq("workspace_id", ctx.workspaceId);
    const conflicts = activationConflicts(
      {
        id,
        name: current.name,
        status: "active",
        pageId: current.pageId,
        formId: current.formId,
        formScope: current.formScope,
        updatedAt: new Date().toISOString(),
      },
      ((others.data ?? []) as Array<Record<string, string | null>>).map((workflow) => ({
        id: String(workflow.id),
        name: String(workflow.name),
        status: workflow.status as "draft" | "active" | "paused",
        pageId: workflow.page_id,
        formId: workflow.form_id,
        formScope: workflow.form_scope === "any" ? "any" : "specific",
        updatedAt: String(workflow.updated_at ?? ""),
      })),
    );
    if (conflicts.blockers.length) return { ok: false as const, error: conflicts.blockers[0] ?? "Another workflow is already active." };
  }
  await ctx.admin.from("workflows").update({ status }).eq("id", id).eq("workspace_id", ctx.workspaceId);
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: status === "active" ? "workflow.activated" : "workflow.paused",
    summary: status === "active" ? `“${current.name}” was turned on.` : `“${current.name}” was paused.`,
    entityType: "workflow",
    entityId: id,
  });
  revalidatePath("/workflows");
  return { ok: true as const, warnings: status === "active" ? await conflictWarnings(ctx.workspaceId, current) : [] };
}

export async function duplicateWorkflow(id: string) {
  const ctx = await requireWorkspace();
  const draft = await loadDraft(id);
  if (!draft) return { ok: false as const, error: "That workflow could not be found." };
  const inserted = await ctx.admin
    .from("workflows")
    .insert({
      workspace_id: ctx.workspaceId,
      name: `Copy of ${draft.name}`,
      status: "draft",
      page_id: draft.pageId,
      page_name: draft.pageName,
      form_id: draft.formId,
      form_name: draft.formName,
      form_scope: draft.formScope,
      event_type: draft.eventType,
      source_name: draft.sourceName,
      campaign_source: draft.campaignSource,
      system_name: draft.systemName,
      is_demo: draft.isDemo,
    })
    .select("id")
    .single();
  const copyId = (inserted.data as { id: string }).id;
  await saveWorkflow({ ...draft, id: copyId, name: `Copy of ${draft.name}`, status: "draft" });
  redirect(`/workflows/${copyId}`);
}

export async function deleteWorkflow(id: string) {
  const ctx = await requireWorkspace();
  await ctx.admin.from("workflows").delete().eq("id", id).eq("workspace_id", ctx.workspaceId);
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "workflow.deleted",
    summary: "A workflow was deleted.",
    entityType: "workflow",
    entityId: id,
  });
  redirect("/workflows");
}

export async function listPageChoices() {
  const ctx = await requireWorkspace();
  const result = await ctx.admin.from("meta_pages").select("page_id, name, is_demo").eq("workspace_id", ctx.workspaceId).order("name");
  const pages = ((result.data ?? []) as Array<{ page_id: string; name: string; is_demo: boolean }>).map((page) => ({
    id: page.page_id,
    name: page.name,
    isDemo: page.is_demo,
  }));
  if (pages.length === 0 && (ctx.demoMode || isDemoModeEnabled())) return demoPages;
  return pages;
}

export async function listFormChoices(pageId: string) {
  const ctx = await requireWorkspace();
  if (isDemoIdentifier(pageId)) {
    return demoForms.filter((form) => form.pageId === pageId).map((form) => ({
      id: form.id,
      name: form.name,
      status: form.status,
      updatedAt: form.updatedAt,
      fieldCount: form.fieldCount,
      isDemo: true,
    }));
  }
  const cached = await ctx.admin.from("meta_forms").select("*").eq("workspace_id", ctx.workspaceId).eq("page_id", pageId);
  const forms = ((cached.data ?? []) as Array<Record<string, string | number | null>>).map((form) => ({
    id: String(form.form_id),
    name: String(form.name),
    status: form.status ? String(form.status) : undefined,
    updatedAt: form.meta_updated_time ? String(form.meta_updated_time) : undefined,
    fieldCount: Number(form.field_count ?? 0),
    isDemo: false,
  }));
  if (forms.length > 0) return forms;
  const meta = await resolveMetaAccess(ctx.admin, ctx.workspaceId, ctx.metaGraphVersion);
  const token = await pageAccessToken(ctx.admin, ctx.workspaceId, pageId);
  if (!token) return [];
  const client = new MetaClient({ version: meta.graphVersion });
  const remote = await client.listForms(pageId, token);
  return remote.map((form) => ({
    id: form.id,
    name: form.name,
    status: form.status,
    updatedAt: form.created_time,
    fieldCount: form.questions?.length ?? 0,
    isDemo: false,
  }));
}

export async function loadFormSourceFields(pageId: string, formId: string): Promise<SourceField[]> {
  const ctx = await requireWorkspace();
  if (isDemoIdentifier(formId)) return [...demoQuestions, ...sourceFieldsForQuestions([]).filter((field) => field.group !== "contact" && field.group !== "question")];
  const stored = await ctx.admin
    .from("meta_form_fields")
    .select("field_key, label")
    .eq("workspace_id", ctx.workspaceId)
    .eq("form_id", formId)
    .order("sort_order");
  const rows = (stored.data ?? []) as Array<{ field_key: string; label: string }>;
  if (rows.length > 0) return sourceFieldsForQuestions(rows.map((row) => ({ key: row.field_key, label: row.label })));
  const meta = await resolveMetaAccess(ctx.admin, ctx.workspaceId, ctx.metaGraphVersion);
  const token = await pageAccessToken(ctx.admin, ctx.workspaceId, pageId);
  if (!token) return sourceFieldsForQuestions([]);
  const form = await new MetaClient({ version: meta.graphVersion }).getForm(formId, token);
  return sourceFieldsForQuestions((form.questions ?? []).map((question) => ({ key: question.key, label: question.label })));
}

export async function destinationCatalog(): Promise<DestinationField[]> {
  const ctx = await requireWorkspace();
  const result = await ctx.admin.from("fub_fields").select("*").eq("workspace_id", ctx.workspaceId).is("removed_at", null);
  const rows = (result.data ?? []) as Array<{
    api_name: string;
    label: string;
    field_type: string;
    category: string;
    is_custom: boolean;
    choices: string[] | null;
    choice_map: Record<string, string> | null;
    write_target: string;
    is_recurring: boolean | null;
    fub_id: string | null;
  }>;
  const custom = rows
    .filter((row) => row.is_custom)
    .map((row) => ({
      apiName: row.api_name,
      label: row.label,
      type: row.field_type,
      category: "Custom Fields",
      filter: "custom" as const,
      custom: true,
      writeTarget: row.write_target,
      choices: row.choices ?? [],
      choiceMap: row.choice_map ?? {},
      isRecurring: row.is_recurring ?? undefined,
      fubId: row.fub_id ?? undefined,
    }));
  const lookups = rows
    .filter((row) => !row.is_custom)
    .map((row) => ({
      apiName: row.api_name,
      label: row.label,
      type: row.field_type,
      category: row.category,
      filter: "standard" as const,
      custom: false,
      writeTarget: row.write_target,
      choices: row.choices ?? [],
      choiceMap: row.choice_map ?? {},
    }));
  const merged = mergeDestinationFields(custom, lookups);
  if (custom.length === 0 && (ctx.demoMode || isDemoModeEnabled())) {
    return mergeDestinationFields(
      [
        { apiName: "customProject", label: "Project", type: "text", category: "Custom Fields", filter: "custom", custom: true, writeTarget: "event.person.custom", choices: [] },
        { apiName: "customPreferredCity", label: "Preferred City", type: "text", category: "Custom Fields", filter: "custom", custom: true, writeTarget: "event.person.custom", choices: [] },
        { apiName: "customBuyerTimeframe", label: "Buyer Timeframe", type: "dropdown", category: "Custom Fields", filter: "custom", custom: true, writeTarget: "event.person.custom", choices: ["0-3 Months", "3-6 Months", "6-12 Months", "Exploring"] },
        { apiName: "customWorkingWithRealtor", label: "Working With Realtor", type: "dropdown", category: "Custom Fields", filter: "custom", custom: true, writeTarget: "event.person.custom", choices: ["Yes", "No"] },
        { apiName: "customPropertyType", label: "Property Type", type: "dropdown", category: "Custom Fields", filter: "custom", custom: true, writeTarget: "event.person.custom", choices: ["Condo", "Townhouse", "Detached"] },
      ],
      lookups,
    );
  }
  return merged;
}

export async function previewWorkflow(draft: WorkflowDraft, values: Record<string, string>) {
  const destinations = await destinationCatalog();
  return buildFubPayload({
    values,
    mappings: draft.mappings,
    staticValues: draft.staticValues,
    tags: draft.tags,
    rules: draft.rules,
    translations: draft.translations,
    destinations,
    sourceName: draft.sourceName || "Facebook",
    systemName: draft.systemName || "Leadpath",
    eventType: draft.eventType || "General Inquiry",
    campaignSource: draft.campaignSource || "Facebook",
  });
}

export async function sendWorkflowTest(draft: WorkflowDraft, values: Record<string, string>, confirmReplay: boolean) {
  const ctx = await requireWorkspace();
  if (!(await allowRequest(ctx.admin, `test:${ctx.userId}`, 10, 60_000))) {
    return { ok: false as const, error: "Please wait a moment before sending another test." };
  }
  await saveWorkflow(draft);
  const preview = await previewWorkflow(draft, values);
  if (!preview.ok) return { ok: false as const, error: preview.error.friendly, technical: preview.error.technical, expected: preview.error.expected };
  if (draft.isDemo || isDemoIdentifier(draft.pageId) || isDemoIdentifier(values.lead_id)) {
    return {
      ok: true as const,
      demo: true,
      preview: preview.preview,
      payload: preview.payload,
      tags: preview.tags,
      message: "This is demo data, so it was not sent to Follow Up Boss.",
    };
  }
  const recent = await ctx.admin
    .from("leads")
    .select("id, received_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("workflow_id", draft.id)
    .eq("is_test", true)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const recentRow = recent.data as { received_at: string } | null;
  if (recentRow && !confirmReplay && Date.now() - new Date(recentRow.received_at).getTime() < 60 * 60 * 1000) {
    return { ok: false as const, needsConfirmation: true, error: "A test was already sent for this workflow in the last hour. Send it again only if you mean to." };
  }
  const credentials = await resolveFubAccess(ctx.admin, ctx.workspaceId);
  if (!credentials) return { ok: false as const, error: "Connect Follow Up Boss before sending a test." };
  const metaLeadId = `test:${draft.id}:${crypto.randomUUID()}`;
  const correlationId = crypto.randomUUID();
  const inserted = await ctx.admin
    .from("leads")
    .insert({
      workspace_id: ctx.workspaceId,
      workflow_id: draft.id,
      meta_lead_id: metaLeadId,
      page_id: draft.pageId,
      page_name: draft.pageName,
      form_id: draft.formId,
      form_name: draft.formName,
      campaign_name: values.campaign_name ?? null,
      display_name: values.full_name || values.email || "Test lead",
      email: values.email ?? null,
      phone: values.phone_number || values.phone || null,
      status: "queued",
      is_test: true,
      is_demo: false,
      correlation_id: correlationId,
    })
    .select("id")
    .single();
  const leadId = (inserted.data as { id: string }).id;
  await ctx.admin.from("lead_payloads").insert({
    workspace_id: ctx.workspaceId,
    lead_id: leadId,
    facebook_raw: { values },
    timeline: [{ at: new Date().toISOString(), label: "Test lead prepared" }],
  });
  await ctx.admin.from("delivery_jobs").insert({
    workspace_id: ctx.workspaceId,
    lead_id: leadId,
    status: "queued",
    stage: "event",
    next_run_at: new Date().toISOString(),
    max_attempts: ctx.maxDeliveryAttempts,
  });
  await processDueJobs(2);
  const lead = await ctx.admin.from("leads").select("status, fub_person_id, friendly_error, last_error").eq("id", leadId).single();
  const row = lead.data as { status: string; fub_person_id: string | null; friendly_error: string | null; last_error: string | null };
  const payload = await ctx.admin.from("lead_payloads").select("fub_event, fub_response, tags_response").eq("lead_id", leadId).single();
  return {
    ok: row.status === "delivered" || row.status === "delivered_with_warning",
    demo: false,
    status: row.status,
    personId: row.fub_person_id,
    message: row.friendly_error,
    technical: row.last_error,
    preview: preview.preview,
    payload: (payload.data as { fub_event?: unknown } | null)?.fub_event ?? preview.payload,
    response: (payload.data as { fub_response?: unknown } | null)?.fub_response ?? null,
    tagsResult: (payload.data as { tags_response?: unknown } | null)?.tags_response ?? null,
    tags: preview.tags,
  };
}

export async function sampleLeadValues(workflowId: string) {
  const ctx = await requireWorkspace();
  const workflow = await ctx.admin.from("workflows").select("form_id, is_demo, page_id").eq("id", workflowId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  const row = workflow.data as { form_id: string | null; is_demo: boolean; page_id: string | null } | null;
  if (!row || row.is_demo || isDemoIdentifier(row.page_id)) return { demo: true, values: demoSampleValues, label: "John Smith" };
  const leads = await ctx.admin
    .from("leads")
    .select("id, display_name, email, received_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("is_demo", false)
    .order("received_at", { ascending: false })
    .limit(8);
  return {
    demo: false,
    values: null,
    leads: (leads.data ?? []) as Array<{ id: string; display_name: string | null; email: string | null; received_at: string }>,
  };
}

export async function leadValuesForTest(leadId: string) {
  const ctx = await requireWorkspace();
  const payload = await ctx.admin
    .from("lead_payloads")
    .select("facebook_raw, leads!inner(workspace_id)")
    .eq("lead_id", leadId)
    .maybeSingle();
  const row = payload.data as { facebook_raw?: { values?: Record<string, string> }; leads?: { workspace_id: string } } | null;
  if (!row || row.leads?.workspace_id !== ctx.workspaceId) return null;
  return row.facebook_raw?.values ?? null;
}

async function loadDraft(id: string): Promise<WorkflowDraft | null> {
  const ctx = await requireWorkspace();
  const result = await ctx.admin.from("workflows").select("*").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  const workflow = result.data as Record<string, string | null> | null;
  if (!workflow) return null;
  const [mappings, staticValues, tags, rules, translations] = await Promise.all([
    ctx.admin.from("workflow_mappings").select("*").eq("workflow_id", id).order("sort_order"),
    ctx.admin.from("workflow_static_values").select("*").eq("workflow_id", id),
    ctx.admin.from("workflow_tags").select("*").eq("workflow_id", id),
    ctx.admin.from("workflow_rules").select("*").eq("workflow_id", id).order("sort_order"),
    ctx.admin.from("workflow_translations").select("*").eq("workflow_id", id),
  ]);
  return {
    id,
    name: String(workflow.name),
    status: (workflow.status as WorkflowDraft["status"]) ?? "draft",
    pageId: workflow.page_id,
    pageName: workflow.page_name,
    formId: workflow.form_id,
    formName: workflow.form_name,
    formScope: workflow.form_scope === "any" ? "any" : "specific",
    eventType: String(workflow.event_type ?? "General Inquiry"),
    sourceName: String(workflow.source_name ?? "Facebook"),
    campaignSource: String(workflow.campaign_source ?? "Facebook"),
    systemName: String(workflow.system_name ?? "Leadpath"),
    isDemo: Boolean(workflow.is_demo),
    mappings: ((mappings.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      sourceKey: String(row.source_key),
      sourceLabel: String(row.source_label),
      sourceGroup: row.source_group as FieldMapping["sourceGroup"],
      destinationApiName: row.destination_api_name ? String(row.destination_api_name) : null,
      destinationLabel: row.destination_label ? String(row.destination_label) : null,
      transform: (row.transform as FieldMapping["transform"]) ?? { type: "none" },
      ignored: Boolean(row.ignored),
      saveToBackground: Boolean(row.save_to_background),
    })),
    staticValues: ((staticValues.data ?? []) as Array<Record<string, string>>).map((row) => ({
      destinationApiName: row.destination_api_name ?? "",
      destinationLabel: row.destination_label ?? "",
      value: row.value ?? "",
    })),
    tags: ((tags.data ?? []) as Array<{ kind: "static" | "dynamic"; value: string }>).map((row) => ({ kind: row.kind, value: row.value })),
    rules: ((rules.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      combinator: row.combinator === "or" ? "or" as const : "and" as const,
      conditions: Array.isArray(row.conditions) ? (row.conditions as WorkflowRule["conditions"]) : [],
      tag: String(row.tag ?? ""),
    })),
    translations: ((translations.data ?? []) as Array<Record<string, string>>).map((row) => ({
      destinationApiName: row.destination_api_name ?? "",
      fromValue: row.from_value ?? "",
      toValue: row.to_value ?? "",
    })),
  };
}

export async function getWorkflowDraft(id: string) {
  return loadDraft(id);
}

async function conflictWarnings(workspaceId: string, current: WorkflowDraft) {
  const ctx = await requireWorkspace();
  void workspaceId;
  const others = await ctx.admin.from("workflows").select("*").eq("workspace_id", ctx.workspaceId);
  return activationConflicts(
    {
      id: current.id,
      name: current.name,
      status: "active",
      pageId: current.pageId,
      formId: current.formId,
      formScope: current.formScope,
      updatedAt: new Date().toISOString(),
    },
    ((others.data ?? []) as Array<Record<string, string | null>>).map((workflow) => ({
      id: String(workflow.id),
      name: String(workflow.name),
      status: workflow.status as "draft" | "active" | "paused",
      pageId: workflow.page_id,
      formId: workflow.form_id,
      formScope: workflow.form_scope === "any" ? "any" : "specific",
      updatedAt: String(workflow.updated_at ?? ""),
    })),
  ).warnings;
}

export async function retryLead(leadId: string) {
  const ctx = await requireWorkspace();
  if (!(await allowRequest(ctx.admin, `retry:${ctx.userId}`, 20, 60_000))) {
    return { ok: false as const, error: "Please wait a moment before retrying again." };
  }
  const { retryLeadDelivery } = await import("@/services/leads/pipeline");
  return retryLeadDelivery(ctx.admin, ctx.workspaceId, leadId, ctx.userId);
}
