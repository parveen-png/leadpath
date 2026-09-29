import { normalizePhone, splitFullName } from "@/services/mapping/name";
import type { Transform } from "@/types/domain";

export function applyTransform(
  rawValue: string,
  transform: Transform,
  values: Record<string, string>,
): string {
  const value = rawValue ?? "";
  switch (transform.type) {
    case "none":
      return value.trim();
    case "trim":
      return value.trim();
    case "lowercase":
      return value.trim().toLocaleLowerCase();
    case "uppercase":
      return value.trim().toLocaleUpperCase();
    case "phone":
      return normalizePhone(value);
    case "split_full_name":
      return splitFullName(value).fullName;
    case "prefix":
      return value.trim() ? `${transform.value}${value.trim()}` : "";
    case "suffix":
      return value.trim() ? `${value.trim()}${transform.value}` : "";
    case "default_if_empty":
      return value.trim() ? value.trim() : transform.value;
    case "static":
      return transform.value;
    case "template":
      return transform.template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key: string) => values[key] ?? "").trim();
    case "combine": {
      const parts = transform.fieldKeys.map((key) => (values[key] ?? "").trim()).filter(Boolean);
      return parts.join(transform.separator);
    }
    case "date": {
      const trimmed = value.trim();
      if (!trimmed) return "";
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) return trimmed;
      return transform.format === "date" ? parsed.toISOString().slice(0, 10) : parsed.toISOString();
    }
    default: {
      const neverTransform: never = transform;
      return neverTransform;
    }
  }
}

export function defaultTransform(): Transform {
  return { type: "none" };
}
