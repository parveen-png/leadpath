import { describe, expect, it } from "vitest";

import { isContactField, normalizeLabel, similarity } from "@/services/mapping/normalize";
import { normalizePhone, splitFullName } from "@/services/mapping/name";
import { applyTransform } from "@/services/mapping/transforms";
import { suggestMappings } from "@/services/mapping/automap";
import { matchingRuleTags } from "@/services/mapping/rules";
import { collectTags } from "@/services/mapping/tags";
import { buildFubPayload, translateDropdownValue } from "@/services/mapping/payload";
import { decideLeadIntake } from "@/services/mapping/duplicates";
import { activationConflicts, matchWorkflow } from "@/services/mapping/workflow-match";
import { classifyRetry, nextRetryDelayMs } from "@/services/mapping/retry";
import { friendlyFubError, friendlyMetaError } from "@/lib/errors/normalize";
import { STANDARD_FUB_FIELDS } from "@/lib/follow-up-boss/catalog";
import type { DestinationField, FieldMapping } from "@/types/domain";

const destinations: DestinationField[] = [
  ...STANDARD_FUB_FIELDS,
  {
    apiName: "customBuyerTimeframe",
    label: "Buyer Timeframe",
    type: "dropdown",
    category: "Custom Fields",
    filter: "custom",
    custom: true,
    writeTarget: "event.person.custom",
    choices: ["0-3 Months", "3-6 Months", "6-12 Months"],
  },
  {
    apiName: "customPreferredCity",
    label: "Preferred City",
    type: "text",
    category: "Custom Fields",
    filter: "custom",
    custom: true,
    writeTarget: "event.person.custom",
    choices: [],
  },
];

describe("normalization", () => {
  it("treats phone labels as the same field", () => {
    expect(normalizeLabel("Phone Number")).toBe(normalizeLabel("phone_number"));
    expect(normalizeLabel("Phone")).toBe("phone");
    expect(similarity("Phone Number", "phone_number")).toBe(1);
  });

  it("recognizes contact fields", () => {
    expect(isContactField("email", "Email")).toBe(true);
    expect(isContactField("buying_timeframe", "When are you planning to buy?")).toBe(false);
  });
});

describe("name splitting", () => {
  it("splits common and unicode names without failing", () => {
    expect(splitFullName("John Smith")).toEqual({ fullName: "John Smith", firstName: "John", lastName: "Smith" });
    expect(splitFullName("Mary Jane Smith").lastName).toBe("Jane Smith");
    expect(splitFullName("  Prince  ").firstName).toBe("Prince");
    expect(splitFullName("李 小龙").lastName).toBe("小龙");
    expect(splitFullName("")).toEqual({ fullName: "", firstName: "", lastName: "" });
  });

  it("normalizes north american phone numbers", () => {
    expect(normalizePhone("6475551111")).toBe("(647) 555-1111");
    expect(normalizePhone("+1 647 555 1111")).toBe("+1 (647) 555-1111");
    expect(normalizePhone("ext 9")).toBe("ext 9");
  });
});

describe("transforms", () => {
  it("applies visual transforms", () => {
    expect(applyTransform("  Oakville ", { type: "trim" }, {})).toBe("Oakville");
    expect(applyTransform("Oakville", { type: "prefix", value: "Facebook - " }, {})).toBe("Facebook - Oakville");
    expect(applyTransform("", { type: "default_if_empty", value: "Facebook" }, {})).toBe("Facebook");
    expect(applyTransform("", { type: "template", template: "Facebook - {campaign_name}" }, { campaign_name: "Five Oaks" })).toBe(
      "Facebook - Five Oaks",
    );
    expect(applyTransform("x", { type: "combine", fieldKeys: ["form_name", "campaign_name"], separator: " / " }, {
      form_name: "Five Oaks",
      campaign_name: "Buyers",
    })).toBe("Five Oaks / Buyers");
    expect(applyTransform("ignored", { type: "static", value: "Pre-Construction" }, {})).toBe("Pre-Construction");
  });
});

describe("auto mapping", () => {
  it("maps obvious contact and marketing fields and only suggests similar custom questions", () => {
    const result = suggestMappings(
      [
        { key: "full_name", label: "Full Name", group: "contact" },
        { key: "email", label: "Email", group: "contact" },
        { key: "phone_number", label: "Phone Number", group: "contact" },
        { key: "campaign_name", label: "Campaign Name", group: "marketing" },
        { key: "adset_name", label: "Ad Set Name", group: "marketing" },
        { key: "ad_name", label: "Ad Name", group: "marketing" },
        { key: "buying_timeframe", label: "Buying Timeframe", group: "question" },
        { key: "preferred_city", label: "Preferred City", group: "question" },
      ],
      destinations,
    );
    const byKey = new Map(result.mappings.map((mapping) => [mapping.sourceKey, mapping.destinationApiName]));
    expect(byKey.get("full_name")).toBe("name");
    expect(byKey.get("email")).toBe("emails");
    expect(byKey.get("phone_number")).toBe("phones");
    expect(byKey.get("campaign_name")).toBe("campaignName");
    expect(byKey.get("adset_name")).toBe("campaignAdGroup");
    expect(byKey.get("ad_name")).toBe("campaignAd");
    expect(byKey.get("preferred_city")).toBe("customPreferredCity");
    expect(byKey.get("buying_timeframe")).toBeNull();
    expect(result.suggestions.some((item) => item.sourceLabel === "Buying Timeframe" && item.destination.label === "Buyer Timeframe")).toBe(true);
  });
});

describe("rules and tags", () => {
  const values = {
    realtor: "No",
    timeframe: "0-3 Months",
    city: "Brampton",
    form_name: "Five Oaks Registration",
  };

  it("evaluates and / or conditions", () => {
    const tags = matchingRuleTags(
      [
        {
          id: "1",
          combinator: "and",
          tag: "Hot Lead",
          conditions: [
            { sourceKey: "realtor", operator: "is", value: "no" },
            { sourceKey: "timeframe", operator: "contains", value: "0-3" },
          ],
        },
        {
          id: "2",
          combinator: "or",
          tag: "Brampton",
          conditions: [
            { sourceKey: "city", operator: "is", value: "Oakville" },
            { sourceKey: "city", operator: "ends_with", value: "pton" },
          ],
        },
        {
          id: "3",
          combinator: "and",
          tag: "Skip",
          conditions: [{ sourceKey: "missing", operator: "is_not_empty", value: "" }],
        },
      ],
      values,
    );
    expect(tags).toEqual(["Hot Lead", "Brampton"]);
  });

  it("builds static, dynamic, and conditional tags once", () => {
    expect(
      collectTags({
        tags: [
          { kind: "static", value: "Facebook" },
          { kind: "static", value: "Facebook" },
          { kind: "dynamic", value: "form_name" },
        ],
        rules: [
          {
            id: "1",
            combinator: "and",
            tag: "Hot Lead",
            conditions: [{ sourceKey: "timeframe", operator: "is", value: "0-3 months" }],
          },
        ],
        values,
      }),
    ).toEqual(["Facebook", "Five Oaks Registration", "Hot Lead"]);
  });
});

describe("payload and translations", () => {
  const timeframe = destinations.find((field) => field.apiName === "customBuyerTimeframe")!;

  it("translates dropdown answers onto the official choice", () => {
    expect(
      translateDropdownValue("0 - 3 months", timeframe, [
        { destinationApiName: "customBuyerTimeframe", fromValue: "0 - 3 months", toValue: "0-3 Months" },
      ]),
    ).toEqual({ ok: true, value: "0-3 Months" });
    const rejected = translateDropdownValue("ASAP!!!", timeframe, []);
    expect(rejected.ok).toBe(false);
  });

  it("builds an events payload with split name, campaign attribution, custom fields, and tags", () => {
    const mappings: FieldMapping[] = [
      { sourceKey: "full_name", sourceLabel: "Full Name", sourceGroup: "contact", destinationApiName: "name", destinationLabel: "Name", transform: { type: "split_full_name" }, ignored: false, saveToBackground: false },
      { sourceKey: "email", sourceLabel: "Email", sourceGroup: "contact", destinationApiName: "emails", destinationLabel: "Email", transform: { type: "lowercase" }, ignored: false, saveToBackground: false },
      { sourceKey: "phone_number", sourceLabel: "Phone Number", sourceGroup: "contact", destinationApiName: "phones", destinationLabel: "Phone", transform: { type: "phone" }, ignored: false, saveToBackground: false },
      { sourceKey: "timeframe", sourceLabel: "Buying Timeframe", sourceGroup: "question", destinationApiName: "customBuyerTimeframe", destinationLabel: "Buyer Timeframe", transform: { type: "none" }, ignored: false, saveToBackground: false },
      { sourceKey: "campaign_name", sourceLabel: "Campaign Name", sourceGroup: "marketing", destinationApiName: "campaignName", destinationLabel: "Campaign", transform: { type: "prefix", value: "Facebook - " }, ignored: false, saveToBackground: false },
      { sourceKey: "adset_name", sourceLabel: "Ad Set Name", sourceGroup: "marketing", destinationApiName: "campaignAdGroup", destinationLabel: "Ad Group", transform: { type: "none" }, ignored: false, saveToBackground: false },
      { sourceKey: "ad_name", sourceLabel: "Ad Name", sourceGroup: "marketing", destinationApiName: "campaignAd", destinationLabel: "Ad", transform: { type: "none" }, ignored: false, saveToBackground: false },
      { sourceKey: "realtor", sourceLabel: "Working with a realtor?", sourceGroup: "question", destinationApiName: null, destinationLabel: null, transform: { type: "none" }, ignored: false, saveToBackground: true },
    ];
    const result = buildFubPayload({
      values: {
        full_name: "Mary Jane Smith",
        email: "MARY@Example.com",
        phone_number: "6475551111",
        timeframe: "0 - 3 months",
        campaign_name: "Oakville Buyers",
        adset_name: "Brampton",
        ad_name: "Video 1",
        realtor: "No",
      },
      mappings,
      staticValues: [{ destinationApiName: "customPreferredCity", destinationLabel: "Preferred City", value: "Oakville" }],
      tags: [{ kind: "static", value: "Facebook" }],
      rules: [
        {
          id: "1",
          combinator: "and",
          tag: "Hot Lead",
          conditions: [{ sourceKey: "timeframe", operator: "is", value: "0 - 3 months" }],
        },
      ],
      translations: [{ destinationApiName: "customBuyerTimeframe", fromValue: "0 - 3 months", toValue: "0-3 Months" }],
      destinations,
      sourceName: "Facebook",
      systemName: "Leadpath",
      eventType: "General Inquiry",
      campaignSource: "Facebook",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      source: "Facebook",
      system: "Leadpath",
      type: "General Inquiry",
      person: {
        firstName: "Mary",
        lastName: "Jane Smith",
        emails: [{ value: "mary@example.com", type: "home" }],
        phones: [{ value: "(647) 555-1111", type: "mobile" }],
        customBuyerTimeframe: "0-3 Months",
        customPreferredCity: "Oakville",
      },
      campaign: {
        source: "Facebook",
        campaign: "Facebook - Oakville Buyers",
        term: "Brampton",
        content: "Video 1",
      },
    });
    expect(result.payload.person.tags).toBeUndefined();
    expect(result.tags).toEqual(["Facebook", "Hot Lead"]);
    expect(result.payload.description).toContain("Working with a realtor?: No");
  });

  it("stops on an unsafe dropdown value", () => {
    const result = buildFubPayload({
      values: { timeframe: "ASAP!!!" },
      mappings: [
        {
          sourceKey: "timeframe",
          sourceLabel: "Buying Timeframe",
          sourceGroup: "question",
          destinationApiName: "customBuyerTimeframe",
          destinationLabel: "Buyer Timeframe",
          transform: { type: "none" },
          ignored: false,
          saveToBackground: false,
        },
      ],
      staticValues: [],
      tags: [],
      rules: [],
      translations: [],
      destinations,
      sourceName: "Facebook",
      systemName: "Leadpath",
      eventType: "General Inquiry",
      campaignSource: "Facebook",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.friendly).toContain("Buyer Timeframe");
    expect(result.error.expected).toEqual(["0-3 Months", "3-6 Months", "6-12 Months"]);
  });
});

describe("duplicates, matching, retries, and errors", () => {
  it("does not reprocess the same Meta lead", () => {
    expect(decideLeadIntake({ existingLeadId: "123", incomingIsTest: false, confirmReplay: false })).toBe("duplicate");
    expect(decideLeadIntake({ existingLeadId: null, incomingIsTest: false, confirmReplay: false })).toBe("create");
    expect(decideLeadIntake({ existingLeadId: "123", incomingIsTest: true, confirmReplay: false })).toBe("needs_confirmation");
  });

  it("prefers a specific form workflow over a catch-all", () => {
    const matched = matchWorkflow(
      [
        { id: "any", name: "Any", status: "active", pageId: "p", formId: null, formScope: "any", updatedAt: "2026-01-02" },
        { id: "form", name: "Five Oaks", status: "active", pageId: "p", formId: "f", formScope: "specific", updatedAt: "2026-01-01" },
        { id: "paused", name: "Paused", status: "paused", pageId: "p", formId: "f", formScope: "specific", updatedAt: "2026-02-01" },
      ],
      "p",
      "f",
    );
    expect(matched.workflow?.id).toBe("form");
  });

  it("blocks two active workflows for the same form", () => {
    const conflicts = activationConflicts(
      { id: "new", name: "New", status: "active", pageId: "p", formId: "f", formScope: "specific", updatedAt: "2026-01-01" },
      [{ id: "old", name: "Old", status: "active", pageId: "p", formId: "f", formScope: "specific", updatedAt: "2026-01-01" }],
    );
    expect(conflicts.blockers.length).toBe(1);
  });

  it("retries temporary failures on the documented schedule and stops permanent ones", () => {
    expect(classifyRetry({ httpStatus: 503 })).toBe("retry");
    expect(classifyRetry({ httpStatus: 429 })).toBe("retry");
    expect(classifyRetry({ networkError: true })).toBe("retry");
    expect(classifyRetry({ httpStatus: 400 })).toBe("permanent");
    expect(classifyRetry({ validationError: true, httpStatus: 500 })).toBe("permanent");
    expect(nextRetryDelayMs(1)).toBe(60_000);
    expect(nextRetryDelayMs(2)).toBe(5 * 60_000);
    expect(nextRetryDelayMs(3)).toBe(15 * 60_000);
    expect(nextRetryDelayMs(4)).toBe(60 * 60_000);
    expect(nextRetryDelayMs(5)).toBeNull();
  });

  it("hides raw API errors from the friendly message", () => {
    const meta = friendlyMetaError(400, { error: { message: "Error validating access token", code: 190 } });
    expect(meta.friendly).toContain("access token");
    expect(meta.friendly).not.toContain("validating access token");
    const fub = friendlyFubError(401, { errorMessage: "Invalid API key fka_secretvalue" });
    expect(fub.friendly).toContain("credentials");
    expect(fub.technical).toContain("Invalid API key");
  });
});
