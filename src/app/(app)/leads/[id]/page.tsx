import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, statusLabel, statusTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RetryButton } from "@/features/leads/retry-button";
import { leadDetail } from "@/server/queries";
import { formatDateTime } from "@/lib/utils";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await leadDetail(id);
  if (!detail) notFound();
  const { lead, payload, workflowName, fubUrl } = detail;
  const timeline = Array.isArray(payload?.timeline) ? (payload?.timeline as Array<{ at: string; label: string }>) : [];
  const values = (payload?.facebook_raw as { values?: Record<string, string> } | undefined)?.values ?? {};
  const preview = (payload?.mapped as { preview?: Array<{ label: string; value: string }> } | undefined)?.preview ?? [];
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/leads" className="text-sm text-forest">Back to leads</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl">{String(lead.display_name || "Facebook lead")}</h1>
          <p className="mt-1 text-sm text-muted">{workflowName ?? "No workflow"} · {String(lead.form_name ?? "Unknown form")}</p>
        </div>
        <Badge tone={statusTone(String(lead.status))}>{statusLabel(String(lead.status))}</Badge>
      </div>
      {lead.friendly_error ? (
        <Card className="bg-danger-soft text-danger">
          <p className="font-medium">{String(lead.friendly_error)}</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm">Technical Details</summary>
            <p className="mt-2 text-xs">{String(lead.last_error ?? "")}</p>
          </details>
        </Card>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {["failed", "retrying", "delivered_with_warning"].includes(String(lead.status)) ? <RetryButton leadId={id} /> : null}
        {fubUrl ? (
          <a className="inline-flex h-10 items-center rounded-full border border-line bg-white px-4 text-sm" href={fubUrl} target="_blank" rel="noreferrer">
            Open in Follow Up Boss
          </a>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DataCard title="Facebook data" entries={Object.entries(values)} />
        <DataCard title="Mapped data" entries={preview.map((item) => [item.label, item.value])} />
        <Card>
          <h2 className="font-serif text-2xl">Follow Up Boss</h2>
          <p className="mt-3 text-sm">Contact {lead.fub_person_id ? `#${lead.fub_person_id}` : "not created yet"}</p>
        </Card>
        <Card>
          <h2 className="font-serif text-2xl">Delivery timeline</h2>
          <ol className="mt-4 space-y-3">
            {timeline.map((event) => (
              <li key={`${event.at}-${event.label}`}>
                <p className="text-xs text-muted">{formatDateTime(event.at)}</p>
                <p className="text-sm">{event.label}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <details className="rounded-3xl border border-line bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">Technical Details</summary>
        <pre className="mt-3 overflow-auto text-xs text-muted">{JSON.stringify({ event: payload?.fub_event, response: payload?.fub_response, tags: payload?.tags_response }, null, 2)}</pre>
      </details>
    </div>
  );
}

function DataCard({ title, entries }: { title: string; entries: Array<[string, string]> }) {
  return (
    <Card>
      <h2 className="font-serif text-2xl">{title}</h2>
      <dl className="mt-3 space-y-2">
        {entries.length === 0 ? <p className="text-sm text-muted">Nothing stored yet.</p> : null}
        {entries.slice(0, 12).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
