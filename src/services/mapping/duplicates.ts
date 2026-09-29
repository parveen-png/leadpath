export type IntakeDecision = "create" | "duplicate" | "needs_confirmation";

export function decideLeadIntake(input: {
  existingLeadId: string | null;
  incomingIsTest: boolean;
  confirmReplay: boolean;
}): IntakeDecision {
  if (!input.existingLeadId) return "create";
  if (input.incomingIsTest && input.confirmReplay) return "create";
  if (input.incomingIsTest && !input.confirmReplay) return "needs_confirmation";
  return "duplicate";
}
