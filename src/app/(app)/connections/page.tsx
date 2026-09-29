import { ConnectionPanels } from "@/features/connections/panels";
import { requireWorkspace } from "@/server/session";
import { getConnection, toPublicConnection } from "@/services/connections/store";
import { isDemoModeEnabled } from "@/lib/env";

export default async function ConnectionsPage() {
  const ctx = await requireWorkspace();
  const [meta, fub, pages] = await Promise.all([
    getConnection(ctx.admin, ctx.workspaceId, "meta"),
    getConnection(ctx.admin, ctx.workspaceId, "follow_up_boss"),
    ctx.admin.from("meta_pages").select("page_id, name, subscribed").eq("workspace_id", ctx.workspaceId),
  ]);
  const base = process.env.APP_URL?.replace(/\/$/, "");
  return (
    <ConnectionPanels
      meta={toPublicConnection(meta, "meta")}
      fub={toPublicConnection(fub, "follow_up_boss")}
      webhookUrl={base ? `${base}/api/webhooks/meta` : "/api/webhooks/meta"}
      demo={ctx.demoMode || isDemoModeEnabled()}
      pages={((pages.data ?? []) as Array<{ page_id: string; name: string; subscribed: boolean }>).map((page) => ({
        id: page.page_id,
        name: page.name,
        subscribed: page.subscribed,
      }))}
    />
  );
}
