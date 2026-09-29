import type { FriendlyDeliveryError, RetryClass } from "@/types/domain";

type MetaErrorBody = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
  };
};

type FubErrorBody = {
  errorMessage?: string;
  error?: string;
  message?: string;
};

function asRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

export function readMetaError(body: unknown): { message?: string; code?: number } {
  const record = asRecord(body);
  const error = asRecord(record?.error);
  return {
    message: typeof error?.message === "string" ? error.message : undefined,
    code: typeof error?.code === "number" ? error.code : undefined,
  };
}

export function readFubErrorMessage(body: unknown): string | undefined {
  const record = asRecord(body) as FubErrorBody | null;
  if (!record) return undefined;
  if (typeof record.errorMessage === "string") return record.errorMessage;
  if (typeof record.error === "string") return record.error;
  if (typeof record.message === "string") return record.message;
  return undefined;
}

export function friendlyMetaError(status: number, body: unknown): FriendlyDeliveryError {
  const parsed = readMetaError(body);
  const technical = [`Facebook returned HTTP ${status}`, parsed.code ? `code ${parsed.code}` : "", parsed.message]
    .filter(Boolean)
    .join(". ");
  if (parsed.code === 190) {
    return {
      friendly: "We couldn't connect to Facebook. Your access token may have expired. Reconnect or update the token.",
      technical,
    };
  }
  if (status === 401 || status === 403 || parsed.code === 10 || parsed.code === 200) {
    return {
      friendly:
        "Facebook refused this request. The token may be missing permission to read Pages or lead forms.",
      technical,
    };
  }
  return {
    friendly: "We couldn't connect to Facebook. Try the connection again, or replace the access token.",
    technical,
  };
}

export function friendlyFubError(status: number, body: unknown): FriendlyDeliveryError {
  const message = readFubErrorMessage(body);
  const technical = [`Follow Up Boss returned HTTP ${status}`, message].filter(Boolean).join(". ");
  if (status === 401 || status === 403) {
    return {
      friendly: "Follow Up Boss didn't accept these credentials. Check the API key, and the system name and system key if you use them.",
      technical,
    };
  }
  if (status === 429) {
    return {
      friendly: "Follow Up Boss is busy right now. Leadpath will retry this delivery automatically.",
      technical,
    };
  }
  if (message && message.length < 240 && !/exception|stack trace|sql/i.test(message)) {
    return {
      friendly: `Follow Up Boss couldn't accept this lead. ${message}`,
      technical,
    };
  }
  return {
    friendly: "Follow Up Boss couldn't accept this lead. Open technical details for the response summary.",
    technical,
  };
}

export function classifyHttpFailure(input: {
  status?: number | null;
  validationError?: boolean;
  networkError?: boolean;
}): RetryClass {
  if (input.validationError) return "permanent";
  if (input.networkError || input.status == null) return "retry";
  if (input.status === 408 || input.status === 429 || input.status >= 500) return "retry";
  if (
    input.status === 204 ||
    input.status === 400 ||
    input.status === 401 ||
    input.status === 403 ||
    input.status === 404 ||
    input.status === 409 ||
    input.status === 422
  ) {
    return "permanent";
  }
  return "retry";
}

export function safeResponseSummary(body: unknown): string {
  const message = readFubErrorMessage(body) ?? readMetaError(body).message;
  if (!message) return "";
  return message.replace(/[A-Za-z0-9_\-]{24,}/g, "[redacted]").slice(0, 500);
}

export type { MetaErrorBody };
