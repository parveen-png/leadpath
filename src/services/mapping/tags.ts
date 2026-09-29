import { matchingRuleTags } from "@/services/mapping/rules";
import { uniqueStrings } from "@/lib/utils";
import type { WorkflowRule, WorkflowTag } from "@/types/domain";

export function collectTags(input: {
  tags: WorkflowTag[];
  rules: WorkflowRule[];
  values: Record<string, string>;
}): string[] {
  const staticTags = input.tags.filter((tag) => tag.kind === "static").map((tag) => tag.value);
  const dynamicTags = input.tags
    .filter((tag) => tag.kind === "dynamic")
    .map((tag) => input.values[tag.value] ?? "");
  const ruleTags = matchingRuleTags(input.rules, input.values);
  return uniqueStrings([...staticTags, ...dynamicTags, ...ruleTags]);
}
