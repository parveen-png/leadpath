"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { refreshFubFields } from "@/server/actions/connections";
import { STANDARD_FUB_FIELDS } from "@/lib/follow-up-boss/catalog";

type CustomRow = {
  label: string;
  api_name: string;
  field_type: string;
  choices: string[] | null;
  is_recurring: boolean | null;
};

const filters = ["All", "Standard", "Custom", "Contact", "Assignment", "Marketing", "Lead"] as const;

export function FieldBrowser({ custom, syncedAt, demo }: { custom: CustomRow[]; syncedAt: string | null; demo: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [message, setMessage] = useState<string | null>(null);
  const rows = useMemo(() => {
    const standard = STANDARD_FUB_FIELDS.map((field) => ({
      label: field.label,
      apiName: field.apiName,
      type: field.type,
      category: field.category,
      custom: false,
      choices: field.choices,
    }));
    const extra = custom.map((field) => ({
      label: field.label,
      apiName: field.api_name,
      type: field.field_type,
      category: "Custom Fields",
      custom: true,
      choices: field.choices ?? [],
    }));
    return [...standard, ...extra].filter((field) => {
      const haystack = `${field.label} ${field.apiName}`.toLowerCase();
      if (query && !haystack.includes(query.toLowerCase())) return false;
      if (filter === "Standard") return !field.custom;
      if (filter === "Custom") return field.custom;
      if (filter === "Contact") return field.category === "Contact Information";
      if (filter === "Assignment") return field.category === "Assignment";
      if (filter === "Marketing") return field.category === "Marketing Information";
      if (filter === "Lead") return field.category === "Lead Information";
      return true;
    });
  }, [custom, filter, query]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl">Field Manager</h1>
          <p className="mt-2 text-sm text-muted">These are the Follow Up Boss fields you can map to. Labels are the names your team sees.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            const result = await refreshFubFields();
            setMessage(result.ok ? "Fields refreshed." : result.error);
          }}
        >
          Refresh Fields
        </Button>
      </div>
      {demo && custom.length === 0 ? <Badge tone="warn">Demo Data — connect Follow Up Boss to replace these with your account fields.</Badge> : null}
      {message ? <p className="text-sm">{message}</p> : null}
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Follow Up Boss fields..." aria-label="Search Follow Up Boss fields" />
      <div className="flex flex-wrap gap-2">
        {filters.map((item) => (
          <button key={item} type="button" className={item === filter ? "rounded-full bg-ink px-3 py-1 text-sm text-white" : "rounded-full bg-white px-3 py-1 text-sm"} onClick={() => setFilter(item)}>
            {item}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{syncedAt ? `Last synced ${new Date(syncedAt).toLocaleString()}.` : "Fields have not been synced yet."}</p>
      <div className="grid gap-3">
        {rows.map((field) => (
          <Card key={field.apiName} className="flex items-start justify-between gap-4 py-4">
            <div>
              <p className="font-medium">{field.label}</p>
              <p className="text-xs text-muted">{field.apiName}</p>
              {field.choices.length > 0 ? <p className="mt-1 text-xs text-muted">Choices: {field.choices.slice(0, 6).join(", ")}</p> : null}
            </div>
            <div className="text-right">
              <Badge tone={field.custom ? "warn" : "good"}>{field.custom ? "Custom" : field.category}</Badge>
              <p className="mt-2 text-xs text-muted">{field.type}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
