"use client";

import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export function Combobox({
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string; hint?: string }>;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? options.filter((option) => `${option.label} ${option.hint ?? ""}`.toLowerCase().includes(needle))
      : options;
    return matches.slice(0, 200);
  }, [options, query]);

  return (
    <div className="relative">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        className="h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm"
        placeholder={placeholder}
        value={open ? query : selected?.label ?? ""}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-expanded={open}
        aria-controls={listId}
        role="combobox"
      />
      {open ? (
        <ul id={listId} className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-2xl border border-line bg-white p-1 shadow-lg" role="listbox">
          {filtered.length === 0 ? <li className="px-3 py-2 text-sm text-muted">Nothing matches.</li> : null}
          {filtered.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                className={cn("w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-paper", option.value === value && "bg-forest-soft")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="block">{option.label}</span>
                {option.hint ? <span className="block text-xs text-muted">{option.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
