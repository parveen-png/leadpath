import { splitFullName } from "@/services/mapping/name";
import { normalizeLabel } from "@/services/mapping/normalize";
import { collectTags } from "@/services/mapping/tags";
import { applyTransform } from "@/services/mapping/transforms";
import type {
  DestinationField,
  FieldMapping,
  FubEventPayload,
  PayloadBuildResult,
  StaticValue,
  ValueTranslation,
  WorkflowRule,
  WorkflowTag,
} from "@/types/domain";

type Address = {
  type: string;
  street?: string;
  city?: string;
  state?: string;
  code?: string;
  country?: string;
};

function canonicalChoice(value: string, choices: string[]): string | null {
  const normalized = normalizeLabel(value);
  return choices.find((choice) => normalizeLabel(choice) === normalized) ?? null;
}

export function translateDropdownValue(
  raw: string,
  field: DestinationField,
  translations: ValueTranslation[],
): { ok: true; value: string } | { ok: false; raw: string; expected: string[] } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: "" };
  const limited = field.type === "dropdown" || (field.choices.length > 0 && field.choiceMap);
  if (!limited || field.choices.length === 0) {
    return { ok: true, value: field.choiceMap?.[trimmed] ?? trimmed };
  }
  const direct = canonicalChoice(trimmed, field.choices);
  if (direct) return { ok: true, value: field.choiceMap?.[direct] ?? direct };
  const translation = translations.find(
    (item) =>
      item.destinationApiName === field.apiName && normalizeLabel(item.fromValue) === normalizeLabel(trimmed),
  );
  if (translation) {
    const translated = canonicalChoice(translation.toValue, field.choices);
    if (translated) return { ok: true, value: field.choiceMap?.[translated] ?? translated };
  }
  return { ok: false, raw: trimmed, expected: field.choices };
}

function ensureAddress(person: Record<string, unknown>): Address {
  const existing = person.addresses;
  if (Array.isArray(existing) && existing[0] && typeof existing[0] === "object") {
    return existing[0] as Address;
  }
  const address: Address = { type: "home" };
  person.addresses = [address];
  return address;
}

function parsePrice(value: string): number | null {
  const digits = value.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

export function buildFubPayload(input: {
  values: Record<string, string>;
  mappings: FieldMapping[];
  staticValues: StaticValue[];
  tags: WorkflowTag[];
  rules: WorkflowRule[];
  translations: ValueTranslation[];
  destinations: DestinationField[];
  sourceName: string;
  systemName: string;
  eventType: string;
  campaignSource: string;
}): PayloadBuildResult {
  const destinations = new Map(input.destinations.map((field) => [field.apiName, field]));
  const payload: FubEventPayload = {
    source: input.sourceName || "Facebook",
    system: input.systemName || "Leadpath",
    type: input.eventType || "General Inquiry",
    person: {},
  };
  const personUpdates: Record<string, string | number> = {};
  const previewItems: { label: string; value: string }[] = [];
  const warnings: string[] = [];
  const background: string[] = [];
  const campaign: { source?: string; campaign?: string; content?: string; term?: string } = {};

  const write = (field: DestinationField, rawValue: string) => {
    const translated = translateDropdownValue(rawValue, field, input.translations);
    if (!translated.ok) {
      return {
        ok: false as const,
        error: {
          friendly: `Follow Up Boss rejected "${field.label}". The value "${translated.raw}" isn't one of the allowed options.`,
          technical: `Value for ${field.apiName} is not an allowed choice.`,
          fieldLabel: field.label,
          expected: translated.expected,
        },
      };
    }
    const value = translated.value.trim();
    if (!value) return { ok: true as const };

    if (field.writeTarget === "event.person.name" || field.apiName === "name") {
      const split = splitFullName(value);
      if (split.firstName) payload.person.firstName = split.firstName;
      if (split.lastName) payload.person.lastName = split.lastName;
      previewItems.push({ label: "First Name", value: split.firstName });
      if (split.lastName) previewItems.push({ label: "Last Name", value: split.lastName });
      previewItems.push({ label: "Full Name", value: split.fullName });
      return { ok: true as const };
    }

    if (field.apiName === "price" || field.type === "number" && field.apiName === "price") {
      const price = parsePrice(value);
      if (price == null) {
        return {
          ok: false as const,
          error: {
            friendly: `“${field.label}” needs a number. “${value}” couldn't be read as a price.`,
            technical: `Invalid numeric value for ${field.apiName}.`,
            fieldLabel: field.label,
          },
        };
      }
      payload.person.price = price;
      previewItems.push({ label: field.label, value: String(price) });
      return { ok: true as const };
    }

    switch (field.writeTarget) {
      case "event.person.emails":
        payload.person.emails = [{ value, type: "home" }];
        break;
      case "event.person.phones":
        payload.person.phones = [{ value, type: "mobile" }];
        break;
      case "event.person.addresses.street":
        ensureAddress(payload.person).street = value;
        break;
      case "event.person.addresses.city":
        ensureAddress(payload.person).city = value;
        break;
      case "event.person.addresses.state":
        ensureAddress(payload.person).state = value;
        break;
      case "event.person.addresses.code":
        ensureAddress(payload.person).code = value;
        break;
      case "event.person.addresses.country":
        ensureAddress(payload.person).country = value;
        break;
      case "event.source":
        payload.source = value;
        break;
      case "event.message":
        payload.message = value;
        break;
      case "event.description":
        background.push(value);
        break;
      case "person.background":
        personUpdates.background = value;
        warnings.push("Background replaces the existing background on a matching Follow Up Boss contact.");
        break;
      case "event.campaign.source":
        campaign.source = value;
        break;
      case "event.campaign.campaign":
        campaign.campaign = value;
        break;
      case "event.campaign.term":
        campaign.term = value;
        break;
      case "event.campaign.content":
        campaign.content = value;
        break;
      case "person.timeframeId":
      case "person.assignedPondId": {
        const numeric = Number(value);
        if (!Number.isInteger(numeric)) {
          return {
            ok: false as const,
            error: {
              friendly: `“${field.label}” needs one of the choices from Follow Up Boss.`,
              technical: `Expected an id for ${field.apiName}, received ${value}.`,
              fieldLabel: field.label,
              expected: field.choices,
            },
          };
        }
        personUpdates[field.apiName] = numeric;
        break;
      }
      default:
        if (field.apiName === "assignedUserId") {
          const numeric = Number(value);
          if (!Number.isInteger(numeric)) {
            return {
              ok: false as const,
              error: {
                friendly: "Assigned agent needs to be someone on your Follow Up Boss team.",
                technical: `Invalid assignedUserId ${value}.`,
                fieldLabel: field.label,
              },
            };
          }
          payload.person.assignedUserId = numeric;
        } else if (field.custom || field.writeTarget === "event.person.custom" || field.writeTarget === "event.person") {
          payload.person[field.apiName] = field.type === "number" ? parsePrice(value) ?? value : value;
        }
        break;
    }
    previewItems.push({ label: field.label, value });
    return { ok: true as const };
  };

  for (const mapping of input.mappings) {
    if (mapping.ignored || !mapping.destinationApiName) {
      if (mapping.saveToBackground) {
        const raw = input.values[mapping.sourceKey] ?? "";
        if (raw.trim()) background.push(`${mapping.sourceLabel}: ${raw.trim()}`);
      }
      continue;
    }
    const field = destinations.get(mapping.destinationApiName);
    if (!field) {
      warnings.push(`“${mapping.destinationLabel ?? mapping.destinationApiName}” is no longer in Follow Up Boss. Refresh fields and map it again.`);
      continue;
    }
    const transformed = applyTransform(input.values[mapping.sourceKey] ?? "", mapping.transform, input.values);
    if (!transformed.trim()) continue;
    const written = write(field, transformed);
    if (!written.ok) return written;
  }

  for (const staticValue of input.staticValues) {
    const field = destinations.get(staticValue.destinationApiName);
    if (!field || !staticValue.value.trim()) continue;
    const written = write(field, staticValue.value);
    if (!written.ok) return written;
  }

  if (background.length > 0) {
    payload.description = background.join("\n");
  }

  const campaignSource = campaign.source || input.campaignSource || "Facebook";
  if (campaign.campaign || campaign.term || campaign.content || campaignSource) {
    payload.campaign = {
      source: campaignSource,
      medium: "lead ad",
      ...(campaign.campaign ? { campaign: campaign.campaign } : {}),
      ...(campaign.term ? { term: campaign.term } : {}),
      ...(campaign.content ? { content: campaign.content } : {}),
    };
  }

  const contactMapped = previewItems.some((item) =>
    ["First Name", "Last Name", "Full Name", "Email", "Phone"].includes(item.label),
  );
  if (!contactMapped) {
    warnings.push("This lead has no name, email, or phone mapped. Follow Up Boss may not be able to identify the contact.");
  }

  const tags = collectTags({ tags: input.tags, rules: input.rules, values: input.values });
  if (tags.length > 0) previewItems.push({ label: "Tags", value: tags.join(", ") });

  return { ok: true, payload, tags, personUpdates, preview: previewItems, warnings };
}
