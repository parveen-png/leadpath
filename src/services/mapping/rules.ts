import { normalizeLabel } from "@/services/mapping/normalize";
import type { RuleCondition, RuleOperator, WorkflowRule } from "@/types/domain";

function compare(left: string, operator: RuleOperator, right: string): boolean {
  const value = left.trim();
  const expected = right.trim();
  const valueNorm = normalizeLabel(value);
  const expectedNorm = normalizeLabel(expected);
  switch (operator) {
    case "is":
      return valueNorm === expectedNorm;
    case "is_not":
      return valueNorm !== expectedNorm;
    case "contains":
      return valueNorm.includes(expectedNorm);
    case "not_contains":
      return !valueNorm.includes(expectedNorm);
    case "is_empty":
      return value.length === 0;
    case "is_not_empty":
      return value.length > 0;
    case "starts_with":
      return valueNorm.startsWith(expectedNorm);
    case "ends_with":
      return valueNorm.endsWith(expectedNorm);
    default: {
      const neverOperator: never = operator;
      return neverOperator;
    }
  }
}

export function conditionMatches(condition: RuleCondition, values: Record<string, string>): boolean {
  return compare(values[condition.sourceKey] ?? "", condition.operator, condition.value);
}

export function matchingRuleTags(rules: WorkflowRule[], values: Record<string, string>): string[] {
  const tags: string[] = [];
  for (const rule of rules) {
    if (!rule.tag.trim() || rule.conditions.length === 0) continue;
    const results = rule.conditions.map((condition) => conditionMatches(condition, values));
    const matched = rule.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
    if (matched) tags.push(rule.tag.trim());
  }
  return tags;
}
