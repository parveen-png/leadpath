import type { MatchableWorkflow } from "@/types/domain";

export type WorkflowMatch = {
  workflow: MatchableWorkflow | null;
  warning?: string;
};

export function matchWorkflow(
  workflows: MatchableWorkflow[],
  pageId: string,
  formId: string,
): WorkflowMatch {
  const active = workflows.filter(
    (workflow) =>
      workflow.status === "active" &&
      workflow.pageId === pageId &&
      (workflow.formScope === "any" || workflow.formId === formId),
  );
  const specific = active.filter((workflow) => workflow.formScope === "specific" && workflow.formId === formId);
  const pool = specific.length > 0 ? specific : active.filter((workflow) => workflow.formScope === "any");
  if (pool.length === 0) return { workflow: null };
  const sorted = [...pool].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const winner = sorted[0] ?? null;
  return {
    workflow: winner,
    warning:
      sorted.length > 1
        ? "More than one workflow matched this lead. The most recently updated workflow was used."
        : undefined,
  };
}

export function activationConflicts(
  candidate: MatchableWorkflow,
  others: MatchableWorkflow[],
): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const active = others.filter(
    (workflow) => workflow.id !== candidate.id && workflow.status === "active" && workflow.pageId && workflow.pageId === candidate.pageId,
  );
  for (const other of active) {
    const sameForm =
      candidate.formScope === "specific" &&
      other.formScope === "specific" &&
      other.formId === candidate.formId;
    if (sameForm) {
      blockers.push(`“${other.name}” is already active for this form. Pause it before turning this workflow on.`);
    } else if (candidate.formScope === "any" && other.formScope === "any") {
      blockers.push(`“${other.name}” is already the catch-all workflow for this Page.`);
    } else if (candidate.formScope === "specific" && other.formScope === "any") {
      warnings.push(`“${other.name}” catches every form on this Page. This workflow will take priority for its form.`);
    } else if (candidate.formScope === "any" && other.formScope === "specific") {
      warnings.push(`“${other.name}” is active for one form and will take priority over this catch-all.`);
    }
  }
  return { blockers, warnings };
}
