import type { SourceField } from "@/types/domain";
import { FACEBOOK_METADATA_FIELDS } from "@/types/domain";
import { humanizeKey, isContactField } from "@/services/mapping/normalize";

export function sourceFieldsForQuestions(questions: Array<{ key: string; label?: string }>): SourceField[] {
  const fields: SourceField[] = questions.map((question) => {
    const label = question.label?.trim() || humanizeKey(question.key);
    return {
      key: question.key,
      label,
      group: isContactField(question.key, label) ? "contact" : "question",
    };
  });
  return [...fields, ...FACEBOOK_METADATA_FIELDS];
}

export function leadValuesFromParts(input: {
  answers: Record<string, string>;
  leadId?: string | null;
  createdTime?: string | null;
  pageId?: string | null;
  pageName?: string | null;
  formId?: string | null;
  formName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adsetId?: string | null;
  adsetName?: string | null;
  adId?: string | null;
  adName?: string | null;
  platform?: string | null;
}): Record<string, string> {
  const values: Record<string, string> = { ...input.answers };
  const metadata: Record<string, string | null | undefined> = {
    lead_id: input.leadId,
    created_time: input.createdTime,
    page_id: input.pageId,
    page_name: input.pageName,
    form_id: input.formId,
    form_name: input.formName,
    campaign_id: input.campaignId,
    campaign_name: input.campaignName,
    adset_id: input.adsetId,
    adset_name: input.adsetName,
    ad_id: input.adId,
    ad_name: input.adName,
    platform: input.platform,
  };
  for (const [key, value] of Object.entries(metadata)) {
    if (value) values[key] = value;
  }
  return values;
}
