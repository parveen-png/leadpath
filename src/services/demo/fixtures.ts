import type { SourceField } from "@/types/domain";

export const DEMO_PAGE_ID = "demo-team-arora";
export const DEMO_FORM_ID = "demo-five-oaks";

export const demoPages = [
  { id: DEMO_PAGE_ID, name: "Team Arora", isDemo: true },
  { id: "demo-remax-quantum", name: "RE/MAX Quantum Realty", isDemo: true },
];

export const demoForms = [
  {
    id: DEMO_FORM_ID,
    pageId: DEMO_PAGE_ID,
    name: "Five Oaks Registration",
    status: "ACTIVE",
    updatedAt: "2026-03-12T15:00:00.000Z",
    fieldCount: 6,
    isDemo: true,
  },
  {
    pageId: DEMO_PAGE_ID,
    id: "demo-brampton-evaluation",
    name: "Brampton Home Evaluation",
    status: "ACTIVE",
    updatedAt: "2026-02-02T15:00:00.000Z",
    fieldCount: 4,
    isDemo: true,
  },
];

export const demoQuestions: SourceField[] = [
  { key: "full_name", label: "Full Name", group: "contact" },
  { key: "email", label: "Email", group: "contact" },
  { key: "phone_number", label: "Phone Number", group: "contact" },
  { key: "realtor", label: "Are you working with a Realtor?", group: "question" },
  { key: "buying_timeframe", label: "Buying Timeframe", group: "question" },
  { key: "preferred_city", label: "Preferred City", group: "question" },
];

export const demoSampleValues: Record<string, string> = {
  full_name: "John Smith",
  email: "john@example.com",
  phone_number: "647-555-1111",
  realtor: "No",
  buying_timeframe: "0-3 Months",
  preferred_city: "Oakville",
  lead_id: "demo-lead-1001",
  created_time: "2026-03-20T14:42:00.000Z",
  page_id: DEMO_PAGE_ID,
  page_name: "Team Arora",
  form_id: DEMO_FORM_ID,
  form_name: "Five Oaks Registration",
  campaign_id: "demo-campaign",
  campaign_name: "Oakville Buyers",
  adset_id: "demo-adset",
  adset_name: "Five Oaks",
  ad_id: "demo-ad",
  ad_name: "Spring Video",
  platform: "facebook",
};

export function isDemoIdentifier(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith("demo-"));
}
