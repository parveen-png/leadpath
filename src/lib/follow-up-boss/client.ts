import { z } from "zod";

import { friendlyFubError, readFubErrorMessage } from "@/lib/errors/normalize";
import { HttpRequestError, httpRequest } from "@/lib/http/client";
import type { FubEventPayload } from "@/types/domain";

const customFieldSchema = z.object({
  id: z.union([z.number(), z.string()]),
  label: z.string(),
  name: z.string(),
  type: z.string(),
  isRecurring: z.boolean().optional(),
  choices: z.array(z.string()).optional(),
});

const identitySchema = z.object({
  account: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    domain: z.string().optional(),
    owner: z.object({ name: z.string().optional(), email: z.string().optional() }).optional(),
  }),
  user: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  }),
});

export type FubCredentials = {
  apiKey: string;
  systemName?: string;
  systemKey?: string;
};

export type FubCustomField = z.infer<typeof customFieldSchema>;
export type FubIdentity = z.infer<typeof identitySchema>;

export type FubConnectionTest = {
  ok: true;
  accountName: string;
  domain?: string;
  customFieldCount: number;
  userName?: string;
} | {
  ok: false;
  friendly: string;
  technical: string;
};

export class FollowUpBossClient {
  constructor(
    private readonly credentials: FubCredentials,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.credentials.apiKey}:`).toString("base64")}`,
    };
    if (this.credentials.systemName && this.credentials.systemKey) {
      headers["X-System"] = this.credentials.systemName;
      headers["X-System-Key"] = this.credentials.systemKey;
    }
    return headers;
  }

  private async request<T>(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown): Promise<{ status: number; data: T }> {
    const result = await httpRequest<T>(`https://api.followupboss.com/v1${path}`, {
      method,
      headers: this.headers(),
      body,
      fetchImpl: this.fetchImpl,
      timeoutMs: method === "GET" ? 20_000 : 25_000,
      retryGet: method === "GET",
    });
    return { status: result.status, data: result.data };
  }

  async testConnection(): Promise<FubConnectionTest> {
    try {
      const identity = await this.getIdentity();
      const fields = await this.listCustomFields();
      return {
        ok: true,
        accountName: identity.account.owner?.name || identity.account.domain || identity.user.name || "Follow Up Boss",
        domain: identity.account.domain,
        customFieldCount: fields.length,
        userName: identity.user.name,
      };
    } catch (error) {
      if (error instanceof HttpRequestError) {
        const friendly = friendlyFubError(error.status, error.body);
        return { ok: false, friendly: friendly.friendly, technical: friendly.technical };
      }
      return {
        ok: false,
        friendly: "We couldn't reach Follow Up Boss. Check the API key and try again.",
        technical: error instanceof Error ? error.message : "Unknown Follow Up Boss error",
      };
    }
  }

  async getIdentity(): Promise<FubIdentity> {
    const result = await this.request<unknown>("/identity");
    return identitySchema.parse(result.data);
  }

  async listCustomFields(): Promise<FubCustomField[]> {
    const fields: FubCustomField[] = [];
    let offset = 0;
    for (let page = 0; page < 50; page += 1) {
      const result = await this.request<{
        _metadata?: { total?: number | string };
        customfields?: unknown[];
      }>(`/customFields?limit=100&offset=${offset}`);
      const batch = z.array(customFieldSchema).parse(result.data.customfields ?? []);
      fields.push(...batch);
      const total = Number(result.data._metadata?.total ?? fields.length);
      offset += batch.length;
      if (batch.length === 0 || offset >= total) break;
    }
    return fields;
  }

  async listFlexible(path: string): Promise<Array<{ id: string; name: string }>> {
    try {
      const result = await this.request<Record<string, unknown>>(path);
      const collections = Object.values(result.data).filter(Array.isArray);
      for (const rows of collections) {
        const parsed = rows.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const record = row as Record<string, unknown>;
          const id = record.id;
          const name = record.name ?? record.label;
          if ((typeof id !== "number" && typeof id !== "string") || typeof name !== "string") return [];
          return [{ id: String(id), name }];
        });
        if (parsed.length > 0) return parsed;
      }
      return [];
    } catch (error) {
      if (error instanceof HttpRequestError && (error.status === 404 || error.status === 403)) return [];
      throw error;
    }
  }

  async listNamedRecords(path: string, collection: string): Promise<Array<{ id: string; name: string }>> {
    try {
      const result = await this.request<Record<string, unknown>>(path);
      const rows = result.data[collection];
      if (!Array.isArray(rows)) return [];
      return rows.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const record = row as Record<string, unknown>;
        const id = record.id;
        const name = record.name ?? record.label;
        if ((typeof id !== "number" && typeof id !== "string") || typeof name !== "string") return [];
        return [{ id: String(id), name }];
      });
    } catch (error) {
      if (error instanceof HttpRequestError && (error.status === 404 || error.status === 403)) return [];
      throw error;
    }
  }

  async createEvent(payload: FubEventPayload): Promise<{ status: number; personId: string | null; body: unknown }> {
    const result = await this.request<unknown>("/events", "POST", payload);
    if (result.status === 204) return { status: 204, personId: null, body: null };
    const personId = readPersonId(result.data);
    return { status: result.status, personId, body: result.data };
  }

  async updatePerson(personId: string, body: Record<string, unknown>, mergeTags = false): Promise<{ status: number; body: unknown }> {
    const path = mergeTags ? `/people/${encodeURIComponent(personId)}?mergeTags=true` : `/people/${encodeURIComponent(personId)}`;
    const result = await this.request<unknown>(path, "PUT", body);
    return { status: result.status, body: result.data };
  }

  async mergeTags(personId: string, tags: string[]): Promise<{ status: number; body: unknown }> {
    return this.updatePerson(personId, { tags }, true);
  }
}

function readPersonId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.id === "number" || typeof record.id === "string") return String(record.id);
  if (record.person && typeof record.person === "object") {
    const person = record.person as Record<string, unknown>;
    if (typeof person.id === "number" || typeof person.id === "string") return String(person.id);
  }
  return null;
}

export function fubPersonUrl(domain: string | null | undefined, personId: string | null | undefined): string | null {
  if (!domain || !personId) return null;
  if (!/^[a-z0-9-]+$/i.test(domain)) return null;
  if (!/^\d+$/.test(personId)) return null;
  return `https://${domain}.followupboss.com/2/people/view/${personId}`;
}

export function explainFubFailure(status: number, body: unknown): { friendly: string; technical: string } {
  const base = friendlyFubError(status, body);
  if (status === 204) {
    return {
      friendly: "Follow Up Boss ignored this lead because the lead flow for this source is archived.",
      technical: "HTTP 204 from POST /v1/events",
    };
  }
  return { ...base, technical: base.technical || readFubErrorMessage(body) || `HTTP ${status}` };
}
