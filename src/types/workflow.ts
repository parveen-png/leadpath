import type {
  FieldMapping,
  StaticValue,
  Transform,
  ValueTranslation,
  WorkflowRule,
  WorkflowStatus,
  WorkflowTag,
} from "@/types/domain";

export type WorkflowDraft = {
  id: string;
  name: string;
  status: WorkflowStatus;
  pageId: string | null;
  pageName: string | null;
  formId: string | null;
  formName: string | null;
  formScope: "specific" | "any";
  eventType: string;
  sourceName: string;
  campaignSource: string;
  systemName: string;
  isDemo: boolean;
  mappings: FieldMapping[];
  staticValues: StaticValue[];
  tags: WorkflowTag[];
  rules: WorkflowRule[];
  translations: ValueTranslation[];
};

export function emptyTransform(): Transform {
  return { type: "none" };
}
