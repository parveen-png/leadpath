import { z } from "zod";

import { friendlyMetaError } from "@/lib/errors/normalize";
import { HttpRequestError, httpRequest } from "@/lib/http/client";

const idSchema = z.union([z.string(), z.number()]).transform((value) => String(value));

const pageSchema = z.object({
  id: idSchema,
  name: z.string(),
  access_token: z.string().optional(),
  category: z.string().optional(),
});

const questionSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  type: z.string().optional(),
  options: z.array(z.object({ key: z.string().optional(), value: z.string().optional() })).optional(),
});

const formSchema = z.object({
  id: idSchema,
  name: z.string(),
  status: z.string().optional(),
  created_time: z.string().optional(),
  leads_count: z.number().optional(),
  questions: z.array(questionSchema).optional(),
});

const leadSchema = z.object({
  id: idSchema,
  created_time: z.string().optional(),
  form_id: idSchema.optional(),
  ad_id: idSchema.optional(),
  ad_name: z.string().optional(),
  adset_id: idSchema.optional(),
  adset_name: z.string().optional(),
  campaign_id: idSchema.optional(),
  campaign_name: z.string().optional(),
  platform: z.string().optional(),
  field_data: z
    .array(z.object({ name: z.string(), values: z.array(z.string()).default([]) }))
    .optional(),
});

export type MetaPage = z.infer<typeof pageSchema>;
export type MetaForm = z.infer<typeof formSchema>;
export type MetaLead = z.infer<typeof leadSchema>;

export type MetaConnectionTest = {
  ok: true;
  accountName: string;
  pageCount: number;
  formCount: number;
  pages: MetaPage[];
} | {
  ok: false;
  friendly: string;
  technical: string;
};

const LEAD_FIELDS = [
  "created_time",
  "id",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "form_id",
  "platform",
  "field_data",
].join(",");

const LEAD_FIELDS_FALLBACK = "created_time,id,ad_id,form_id,field_data";

export class MetaClient {
  constructor(
    private readonly options: {
      version: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  private url(path: string, params: Record<string, string | undefined> = {}) {
    const version = this.options.version.replace(/^\/+/, "");
    const endpoint = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(params)) {
      if (value) endpoint.searchParams.set(key, value);
    }
    return endpoint;
  }

  private async get<T>(path: string, token: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const endpoint = this.url(path, params);
    endpoint.searchParams.set("access_token", token);
    try {
      const result = await httpRequest<T>(endpoint.toString(), { fetchImpl: this.options.fetchImpl, timeoutMs: 20_000 });
      return result.data;
    } catch (error) {
      if (error instanceof HttpRequestError) {
        const friendly = friendlyMetaError(error.status, error.body);
        throw Object.assign(error, { friendly: friendly.friendly, technical: friendly.technical });
      }
      throw error;
    }
  }

  async testConnection(token: string): Promise<MetaConnectionTest> {
    try {
      const pages = await this.listPages(token);
      let formCount = 0;
      for (const page of pages.slice(0, 10)) {
        const pageToken = page.access_token || token;
        const forms = await this.listForms(page.id, pageToken);
        formCount += forms.length;
      }
      return {
        ok: true,
        accountName: pages[0]?.name ?? "Facebook",
        pageCount: pages.length,
        formCount,
        pages,
      };
    } catch (error) {
      const friendly = error instanceof HttpRequestError ? friendlyMetaError(error.status, error.body) : null;
      const extra = error as { friendly?: string; technical?: string };
      return {
        ok: false,
        friendly: extra.friendly ?? friendly?.friendly ?? "We couldn't connect to Facebook. Your access token may have expired. Reconnect or update the token.",
        technical: extra.technical ?? friendly?.technical ?? "Facebook request failed before a response was received.",
      };
    }
  }

  async listPages(token: string): Promise<MetaPage[]> {
    try {
      const accounts = await this.get<{ data?: unknown[] }>("me/accounts", token, {
        fields: "id,name,access_token,category",
        limit: "100",
      });
      const pages = z.array(pageSchema).parse(accounts.data ?? []);
      if (pages.length > 0) return pages;
    } catch (error) {
      if (!(error instanceof HttpRequestError) && !(error instanceof z.ZodError)) throw error;
    }
    const me = await this.get<unknown>("me", token, { fields: "id,name" });
    const page = pageSchema.parse(me);
    return [{ ...page, access_token: token }];
  }

  async listForms(pageId: string, pageToken: string): Promise<MetaForm[]> {
    const forms: MetaForm[] = [];
    let after: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const data = await this.get<{ data?: unknown[]; paging?: { cursors?: { after?: string }; next?: string } }>(
        `${pageId}/leadgen_forms`,
        pageToken,
        {
          fields: "id,name,status,created_time,leads_count,questions",
          limit: "100",
          after,
        },
      );
      forms.push(...z.array(formSchema).parse(data.data ?? []));
      after = data.paging?.next ? data.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return forms;
  }

  async getForm(formId: string, pageToken: string): Promise<MetaForm> {
    const data = await this.get<unknown>(formId, pageToken, {
      fields: "id,name,status,created_time,leads_count,questions",
    });
    return formSchema.parse(data);
  }

  async getLead(leadId: string, pageToken: string): Promise<MetaLead> {
    try {
      const data = await this.get<unknown>(leadId, pageToken, { fields: LEAD_FIELDS });
      return leadSchema.parse(data);
    } catch (error) {
      if (!(error instanceof HttpRequestError) && !(error instanceof z.ZodError)) throw error;
      const data = await this.get<unknown>(leadId, pageToken, { fields: LEAD_FIELDS_FALLBACK });
      return leadSchema.parse(data);
    }
  }

  async listRecentLeads(formId: string, pageToken: string): Promise<MetaLead[]> {
    const data = await this.get<{ data?: unknown[] }>(`${formId}/leads`, pageToken, {
      fields: LEAD_FIELDS,
      limit: "10",
    });
    return z.array(leadSchema).parse(data.data ?? []);
  }

  async subscribePage(pageId: string, pageToken: string): Promise<void> {
    const endpoint = this.url(`${pageId}/subscribed_apps`, {
      subscribed_fields: "leadgen",
      access_token: pageToken,
    });
    await httpRequest(endpoint.toString(), { method: "POST", fetchImpl: this.options.fetchImpl });
  }
}

export function metaErrorMessage(error: unknown): { friendly: string; technical: string } {
  const extra = error as { friendly?: string; technical?: string };
  if (extra.friendly && extra.technical) return { friendly: extra.friendly, technical: extra.technical };
  if (error instanceof HttpRequestError) return friendlyMetaError(error.status, error.body);
  return {
    friendly: "We couldn't connect to Facebook. Your access token may have expired. Reconnect or update the token.",
    technical: error instanceof Error ? error.message : "Unknown Facebook error",
  };
}
