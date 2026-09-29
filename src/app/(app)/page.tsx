import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Badge, statusLabel, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createWorkflow } from "@/server/actions/workflows";
import { dashboardData } from "@/server/queries";
import { formatRelativeTime } from "@/lib/utils";

export default async function DashboardPage() {
  const data = await dashboardData();
  const cards = [
    ["Leads Today", String(data.today.total)],
    ["Delivered", String(data.today.delivered)],
    ["Failed", String(data.today.failed)],
    ["Active Workflows", String(data.activeWorkflows)],
  ];
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Good to see you, {data.ctx.fullName.split(" ")[0]}</p>
          <h1 className="font-serif text-4xl">Is everything flowing?</h1>
          <p className="mt-2 text-sm text-muted">Last lead received {formatRelativeTime(data.lastLead)}.</p>
        </div>
        <form action={createWorkflow}>
          <Button type="submit" size="lg">
            Create Workflow <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => (
          <Card key={label}>
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-2 font-serif text-4xl">{value}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-serif text-2xl">Connection status</h2>
          <div className="mt-4 space-y-3">
            <ConnectionRow name="Facebook Lead Connection" status={data.meta?.status ?? "disconnected"} />
            <ConnectionRow name="Follow Up Boss" status={data.fub?.status ?? "disconnected"} />
          </div>
          <Link href="/connections" className="mt-4 inline-block text-sm font-medium text-forest">
            Manage connections
          </Link>
        </Card>
        <Card>
          <h2 className="font-serif text-2xl">Active workflows</h2>
          <div className="mt-4 space-y-3">
            {data.workflows.filter((workflow) => workflow.status === "active").length === 0 ? (
              <p className="text-sm text-muted">No workflow is turned on yet. Create one when you are ready for new leads.</p>
            ) : (
              data.workflows
                .filter((workflow) => workflow.status === "active")
                .map((workflow) => (
                  <Link key={workflow.id} href={`/workflows/${workflow.id}`} className="block rounded-2xl border border-line px-3 py-3 hover:bg-paper">
                    <p className="font-medium">{workflow.name}</p>
                    <p className="text-xs text-muted">{workflow.page_name} · {workflow.form_name}</p>
                  </Link>
                ))
            )}
          </div>
        </Card>
        <Card>
          <h2 className="font-serif text-2xl">Recent leads</h2>
          <div className="mt-4 space-y-3">
            {data.leads.length === 0 ? <p className="text-sm text-muted">Leads will show up here as soon as Facebook sends one.</p> : null}
            {data.leads.map((lead) => (
              <Link key={lead.id} href={`/leads/${lead.id}`} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <span className="font-medium">{lead.display_name || lead.email || "Facebook lead"}</span>
                  <span className="mt-0.5 block text-xs text-muted">{formatRelativeTime(lead.received_at)}</span>
                </span>
                <Badge tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Badge>
              </Link>
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="font-serif text-2xl">Recent errors</h2>
          <div className="mt-4 space-y-3">
            {data.errors.length === 0 ? <p className="text-sm text-muted">No failed deliveries. That is the goal.</p> : null}
            {data.errors.map((lead) => (
              <Link key={lead.id} href={`/leads/${lead.id}`} className="block rounded-2xl bg-danger-soft px-3 py-3 text-sm text-danger">
                <span className="font-medium">{lead.display_name || "Lead"}</span>
                <span className="mt-1 block">{lead.friendly_error || statusLabel(lead.status)}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ConnectionRow({ name, status }: { name: string; status: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-line px-3 py-3">
      <span className="text-sm font-medium">{name}</span>
      <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
    </div>
  );
}
