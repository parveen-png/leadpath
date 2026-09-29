"use client";

import { useState } from "react";

import { Badge, statusLabel, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  refreshFubFields,
  removeFubConnection,
  removeMetaConnection,
  saveFubConnection,
  saveMetaConnection,
  subscribeMetaPage,
  testFubConnection,
  testMetaConnection,
} from "@/server/actions/connections";

type PublicConnection = {
  status: string;
  publicConfig: Record<string, unknown>;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export function ConnectionPanels({
  meta,
  fub,
  webhookUrl,
  demo,
  pages,
}: {
  meta: PublicConnection | null;
  fub: PublicConnection | null;
  webhookUrl: string;
  demo: boolean;
  pages: Array<{ id: string; name: string; subscribed: boolean }>;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-serif text-4xl">Connections</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">Connect Facebook and Follow Up Boss once. Leadpath keeps the keys on the server and only shows the last few characters.</p>
      </div>
      {demo ? <Badge tone="warn">Demo Data can be used before credentials are connected.</Badge> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <MetaCard connection={meta} webhookUrl={webhookUrl} pages={pages} />
        <FubCard connection={fub} />
      </div>
    </div>
  );
}

function MetaCard({
  connection,
  webhookUrl,
  pages,
}: {
  connection: PublicConnection | null;
  webhookUrl: string;
  pages: Array<{ id: string; name: string; subscribed: boolean }>;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [technical, setTechnical] = useState<string | null>(null);
  const config = connection?.publicConfig ?? {};
  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1877f2] font-serif text-xl text-white">f</div>
          <h2 className="mt-3 font-serif text-3xl">Facebook / Meta</h2>
          <p className="text-sm text-muted">Facebook Lead Connection</p>
        </div>
        <Badge tone={statusTone(connection?.status ?? "disconnected")}>{statusLabel(connection?.status ?? "disconnected")}</Badge>
      </div>
      <form
        action={async (formData) => {
          await saveMetaConnection(formData);
        }}
        className="space-y-3"
      >
        <Field name="appId" label="App ID" hint="From the Meta app dashboard. This is not a secret." defaultValue={String(config.appId ?? "")} />
        <Field name="appSecret" label="App secret" hint={config.maskedAppSecret ? `Saved as ${config.maskedAppSecret}. Leave blank to keep it.` : "Used to verify that webhooks really came from Meta."} />
        <Field name="verifyToken" label="Verify token" hint="A private phrase you also enter in the Meta webhook settings." />
        <Field name="userAccessToken" label="Page access token" hint={config.maskedAccessToken ? `Saved as ${config.maskedAccessToken}. Leave blank to keep it.` : "A token that can read the Page and its lead forms."} />
        <Button type="submit">Save Facebook details</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={async () => {
          const test = await testMetaConnection();
          if (test.ok) {
            setResult(`Facebook connected successfully. ${test.pageCount} Pages available. ${test.formCount} lead forms found.`);
            setTechnical(null);
          } else {
            setResult(test.friendly);
            setTechnical(test.technical || null);
          }
        }}>Test Connection</Button>
        <form
          action={async () => {
            await removeMetaConnection();
          }}
        ><Button type="submit" variant="ghost">Remove Connection</Button></form>
      </div>
      {result ? <p className="rounded-2xl bg-paper px-3 py-3 text-sm">{result}</p> : null}
      <p className="text-xs text-muted">Webhook address: {webhookUrl}</p>
      <div className="space-y-2">
        {pages.map((page) => (
          <div key={page.id} className="flex items-center justify-between text-sm">
            <span>{page.name}</span>
            {page.subscribed ? <Badge tone="good">Listening</Badge> : (
              <Button type="button" size="sm" variant="secondary" onClick={() => void subscribeMetaPage(page.id)}>Turn on lead notifications</Button>
            )}
          </div>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer text-sm">Technical Details</summary>
        <p className="mt-2 text-xs text-muted">{technical || connection?.lastError || "No technical details."}</p>
      </details>
    </Card>
  );
}

function FubCard({ connection }: { connection: PublicConnection | null }) {
  const [result, setResult] = useState<string | null>(null);
  const [technical, setTechnical] = useState<string | null>(null);
  const config = connection?.publicConfig ?? {};
  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink font-serif text-xl text-white">F</div>
          <h2 className="mt-3 font-serif text-3xl">Follow Up Boss</h2>
          <p className="text-sm text-muted">Where finished leads are delivered.</p>
        </div>
        <Badge tone={statusTone(connection?.status ?? "disconnected")}>{statusLabel(connection?.status ?? "disconnected")}</Badge>
      </div>
      <form
        action={async (formData) => {
          await saveFubConnection(formData);
        }}
        className="space-y-3"
      >
        <Field name="apiKey" label="API key" hint={config.maskedApiKey ? `Saved as ${config.maskedApiKey}. Leave blank to keep it.` : "From Follow Up Boss Admin, then API. The key is the username. The password stays blank."} />
        <Field name="systemName" label="System name" hint="Optional. Sent as X-System when Follow Up Boss has registered Leadpath." defaultValue={String(config.systemName ?? "")} />
        <Field name="systemKey" label="System key" hint={config.maskedSystemKey ? `Saved as ${config.maskedSystemKey}.` : "Optional partner key sent as X-System-Key."} />
        <Button type="submit">Save Follow Up Boss</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={async () => {
          const test = await testFubConnection();
          if (test.ok) {
            setResult(`Follow Up Boss connected. Account: ${test.accountName}. Custom fields: ${test.customFieldCount}. Standard fields: ${test.standardFieldCount}.`);
            setTechnical(null);
          } else {
            setResult(test.friendly);
            setTechnical(test.technical || null);
          }
        }}>Test Connection</Button>
        <Button type="button" variant="secondary" onClick={async () => {
          const refreshed = await refreshFubFields();
          setResult(refreshed.ok ? `Fields refreshed. ${refreshed.customFieldCount} custom fields.` : refreshed.error);
        }}>Refresh Follow Up Boss Fields</Button>
        <form
          action={async () => {
            await removeFubConnection();
          }}
        ><Button type="submit" variant="ghost">Remove Connection</Button></form>
      </div>
      {result ? <p className="rounded-2xl bg-paper px-3 py-3 text-sm">{result}</p> : null}
      {connection?.lastSyncedAt ? <p className="text-xs text-muted">Last synced {new Date(connection.lastSyncedAt).toLocaleString()}.</p> : null}
      <details>
        <summary className="cursor-pointer text-sm">Technical Details</summary>
        <p className="mt-2 text-xs text-muted">{technical || connection?.lastError || "No technical details."}</p>
      </details>
    </Card>
  );
}

function Field({ name, label, hint, defaultValue }: { name: string; label: string; hint: string; defaultValue?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <span className="mb-1.5 block text-xs text-muted">{hint}</span>
      <Input name={name} defaultValue={defaultValue} autoComplete="off" />
    </label>
  );
}
