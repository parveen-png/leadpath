import type { RetryClass } from "@/types/domain";

export const MAX_DELIVERY_ATTEMPTS = 5;

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export function classifyRetry(input: {
  httpStatus?: number | null;
  validationError?: boolean;
  networkError?: boolean;
}): RetryClass {
  if (input.validationError) return "permanent";
  if (input.networkError || input.httpStatus == null) return "retry";
  if (input.httpStatus === 408 || input.httpStatus === 429 || input.httpStatus >= 500) return "retry";
  if ([204, 400, 401, 403, 404, 409, 422].includes(input.httpStatus)) return "permanent";
  return "retry";
}

export function nextRetryDelayMs(failedAttempt: number): number | null {
  if (failedAttempt < 1 || failedAttempt >= MAX_DELIVERY_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[failedAttempt - 1] ?? null;
}

export function nextRetryAt(failedAttempt: number, now = new Date()): Date | null {
  const delay = nextRetryDelayMs(failedAttempt);
  if (delay == null) return null;
  return new Date(now.getTime() + delay);
}
