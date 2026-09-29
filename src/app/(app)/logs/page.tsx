import { Card } from "@/components/ui/card";
import { activityFeed } from "@/server/queries";
import { formatDateTime } from "@/lib/utils";

const labels: Record<string, string> = {
  "connection.added": "Connection added",
  "connection.updated": "Connection updated",
  "connection.removed": "Connection removed",
  "connection.tested": "Connection tested",
  "fields.refreshed": "Fields refreshed",
  "workflow.created": "Workflow created",
  "workflow.activated": "Workflow activated",
  "workflow.paused": "Workflow paused",
  "workflow.mapping_changed": "Mapping changed",
  "workflow.deleted": "Workflow deleted",
  "lead.retried": "Lead manually retried",
  "workspace.updated": "Workspace updated",
  "workspace.advanced": "Advanced settings updated",
};

export default async function LogsPage() {
  const logs = await activityFeed();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-serif text-4xl">Activity Logs</h1>
        <p className="mt-2 text-sm text-muted">Changes made in this workspace. Secrets are never written here.</p>
      </div>
      {logs.length === 0 ? <Card><p className="text-sm text-muted">Nothing has been recorded yet.</p></Card> : null}
      <ol className="space-y-3">
        {logs.map((log) => (
          <li key={log.id}>
            <Card className="py-4">
              <p className="text-xs text-muted">{formatDateTime(log.created_at)}</p>
              <p className="mt-1 font-medium">{labels[log.action] ?? log.action}</p>
              <p className="text-sm text-muted">{log.summary}</p>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
