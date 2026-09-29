import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const idSchema = z.union([z.string(), z.number()]).transform((value) => String(value));

const leadgenSchema = z.object({
  leadgen_id: idSchema,
  page_id: idSchema,
  form_id: idSchema,
  adgroup_id: idSchema.optional(),
  ad_id: idSchema.optional(),
  created_time: z.union([z.string(), z.number()]).optional(),
});

const webhookSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        id: idSchema.optional(),
        time: z.number().optional(),
        changes: z
          .array(
            z.object({
              field: z.string(),
              value: z.unknown(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export type LeadgenNotice = {
  leadgenId: string;
  pageId: string;
  formId: string;
  adgroupId?: string;
  adId?: string;
  createdTime?: string;
};

export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const [scheme, signature] = header.split("=");
  if (scheme !== "sha256" || !signature) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) return false;
  return timingSafeEqual(actual, wanted);
}

export function readVerifyChallenge(
  params: { get(name: string): string | null },
  verifyToken: string,
): { ok: true; challenge: string } | { ok: false } {
  const mode = params.get("hub.mode") ?? params.get("hub_mode");
  const token = params.get("hub.verify_token") ?? params.get("hub_verify_token");
  const challenge = params.get("hub.challenge") ?? params.get("hub_challenge");
  if (mode !== "subscribe" || !challenge || !token || !verifyToken) return { ok: false };
  const left = Buffer.from(token);
  const right = Buffer.from(verifyToken);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return { ok: false };
  return { ok: true, challenge };
}

export function extractLeadgenNotices(body: unknown): LeadgenNotice[] {
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) return [];
  if (parsed.data.object && parsed.data.object !== "page") return [];
  const notices: LeadgenNotice[] = [];
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const value = leadgenSchema.safeParse(change.value);
      if (!value.success) continue;
      notices.push({
        leadgenId: value.data.leadgen_id,
        pageId: value.data.page_id,
        formId: value.data.form_id,
        adgroupId: value.data.adgroup_id,
        adId: value.data.ad_id,
        createdTime:
          value.data.created_time === undefined
            ? undefined
            : typeof value.data.created_time === "number"
              ? new Date(value.data.created_time * 1000).toISOString()
              : value.data.created_time,
      });
    }
  }
  return notices;
}
