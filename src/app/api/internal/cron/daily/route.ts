/**
 * Daily automatic discovery (ADR-013), called by Vercel Cron at 06, 07, 08 and 09 UTC
 * (`vercel.json`). The first call of the day starts a run; the later calls only resume a run
 * nobody is driving (a broken hand-off between ticks when no browser is polling).
 * Requires `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET it answers 503.
 */
import { after, type NextRequest } from "next/server";
import { getDb, isDatabaseConfigured, isMissingTableError, type AnyDatabase } from "@/db/client";
import { checkCronAuth } from "@/lib/internal-auth";
import { pipelineEnv } from "@/pipeline/live-deps";
import { createRun, DEFAULT_RUN_OPTIONS, getActiveRun, shouldCronStart } from "@/pipeline/runner";
import { resolveSelfOrigin } from "@/pipeline/transport";
import { logFailure, pipelineGate, tickAndKick, watchdogAction } from "@/pipeline/web";

// Node.js runtime: the default (the bundled docs say to leave out the `runtime` export).
export const maxDuration = 300;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  const auth = await checkCronAuth(request.headers.get("authorization"));
  if (auth === "unconfigured") return json({ error: "cron_not_configured" }, 503);
  if (auth !== "ok") return json({ error: "unauthorized" }, 401);
  const gate = pipelineGate();
  if (gate) return json({ action: "skipped", reason: gate });
  if (!isDatabaseConfigured()) return json({ error: "no_database" }, 503);

  const db = await getDb();
  const origin = resolveSelfOrigin(request.nextUrl.origin);
  const tick = (runId: number, what: string) =>
    after(logFailure(`${what} of run #${runId}`, () => tickAndKick(db, { runId, origin })));

  try {
    return await driveDailyRun(db, tick);
  } catch (err) {
    // Before migrations: a clear answer instead of an unhandled 500 at every cron call.
    if (isMissingTableError(err)) return json({ error: "migrations" }, 503);
    throw err;
  }
}

async function driveDailyRun(
  db: AnyDatabase,
  tick: (runId: number, what: string) => void,
): Promise<Response> {
  const active = await getActiveRun(db);
  if (active) {
    const action = await watchdogAction(db, active);
    if (action === "resume") tick(active.id, "resume");
    if (action !== "expired") {
      return json({ action: action === "resume" ? "resumed" : "running", runId: active.id });
    }
    // An expired run was closed: today may still need its run.
  }

  const decision = await shouldCronStart(db, new Date());
  if (!decision.start) return json({ action: "skipped", reason: decision.reason });
  const { run, created } = await createRun(db, {
    trigger: "cron",
    options: DEFAULT_RUN_OPTIONS,
    env: pipelineEnv(),
  });
  if (created) tick(run.id, "first tick");
  return json({ action: created ? "started" : "running", runId: run.id });
}
