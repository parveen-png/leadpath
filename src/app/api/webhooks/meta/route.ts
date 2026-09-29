import { after } from "next/server";

import { ingestMetaWebhook, processDueJobs, verifyMetaWebhook } from "@/services/leads/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  return verifyMetaWebhook(url.searchParams);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const response = await ingestMetaWebhook(rawBody, signature);
  if (response.status === 200) {
    after(async () => {
      await processDueJobs(8);
    });
  }
  return response;
}
