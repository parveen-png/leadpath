import "server-only";

import { redirect } from "next/navigation";

import { createAdminClient, type AdminClient } from "@/lib/database/admin";
import { createUserClient } from "@/lib/database/user";
import { hasPasscodeSession } from "@/server/passcode";

export class DatabaseNotReady extends Error {
  constructor(message = "Database tables are not ready.") {
    super(message);
    this.name = "DatabaseNotReady";
  }
}

export type WorkspaceContext = {
  admin: AdminClient;
  userId: string;
  email: string;
  fullName: string;
  workspaceId: string;
  workspaceName: string;
  timezone: string;
  metaGraphVersion: string | null;
  defaultEventType: string;
  demoMode: boolean;
  maxDeliveryAttempts: number;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  workspace_id: string;
};

type WorkspaceRow = {
  id: string;
  name: string;
  timezone: string;
  meta_graph_version: string | null;
  default_event_type: string;
  demo_mode: boolean;
  max_delivery_attempts: number;
};

export async function requireWorkspace(): Promise<WorkspaceContext> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) {
    await ensureOwnerWorkspace(data.user);
    const profileResult = await supabase
      .from("profiles")
      .select("id, full_name, email, workspace_id")
      .eq("id", data.user.id)
      .single();
    const profile = profileResult.data as ProfileRow | null;
    if (profile) {
      const workspaceResult = await supabase.from("workspaces").select("*").eq("id", profile.workspace_id).single();
      const workspace = workspaceResult.data as WorkspaceRow | null;
      if (workspace) return workspaceContext(createAdminClient(), data.user.id, profile, workspace);
    }
  }
  if (!(await hasPasscodeSession())) redirect("/login");
  return passcodeWorkspace();
}

async function passcodeWorkspace(): Promise<WorkspaceContext> {
  const admin = createAdminClient();
  const found = await admin.from("workspaces").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (found.error) throw new DatabaseNotReady(found.error.message);
  let workspace = found.data as WorkspaceRow | null;
  if (!workspace) {
    const inserted = await admin.from("workspaces").insert({ name: "Team Arora" }).select("*").single();
    if (inserted.error || !inserted.data) throw new DatabaseNotReady(inserted.error?.message ?? "The workspace could not be created.");
    workspace = inserted.data as WorkspaceRow;
  }
  return workspaceContext(admin, workspace.id, { id: workspace.id, full_name: "Team Arora", email: null, workspace_id: workspace.id }, workspace);
}

function workspaceContext(
  admin: AdminClient,
  userId: string,
  profile: ProfileRow,
  workspace: WorkspaceRow,
): WorkspaceContext {
  return {
    admin,
    userId,
    email: profile.email ?? "",
    fullName: profile.full_name ?? "Team Arora",
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    timezone: workspace.timezone,
    metaGraphVersion: workspace.meta_graph_version,
    defaultEventType: workspace.default_event_type,
    demoMode: workspace.demo_mode,
    maxDeliveryAttempts: workspace.max_delivery_attempts,
  };
}

export async function recordActivity(
  admin: AdminClient,
  input: {
    workspaceId: string;
    actorId?: string | null;
    action: string;
    summary: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const metadata = sanitize(input.metadata ?? {});
  await admin.from("activity_logs").insert({
    workspace_id: input.workspaceId,
    actor_id: input.actorId ?? null,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    summary: input.summary,
    metadata,
  });
}

async function ensureOwnerWorkspace(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }) {
  const admin = createAdminClient();
  const existing = await admin.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (existing.data || existing.error) return;
  const metadata = user.user_metadata ?? {};
  const workspaceName = textValue(metadata.workspace_name) || "Team Arora";
  const fullName = textValue(metadata.full_name) || user.email?.split("@")[0] || "Administrator";
  const workspace = await admin.from("workspaces").insert({ name: workspaceName }).select("id").single();
  const workspaceId = (workspace.data as { id: string } | null)?.id;
  if (!workspaceId) return;
  await admin.from("profiles").insert({
    id: user.id,
    workspace_id: workspaceId,
    full_name: fullName,
    email: user.email ?? null,
  });
  await admin.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    role: "owner",
  });
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function sanitize(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/token|secret|password|key|credential/i.test(key)) continue;
    output[key] = entry;
  }
  return output;
}

export async function allowRequest(admin: AdminClient, bucket: string, limit: number, windowMs: number) {
  const now = new Date();
  const existing = await admin.from("rate_limits").select("window_start, hits").eq("bucket", bucket).maybeSingle();
  const row = existing.data as { window_start: string; hits: number } | null;
  if (!row || now.getTime() - new Date(row.window_start).getTime() > windowMs) {
    await admin.from("rate_limits").upsert({ bucket, window_start: now.toISOString(), hits: 1 });
    return true;
  }
  if (row.hits >= limit) return false;
  await admin.from("rate_limits").update({ hits: row.hits + 1 }).eq("bucket", bucket);
  return true;
}
