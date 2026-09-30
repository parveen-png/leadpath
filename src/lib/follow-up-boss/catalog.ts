import type { DestinationField } from "@/types/domain";

export const STANDARD_FUB_FIELDS: DestinationField[] = [
  { apiName: "name", label: "Name", type: "name", category: "Contact Information", filter: "contact", custom: false, writeTarget: "event.person.name", choices: [], help: "Splits a full name into first and last name." },
  { apiName: "firstName", label: "First Name", type: "text", category: "Contact Information", filter: "contact", custom: false, writeTarget: "event.person", choices: [] },
  { apiName: "lastName", label: "Last Name", type: "text", category: "Contact Information", filter: "contact", custom: false, writeTarget: "event.person", choices: [] },
  { apiName: "emails", label: "Email", type: "email", category: "Contact Information", filter: "contact", custom: false, writeTarget: "event.person.emails", choices: [] },
  { apiName: "phones", label: "Phone", type: "phone", category: "Contact Information", filter: "contact", custom: false, writeTarget: "event.person.phones", choices: [] },
  { apiName: "addressStreet", label: "Street Address", type: "text", category: "Contact Information", filter: "contact", custom: false, writeTarget: "event.person.addresses.street", choices: [] },
  { apiName: "addressCity", label: "City", type: "text", category: "Contact Information", filter: "contact", custom: false, writeTarget: "event.person.addresses.city", choices: [] },
  { apiName: "addressState", label: "State", type: "text", category: "Contact Information", filter: "contact", custom: false, writeTarget: "event.person.addresses.state", choices: [] },
  { apiName: "addressCode", label: "Postal Code", type: "text", category: "Contact Information", filter: "contact", custom: false, writeTarget: "event.person.addresses.code", choices: [] },
  { apiName: "addressCountry", label: "Country", type: "text", category: "Contact Information", filter: "contact", custom: false, writeTarget: "event.person.addresses.country", choices: [] },
  { apiName: "source", label: "Source", type: "text", category: "Lead Information", filter: "lead", custom: false, writeTarget: "event.source", choices: [], help: "The lead source stored on the Follow Up Boss event." },
  { apiName: "tags", label: "Tags", type: "text", category: "Lead Information", filter: "lead", custom: false, writeTarget: "tags", choices: [], help: "Added as a Follow Up Boss tag after the person is saved. It is not written on the lead event." },
  { apiName: "stage", label: "Stage", type: "text", category: "Lead Information", filter: "lead", custom: false, writeTarget: "event.person", choices: [] },
  { apiName: "price", label: "Price", type: "number", category: "Lead Information", filter: "lead", custom: false, writeTarget: "event.person", choices: [] },
  { apiName: "background", label: "Background", type: "text", category: "Lead Information", filter: "lead", custom: false, writeTarget: "person.background", choices: [], help: "Replaces the contact background. Prefer “Save answer to the lead note” when you only want to keep the Facebook answer." },
  { apiName: "message", label: "Message", type: "text", category: "Lead Information", filter: "lead", custom: false, writeTarget: "event.message", choices: [], help: "The message saved with the new lead. This is the same field Zapier calls Message." },
  { apiName: "assignedTo", label: "Assigned Agent", type: "text", category: "Assignment", filter: "assignment", custom: false, writeTarget: "event.person", choices: [], help: "The agent's full name, exactly as it appears in Follow Up Boss." },
  { apiName: "assignedUserId", label: "Assigned Agent On Team", type: "dropdown", category: "Assignment", filter: "assignment", custom: false, writeTarget: "event.person", choices: [], help: "Filled in after Follow Up Boss users are refreshed." },
  { apiName: "timeframeId", label: "Timeframe", type: "dropdown", category: "Lead Information", filter: "lead", custom: false, writeTarget: "person.timeframeId", choices: [] },
  { apiName: "assignedPondId", label: "Assigned Pond", type: "dropdown", category: "Assignment", filter: "assignment", custom: false, writeTarget: "person.assignedPondId", choices: [] },
  { apiName: "campaignSource", label: "Campaign Source", type: "text", category: "Marketing Information", filter: "marketing", custom: false, writeTarget: "event.campaign.source", choices: [], help: "Shown in Follow Up Boss marketing reports." },
  { apiName: "campaignName", label: "Campaign", type: "text", category: "Marketing Information", filter: "marketing", custom: false, writeTarget: "event.campaign.campaign", choices: [] },
  { apiName: "campaignAdGroup", label: "Ad Group", type: "text", category: "Marketing Information", filter: "marketing", custom: false, writeTarget: "event.campaign.term", choices: [], help: "Sent as the campaign term, which is the Follow Up Boss field for ad group." },
  { apiName: "campaignAd", label: "Ad", type: "text", category: "Marketing Information", filter: "marketing", custom: false, writeTarget: "event.campaign.content", choices: [], help: "Sent as the campaign content, which is the Follow Up Boss field for the ad." },
];

const PRIMARY_FIELD_ORDER = ["firstName", "lastName", "emails", "phones", "message", "source", "tags"];

export function organizeDestinationFields(fields: DestinationField[]): DestinationField[] {
  const byName = new Map(fields.map((field) => [field.apiName, field]));
  const primary = PRIMARY_FIELD_ORDER.map((apiName) => byName.get(apiName)).filter((field): field is DestinationField => Boolean(field));
  const used = new Set(primary.map((field) => field.apiName));
  const custom = fields
    .filter((field) => field.custom && !used.has(field.apiName))
    .sort((a, b) => a.label.localeCompare(b.label));
  const rest = fields.filter((field) => !field.custom && !used.has(field.apiName));
  return [...primary, ...custom, ...rest];
}

export function mergeDestinationFields(custom: DestinationField[], lookups: DestinationField[] = []): DestinationField[] {
  const standard = STANDARD_FUB_FIELDS.map((field) => {
    const lookup = lookups.find((item) => item.apiName === field.apiName);
    if (!lookup) return field;
    return { ...field, choices: lookup.choices, choiceMap: lookup.choiceMap };
  });
  const customNames = new Set(custom.map((field) => field.apiName));
  return organizeDestinationFields([...standard.filter((field) => !customNames.has(field.apiName)), ...custom]);
}
