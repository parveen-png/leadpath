import { normalizeLabel, similarity } from "@/services/mapping/normalize";
import type { DestinationField, FieldMapping, SourceField, Transform } from "@/types/domain";

const CONTACT_SYNONYMS: Record<string, string> = {
  "full name": "name",
  fullname: "name",
  name: "name",
  "first name": "firstName",
  firstname: "firstName",
  "given name": "firstName",
  "last name": "lastName",
  lastname: "lastName",
  surname: "lastName",
  "family name": "lastName",
  email: "emails",
  "email address": "emails",
  phone: "phones",
  "phone number": "phones",
  mobile: "phones",
  "mobile phone": "phones",
  "cell phone": "phones",
};

const MARKETING_SYNONYMS: Record<string, string> = {
  "campaign name": "campaignName",
  "ad set name": "campaignAdGroup",
  "adset name": "campaignAdGroup",
  "ad name": "campaignAd",
};

export type AutoMapResult = {
  mappings: FieldMapping[];
  suggestions: Array<{ sourceKey: string; sourceLabel: string; destination: DestinationField; score: number }>;
};

function destinationByApi(destinations: DestinationField[], apiName: string) {
  return destinations.find((field) => field.apiName === apiName);
}

function exactDestination(source: SourceField, destinations: DestinationField[]) {
  const normalized = normalizeLabel(source.label);
  const keyNormalized = normalizeLabel(source.key);
  return destinations.find(
    (field) => normalizeLabel(field.label) === normalized || normalizeLabel(field.label) === keyNormalized,
  );
}

export function suggestMappings(sources: SourceField[], destinations: DestinationField[]): AutoMapResult {
  const used = new Set<string>();
  const mappings: FieldMapping[] = [];
  const suggestions: AutoMapResult["suggestions"] = [];

  const assign = (source: SourceField, destination: DestinationField, transform: Transform) => {
    used.add(destination.apiName);
    mappings.push({
      sourceKey: source.key,
      sourceLabel: source.label,
      sourceGroup: source.group,
      destinationApiName: destination.apiName,
      destinationLabel: destination.label,
      transform,
      ignored: false,
      saveToBackground: false,
    });
  };

  for (const source of sources) {
    const exact = exactDestination(source, destinations);
    if (exact && !used.has(exact.apiName)) {
      const transform: Transform =
        exact.apiName === "name" || normalizeLabel(source.label) === "full name" || normalizeLabel(source.key) === "full name"
          ? { type: "split_full_name" }
          : source.group === "contact" && (exact.apiName === "phones" || normalizeLabel(source.label).includes("phone"))
            ? { type: "phone" }
            : { type: "none" };
      assign(source, exact, exact.apiName === "name" ? { type: "split_full_name" } : transform);
      continue;
    }

    const synonym =
      CONTACT_SYNONYMS[normalizeLabel(source.key)] ??
      CONTACT_SYNONYMS[normalizeLabel(source.label)] ??
      (source.group === "marketing" || source.group === "metadata"
        ? MARKETING_SYNONYMS[normalizeLabel(source.label)] ?? MARKETING_SYNONYMS[normalizeLabel(source.key)]
        : undefined);
    if (synonym) {
      const destination = destinationByApi(destinations, synonym);
      if (destination && !used.has(destination.apiName) && (synonym !== "name" || normalizeLabel(source.label) !== "name" || source.group === "contact")) {
        if (synonym === "name" && normalizeLabel(source.label) === "name" && source.group !== "contact") {
          // A marketing field literally named "name" should not become the contact name.
        } else {
          assign(
            source,
            destination,
            synonym === "name" ? { type: "split_full_name" } : synonym === "phones" ? { type: "phone" } : { type: "none" },
          );
          continue;
        }
      }
    }

    let best: { field: DestinationField; score: number } | null = null;
    for (const field of destinations) {
      if (used.has(field.apiName)) continue;
      const score = Math.max(similarity(source.label, field.label), similarity(source.key, field.label));
      if (!best || score > best.score) best = { field, score };
    }
    if (best && best.score >= 0.72) {
      suggestions.push({
        sourceKey: source.key,
        sourceLabel: source.label,
        destination: best.field,
        score: best.score,
      });
    }

    mappings.push({
      sourceKey: source.key,
      sourceLabel: source.label,
      sourceGroup: source.group,
      destinationApiName: null,
      destinationLabel: null,
      transform: { type: "none" },
      ignored: false,
      saveToBackground: false,
    });
  }

  return { mappings, suggestions };
}
