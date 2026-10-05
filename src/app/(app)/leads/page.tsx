import Link from "next/link";

export const maxDuration = 60;

import { Badge, statusLabel, statusTone } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { leadInbox } from "@/server/queries";
import { importRecentLeads } from "@/services/leads/pipeline";
import { formatRelativeTime } from "@/lib/utils";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; range?: string }>;
}) {
  const filters = await searchParams;
  const sync = await importRecentLeads();
  const { leads, names } = await leadInbox(filters);
  const statuses = ["all", "delivered", "failed", "retrying", "delivered_with_warning"];
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="font-serif text-4xl">Leads</h1>
        <p className="mt-2 text-sm text-muted">Every Facebook lead and whether Follow Up Boss accepted it.</p>
      </div>
      {sync.message ? <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">{sync.message}</p> : null}
      {sync.imported > 0 ? <p className="rounded-2xl bg-forest-soft px-4 py-3 text-sm">{sync.imported} new Facebook {sync.imported === 1 ? "lead was" : "leads were"} brought in and sent toward Follow Up Boss.</p> : null}
      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={filters.q} placeholder="Search name, email, phone, or ID" aria-label="Search leads" className="max-w-sm" />
        <select name="status" defaultValue={filters.status ?? "all"} className="h-11 rounded-2xl border border-line bg-white px-3 text-sm" aria-label="Status">
          {statuses.map((status) => (
            <option key={status} value={status}>{status === "all" ? "All" : statusLabel(status)}</option>
          ))}
        </select>
        <select name="range" defaultValue={filters.range ?? "all"} className="h-11 rounded-2xl border border-line bg-white px-3 text-sm" aria-label="Date range">
          <option value="all">Any time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
        </select>
        <button className="h-11 rounded-full bg-ink px-4 text-sm text-white" type="submit">Filter</button>
      </form>
      <div className="overflow-x-auto rounded-3xl border border-line bg-card">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              {["Received", "Lead", "Facebook form", "Campaign", "Workflow", "Follow Up Boss", "Status"].map((heading) => (
                <th key={heading} className="px-4 py-3 font-medium">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr><td className="px-4 py-8 text-muted" colSpan={7}>No leads match these filters.</td></tr>
            ) : null}
            {leads.map((lead) => (
              <tr key={String(lead.id)} className="border-t border-line">
                <td className="px-4 py-3">{formatRelativeTime(String(lead.received_at))}</td>
                <td className="px-4 py-3">
                  <Link className="font-medium" href={`/leads/${lead.id}`}>{String(lead.display_name || lead.email || "Facebook lead")}</Link>
                  {lead.is_test ? <Badge className="ml-2" tone="warn">Test</Badge> : null}
                </td>
                <td className="px-4 py-3">{String(lead.form_name ?? "—")}</td>
                <td className="px-4 py-3">{String(lead.campaign_name ?? "—")}</td>
                <td className="px-4 py-3">{names.get(String(lead.workflow_id)) ?? "—"}</td>
                <td className="px-4 py-3">{lead.fub_person_id ? `#${lead.fub_person_id}` : "—"}</td>
                <td className="px-4 py-3"><Badge tone={statusTone(String(lead.status))}>{statusLabel(String(lead.status))}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
