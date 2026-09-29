export const LEAD_STATUSES = [
  "received",
  "queued",
  "processing",
  "delivered",
  "delivered_with_warning",
  "failed",
  "retrying",
  "ignored",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const WORKFLOW_STATUSES = ["draft", "active", "paused"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const FUB_EVENT_TYPES = [
  "General Inquiry",
  "Registration",
  "Seller Inquiry",
  "Property Inquiry",
  "Inquiry",
] as const;

export type FubEventType = (typeof FUB_EVENT_TYPES)[number];

export type SourceGroup = "contact" | "question" | "metadata" | "marketing";

export type SourceField = {
  key: string;
  label: string;
  group: SourceGroup;
};

export type Transform =
  | { type: "none" }
  | { type: "trim" }
  | { type: "lowercase" }
  | { type: "uppercase" }
  | { type: "phone" }
  | { type: "split_full_name" }
  | { type: "prefix"; value: string }
  | { type: "suffix"; value: string }
  | { type: "default_if_empty"; value: string }
  | { type: "combine"; fieldKeys: string[]; separator: string }
  | { type: "template"; template: string }
  | { type: "date"; format: "iso" | "date" }
  | { type: "static"; value: string };

export type RuleOperator =
  | "is"
  | "is_not"
  | "contains"
  | "not_contains"
  | "is_empty"
  | "is_not_empty"
  | "starts_with"
  | "ends_with";

export type RuleCondition = {
  sourceKey: string;
  operator: RuleOperator;
  value: string;
};

export type WorkflowRule = {
  id: string;
  combinator: "and" | "or";
  conditions: RuleCondition[];
  tag: string;
};

export type DestinationField = {
  apiName: string;
  label: string;
  type: string;
  category: string;
  filter: "standard" | "custom" | "contact" | "assignment" | "marketing" | "lead";
  custom: boolean;
  writeTarget: string;
  choices: string[];
  choiceMap?: Record<string, string>;
  isRecurring?: boolean;
  help?: string;
  fubId?: string;
};

export type FieldMapping = {
  sourceKey: string;
  sourceLabel: string;
  sourceGroup: SourceGroup;
  destinationApiName: string | null;
  destinationLabel: string | null;
  transform: Transform;
  ignored: boolean;
  saveToBackground: boolean;
};

export type StaticValue = {
  destinationApiName: string;
  destinationLabel: string;
  value: string;
};

export type WorkflowTag =
  | { kind: "static"; value: string }
  | { kind: "dynamic"; value: string };

export type ValueTranslation = {
  destinationApiName: string;
  fromValue: string;
  toValue: string;
};

export type FacebookLeadValues = Record<string, string>;

export type MappedPreviewItem = {
  label: string;
  value: string;
};

export type FriendlyDeliveryError = {
  friendly: string;
  technical: string;
  fieldLabel?: string;
  expected?: string[];
};

export type FubCampaign = {
  source: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
};

export type FubEventPayload = {
  source: string;
  system: string;
  type: string;
  message?: string;
  description?: string;
  person: Record<string, unknown>;
  campaign?: FubCampaign;
};

export type PayloadBuildResult =
  | {
      ok: true;
      payload: FubEventPayload;
      tags: string[];
      personUpdates: Record<string, string | number>;
      preview: MappedPreviewItem[];
      warnings: string[];
    }
  | { ok: false; error: FriendlyDeliveryError };

export type MatchableWorkflow = {
  id: string;
  name: string;
  status: WorkflowStatus;
  pageId: string | null;
  formId: string | null;
  formScope: "specific" | "any";
  updatedAt: string;
};

export type RetryClass = "retry" | "permanent";

export const FACEBOOK_METADATA_FIELDS: SourceField[] = [
  { key: "lead_id", label: "Facebook Lead ID", group: "metadata" },
  { key: "created_time", label: "Lead Created Time", group: "metadata" },
  { key: "page_id", label: "Facebook Page ID", group: "metadata" },
  { key: "page_name", label: "Facebook Page Name", group: "metadata" },
  { key: "form_id", label: "Form ID", group: "metadata" },
  { key: "form_name", label: "Form Name", group: "metadata" },
  { key: "platform", label: "Platform", group: "metadata" },
  { key: "campaign_id", label: "Campaign ID", group: "marketing" },
  { key: "campaign_name", label: "Campaign Name", group: "marketing" },
  { key: "adset_id", label: "Ad Set ID", group: "marketing" },
  { key: "adset_name", label: "Ad Set Name", group: "marketing" },
  { key: "ad_id", label: "Ad ID", group: "marketing" },
  { key: "ad_name", label: "Ad Name", group: "marketing" },
];

export const TRANSFORM_OPTIONS: Array<{ type: Transform["type"]; label: string }> = [
  { type: "none", label: "No transformation" },
  { type: "trim", label: "Trim spaces" },
  { type: "lowercase", label: "Lowercase" },
  { type: "uppercase", label: "Uppercase" },
  { type: "phone", label: "Normalize phone number" },
  { type: "split_full_name", label: "Split full name" },
  { type: "prefix", label: "Add prefix" },
  { type: "suffix", label: "Add suffix" },
  { type: "default_if_empty", label: "Default value if empty" },
  { type: "template", label: "Combine with text" },
  { type: "combine", label: "Combine fields" },
  { type: "date", label: "Date formatting" },
  { type: "static", label: "Static value" },
];
