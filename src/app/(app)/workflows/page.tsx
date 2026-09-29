import Link from "next/link";

import { Badge, statusLabel, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createWorkflow, deleteWorkflow, duplicateWorkflow, setWorkflowStatus } from "@/server/actions/workflows";
import { workflowCards } from "@/server/queries";
import { formatRelativeTime } from "@/lib/utils";

export default async function WorkflowsPage() {
  const workflows = await workflowCards();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl">Workflows</h1>
          <p className="mt-2 text-sm text-muted">Each workflow watches one Facebook Page and sends matching leads to Follow Up Boss.</p>
        </div>
        <form action={createWorkflow}>
          <Button type="submit">Create Workflow</Button>
        </form>
      </div>
      {workflows.length === 0 ? (
        <Card>
          <h2 className="font-serif text-2xl">No workflows yet</h2>
          <p className="mt-2 text-sm text-muted">Start with the Page and form you want to receive. You can test a lead before turning it on.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-line bg-card">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>
                {["Workflow", "Facebook Page", "Facebook Form", "Destination", "Leads", "Success", "Last lead", "Status", "Actions"].map((heading) => (
                  <th key={heading} className="px-4 py-3 font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workflows.map((workflow) => (
                <tr key={workflow.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">{workflow.name}</td>
                  <td className="px-4 py-3">{workflow.pageName ?? "—"}</td>
                  <td className="px-4 py-3">{workflow.formName ?? "—"}</td>
                  <td className="px-4 py-3">Follow Up Boss</td>
                  <td className="px-4 py-3">{workflow.leads}</td>
                  <td className="px-4 py-3">{workflow.success == null ? "—" : `${workflow.success}%`}</td>
                  <td className="px-4 py-3">{formatRelativeTime(workflow.lastLead)}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(workflow.status)}>{statusLabel(workflow.status)}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link className="text-forest" href={`/workflows/${workflow.id}`}>Edit</Link>
                      <Link className="text-forest" href={`/workflows/${workflow.id}`}>Test</Link>
                      <form
                        action={async () => {
                          await setWorkflowStatus(workflow.id, workflow.status === "active" ? "paused" : "active");
                        }}
                      >
                        <button className="text-forest" type="submit">{workflow.status === "active" ? "Pause" : "Turn on"}</button>
                      </form>
                      <form
                        action={async () => {
                          await duplicateWorkflow(workflow.id);
                        }}
                      >
                        <button className="text-forest" type="submit">Duplicate</button>
                      </form>
                      <form
                        action={async () => {
                          await deleteWorkflow(workflow.id);
                        }}
                      >
                        <button className="text-danger" type="submit">Delete</button>
                      </form>
                      <Link className="text-forest" href={`/leads?workflow=${workflow.id}`}>View Leads</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
