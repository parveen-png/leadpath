import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptString, encryptString, loadEncryptionKey, maskSecret } from "@/lib/encryption/crypto";
import { extractLeadgenNotices, readVerifyChallenge, verifyMetaSignature } from "@/lib/meta/webhook";
import { MetaClient } from "@/lib/meta/client";
import { FollowUpBossClient } from "@/lib/follow-up-boss/client";
import { redactValue } from "@/lib/logger/logger";

describe("encryption", () => {
  it("round-trips credentials and masks them", () => {
    const key = loadEncryptionKey(Buffer.from("12345678901234567890123456789012").toString("base64"));
    const encrypted = encryptString("page-token-A92F", key);
    expect(encrypted).not.toContain("page-token");
    expect(decryptString(encrypted, key)).toBe("page-token-A92F");
    expect(maskSecret("page-token-A92F")).toBe("••••••••••••A92F");
  });
});

describe("meta webhook", () => {
  it("verifies the signature and extracts lead notices", () => {
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "111",
          changes: [
            {
              field: "leadgen",
              value: { leadgen_id: 999, page_id: 111, form_id: 222, ad_id: 333, created_time: 1440120384 },
            },
          ],
        },
      ],
    });
    const signature = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, signature, "app-secret")).toBe(true);
    expect(verifyMetaSignature(body, signature, "other")).toBe(false);
    expect(extractLeadgenNotices(JSON.parse(body))[0]).toMatchObject({ leadgenId: "999", pageId: "111", formId: "222" });
    const params = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "token", "hub.challenge": "12345" });
    expect(readVerifyChallenge(params, "token")).toEqual({ ok: true, challenge: "12345" });
  });
});

describe("api clients", () => {
  it("lists pages and reads a lead from Graph", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/me/accounts")) {
        return Response.json({ data: [{ id: "10", name: "Team Arora", access_token: "page-token" }] });
      }
      if (url.includes("/leadgen_forms")) {
        return Response.json({ data: [{ id: "20", name: "Five Oaks Registration", status: "ACTIVE", questions: [] }] });
      }
      if (url.includes("/555")) {
        return Response.json({
          id: "555",
          created_time: "2026-01-01T00:00:00+0000",
          form_id: "20",
          campaign_name: "Oakville",
          field_data: [{ name: "email", values: ["a@example.com"] }],
        });
      }
      return Response.json({ id: "10", name: "Team Arora" });
    };
    const client = new MetaClient({ version: "v25.0", fetchImpl });
    const test = await client.testConnection("user-token");
    expect(test.ok).toBe(true);
    if (!test.ok) return;
    expect(test.pageCount).toBe(1);
    expect(test.formCount).toBe(1);
    const lead = await client.getLead("555", "page-token");
    expect(lead.field_data?.[0]?.name).toBe("email");
  });

  it("calls Follow Up Boss events and merges tags", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Basic ${Buffer.from("fub-key:").toString("base64")}`);
      expect(headers.get("x-system")).toBe("Leadpath");
      if (url.endsWith("/identity")) {
        return Response.json({ account: { domain: "team-arora", owner: { name: "Team Arora" } }, user: { name: "Asha" } });
      }
      if (url.includes("/customFields")) {
        return Response.json({
          _metadata: { total: 1 },
          customfields: [{ id: 4, label: "Buyer Timeframe", name: "customBuyerTimeframe", type: "dropdown", choices: ["0-3 Months"] }],
        });
      }
      if (url.endsWith("/events")) {
        const body = JSON.parse(String(init?.body));
        expect(body.type).toBe("General Inquiry");
        expect(body.person.tags).toBeUndefined();
        return Response.json({ id: 123456, firstName: "John" }, { status: 201 });
      }
      if (url.includes("mergeTags=true")) {
        const body = JSON.parse(String(init?.body));
        expect(body.tags).toEqual(["Facebook"]);
        return Response.json({ id: 123456, tags: ["Existing", "Facebook"] });
      }
      return Response.json({ errorMessage: "nope" }, { status: 404 });
    };
    const client = new FollowUpBossClient({ apiKey: "fub-key", systemName: "Leadpath", systemKey: "system-key" }, fetchImpl);
    const test = await client.testConnection();
    expect(test.ok).toBe(true);
    if (!test.ok) return;
    expect(test.accountName).toBe("Team Arora");
    expect(test.customFieldCount).toBe(1);
    const event = await client.createEvent({ source: "Facebook", system: "Leadpath", type: "General Inquiry", person: { firstName: "John" } });
    expect(event.personId).toBe("123456");
    await client.mergeTags("123456", ["Facebook"]);
    expect(calls.some((call) => call.includes("/people/123456?mergeTags=true"))).toBe(true);
  });
});

describe("logging", () => {
  it("never keeps tokens or full emails", () => {
    expect(redactValue({ accessToken: "secret-token", email: "john@example.com", note: "Call 6475551111" })).toEqual({
      accessToken: "[redacted]",
      email: "j***@example.com",
      note: "Call ***1111",
    });
  });
});
