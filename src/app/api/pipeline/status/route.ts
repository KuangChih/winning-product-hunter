/**
 * Progress of the pipeline for the discovery page (ADR-013), polled while a run is active. Also
 * the watchdog: a run nobody has driven for a while (a killed function, a broken hand-off) gets
 * a tick after the response.
 */
import { after, type NextRequest } from "next/server";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { hasSiteAccess, SITE_AUTH_COOKIE } from "@/lib/site-auth";
import { getLatestRun } from "@/pipeline/runner";
import { resolveSelfOrigin } from "@/pipeline/transport";
import {
  loadProgress,
  logFailure,
  pipelineGate,
  tickAndKick,
  toStatus,
  watchdogAction,
} from "@/pipeline/web";

// Node.js runtime: the default (the bundled docs say to leave out the `runtime` export).
export const maxDuration = 300;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  if (!(await hasSiteAccess(request.cookies.get(SITE_AUTH_COOKIE)?.value))) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!isDatabaseConfigured()) {
    return json(toStatus(null, { configured: false, migrated: false }));
  }

  const db = await getDb();
  try {
    if (!pipelineGate()) {
      const latest = await getLatestRun(db);
      if (latest && (await watchdogAction(db, latest)) === "resume") {
        const origin = resolveSelfOrigin(request.nextUrl.origin);
        const runId = latest.id;
        after(logFailure(`resume of run #${runId}`, () => tickAndKick(db, { runId, origin })));
      }
    }
    return json(toStatus(await loadProgress(db), { configured: true, migrated: true }));
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return json(toStatus(null, { configured: true, migrated: false }));
  }
}
