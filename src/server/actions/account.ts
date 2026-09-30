"use server";

import { redirect } from "next/navigation";

import { secretsEqual } from "@/lib/encryption/crypto";
import { createUserClient } from "@/lib/database/user";
import { APP_PASSCODE, clearPasscodeSession, grantPasscodeSession } from "@/server/passcode";
import { allowRequest, recordActivity, requireWorkspace } from "@/server/session";

export async function signIn(formData: FormData) {
  const passcode = String(formData.get("passcode") ?? "");
  if (!secretsEqual(passcode, APP_PASSCODE)) return { error: "That passcode was not recognized." };
  await grantPasscodeSession();
  redirect("/");
}

export async function signOut() {
  await clearPasscodeSession();
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
