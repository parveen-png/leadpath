import "server-only";

import { fubPersonUrl } from "@/lib/follow-up-boss/client";
import { requireWorkspace } from "@/server/session";
import { getConnection, toPublicConnection } from "@/services/connections/store";

export async function dashboardData() {
  const ctx = await requireWorkspace();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [meta, fub, workflows, leads, errors] = await Promise.all([
    getConnection(ctx.admin, ctx.workspaceId, "meta"),
    getConnection(ctx.admin, ctx.workspaceId, "follow_up_boss"),
    ctx.admin.from("workflows").select("id, name, status, page_name, form_name").eq("workspace_id", ctx.workspaceId).order("updated_at", { ascending: false }),
    ctx.admin
      .from("leads")
      .select("id, display_name, email, form_name, status, received_at, is_test, is_demo, friendly_error")
      .eq("workspace_id", ctx.workspaceId)
      .eq("is_demo", false)
      .order("received_at", { ascending: false })
      .limit(8),
    ctx.admin
      .from("leads")
      .select("id, display_name, friendly_error, received_at, status")
      .eq("workspace_id", ctx.workspaceId)
      .in("status", ["failed", "retrying", "delivered_with_warning"])
      .order("received_at", { ascending: false })
      .limit(5),
  ]);
  const today = await ctx.admin
    .from("leads")
    .select("status")
    .eq("workspace_id", ctx.workspaceId)
    .eq("is_test", false)
    .eq("is_demo", false)
    .gte("received_at", start.toISOString());
  const rows = (today.data ?? []) as Array<{ status: string }>;
  const workflowRows = (workflows.data ?? []) as Array<{ id: string; name: string; status: string; page_name: string | null; form_name: string | null }>;
  return {
    ctx,
    meta: toPublicConnection(meta, "meta"),
    fub: toPublicConnection(fub, "follow_up_boss"),
    workflows: workflowRows,
    activeWorkflows: workflowRows.filter((workflow) => workflow.status === "active").length,
    leads: (leads.data ?? []) as Array<{ id: string; display_name: string | null; email: string | null; form_name: string | null; status: string; received_at: string; is_test: boolean; friendly_error: string | null }>,
    errors: (errors.data ?? []) as Array<{ id: string; display_name: string | null; friendly_error: string | null; received_at: string; status: string }>,
    today: {
      total: rows.length,
      delivered: rows.filter((row) => row.status === "delivered" || row.status === "delivered_with_warning").length,
      failed: rows.filter((row) => row.status === "failed").length,
    },
    lastLead: ((leads.data ?? []) as Array<{ received_at: string }>)[0]?.received_at ?? null,
  };
}

export async function workflowCards() {
  const ctx = await requireWorkspace();
  const result = await ctx.admin.from("workflows").select("*").eq("workspace_id", ctx.workspaceId).order("updated_at", { ascending: false });
  const workflows = (result.data ?? []) as Array<Record<string, string | null>>;
  const cards = [];
  for (const workflow of workflows) {
    const leads = await ctx.admin.from("leads").select("status, received_at").eq("workflow_id", workflow.id).eq("is_test", false).eq("is_demo", false);
    const rows = (leads.data ?? []) as Array<{ status: string; received_at: string }>;
    const delivered = rows.filter((row) => row.status === "delivered" || row.status === "delivered_with_warning").length;
    const finished = rows.filter((row) => ["delivered", "delivered_with_warning", "failed"].includes(row.status)).length;
    cards.push({
      id: String(workflow.id),
      name: String(workflow.name),
      pageName: workflow.page_name,
      formName: workflow.form_name,
      status: String(workflow.status),
      leads: rows.length,
      success: finished === 0 ? null : Math.round((delivered / finished) * 1000) / 10,
      lastLead: rows.sort((a, b) => b.received_at.localeCompare(a.received_at))[0]?.received_at ?? null,
    });
  }
  return cards;
}

export async function leadInbox(filters: { status?: string; q?: string; range?: string }) {
  const ctx = await requireWorkspace();
  let query = ctx.admin
    .from("leads")
    .select("id, display_name, email, phone, form_name, campaign_name, status, fub_person_id, received_at, is_test, workflow_id, meta_lead_id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("is_demo", false)
    .order("received_at", { ascending: false })
    .limit(100);
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.range === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    query = query.gte("received_at", start.toISOString());
  }
  if (filters.range === "7d") {
    query = query.gte("received_at", new Date(Date.now() - 7 * 86400000).toISOString());
  }
  const result = await query;
  const workflows = await ctx.admin.from("workflows").select("id, name").eq("workspace_id", ctx.workspaceId);
  const names = new Map(((workflows.data ?? []) as Array<{ id: string; name: string }>).map((workflow) => [workflow.id, workflow.name]));
  const q = filters.q?.trim().toLowerCase();
  const leads = ((result.data ?? []) as Array<Record<string, string | null | boolean>>).filter((lead) => {
    if (!q) return true;
    return [lead.display_name, lead.email, lead.phone, lead.meta_lead_id, lead.fub_person_id].some((value) => String(value ?? "").toLowerCase().includes(q));
  });
  return { leads, names };
}

export async function leadDetail(id: string) {
  const ctx = await requireWorkspace();
  const leadResult = await ctx.admin.from("leads").select("*").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  const lead = leadResult.data as Record<string, string | null | boolean> | null;
  if (!lead) return null;
  const payload = await ctx.admin.from("lead_payloads").select("*").eq("lead_id", id).maybeSingle();
  const attempts = await ctx.admin.from("delivery_attempts").select("*").eq("lead_id", id).order("created_at");
  const workflow = lead.workflow_id
    ? await ctx.admin.from("workflows").select("name").eq("id", lead.workflow_id).maybeSingle()
    : { data: null };
  return {
    lead,
    payload: payload.data as Record<string, unknown> | null,
    attempts: (attempts.data ?? []) as Array<Record<string, string | number | boolean | null>>,
    workflowName: (workflow.data as { name?: string } | null)?.name ?? null,
    fubUrl: fubPersonUrl(typeof lead.fub_account_domain === "string" ? lead.fub_account_domain : null, typeof lead.fub_person_id === "string" ? lead.fub_person_id : null),
  };
}

export async function activityFeed() {
  const ctx = await requireWorkspace();
  const result = await ctx.admin.from("activity_logs").select("*").eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false }).limit(100);
  return (result.data ?? []) as Array<{ id: string; action: string; summary: string; created_at: string; entity_type: string | null }>;
}

export async function storedFields() {
  const ctx = await requireWorkspace();
  const result = await ctx.admin.from("fub_fields").select("*").eq("workspace_id", ctx.workspaceId).is("removed_at", null).order("label");
  return {
    custom: (result.data ?? []) as Array<Record<string, unknown>>,
    syncedAt: ((result.data ?? []) as Array<{ synced_at?: string }>)[0]?.synced_at ?? null,
  };
}
