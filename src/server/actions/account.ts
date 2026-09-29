"use server";

import { redirect } from "next/navigation";

import { createUserClient } from "@/lib/database/user";
import { allowRequest, recordActivity, requireWorkspace } from "@/server/session";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || password.length < 8) return { error: "Enter the email and password for this workspace." };
  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Those sign-in details were not recognized." };
  redirect("/");
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const workspaceName = String(formData.get("workspaceName") ?? "").trim();
  if (!email || password.length < 8 || workspaceName.length < 2) {
    return { error: "Add your name, a workspace name, and a password of at least 8 characters." };
  }
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, workspace_name: workspaceName } },
  });
  if (error) return { error: "The account could not be created. The email may already be in use." };
  if (!data.session) {
    return { message: "Check your email to confirm the account, then sign in." };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createUserClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function updateWorkspace(formData: FormData) {
  const ctx = await requireWorkspace();
  if (!(await allowRequest(ctx.admin, `settings:${ctx.userId}`, 20, 60_000))) {
    return { error: "Please wait a moment and try again." };
  }
  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (name.length < 2) return { error: "Give the workspace a name." };
  await ctx.admin.from("workspaces").update({ name, timezone }).eq("id", ctx.workspaceId);
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "workspace.updated",
    summary: "Workspace settings were updated.",
  });
  return { ok: true };
}

export async function updateAdvanced(formData: FormData) {
  const ctx = await requireWorkspace();
  const version = String(formData.get("metaGraphVersion") ?? "").trim();
  const eventType = String(formData.get("defaultEventType") ?? "General Inquiry");
  const demoMode = formData.get("demoMode") === "on";
  const attempts = Number(formData.get("maxDeliveryAttempts") ?? 5);
  if (version && !/^v\d+\.\d+$/.test(version)) return { error: "The Meta API version should look like v25.0." };
  if (![1, 2, 3, 4, 5].includes(attempts)) return { error: "Choose between 1 and 5 delivery attempts." };
  await ctx.admin
    .from("workspaces")
    .update({
      meta_graph_version: version || null,
      default_event_type: eventType,
      demo_mode: demoMode,
      max_delivery_attempts: attempts,
    })
    .eq("id", ctx.workspaceId);
  await recordActivity(ctx.admin, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "workspace.advanced",
    summary: "Advanced settings were updated.",
  });
  return { ok: true };
}
