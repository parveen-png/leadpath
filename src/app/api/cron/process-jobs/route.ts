import { getServerEnv } from "@/lib/env";
import { secretsEqual } from "@/lib/encryption/crypto";
import { processDueJobs } from "@/services/leads/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const env = getServerEnv();
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!env.CRON_SECRET || !token || !secretsEqual(token, env.CRON_SECRET)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const processed = await processDueJobs(20);
  return Response.json({ ok: true, processed });
}
