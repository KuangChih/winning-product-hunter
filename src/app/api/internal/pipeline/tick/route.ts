/**
 * One tick of a pipeline run (ADR-013), requested by the previous tick of the same run. Answers
 * 202 at once and works after the response, then hands the run to the next tick. Not behind the
 * site password (the proxy skips `/api/internal/`): it needs the derived Bearer token instead.
 */
import { after, type NextRequest } from "next/server";
import { getDb, isDatabaseConfigured } from "@/db/client";
import { checkPipelineAuth } from "@/lib/internal-auth";
import { getRun } from "@/pipeline/runner";
import { resolveSelfOrigin } from "@/pipeline/transport";
import { canDriveRun, logFailure, pipelineGate, tickAndKick } from "@/pipeline/web";

// Node.js runtime: the default (the bundled docs say to leave out the `runtime` export).
export const maxDuration = 300;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const auth = await checkPipelineAuth(request.headers.get("authorization"));
  if (auth === "unconfigured") return json({ error: "unconfigured" }, 503);
  if (auth !== "ok") return json({ error: "unauthorized" }, 401);
  const gate = pipelineGate();
  if (gate) return json({ error: gate }, 503);
  if (!isDatabaseConfigured()) return json({ error: "no_database" }, 503);

  const body: unknown = await request.json().catch(() => null);
  const runId = Number((body as { runId?: unknown } | null)?.runId);
  if (!Number.isSafeInteger(runId) || runId <= 0) return json({ error: "invalid_run" }, 400);

  const db = await getDb();
  const run = await getRun(db, runId);
  if (!run) return json({ error: "not_found" }, 404);
  if (run.status !== "running") return json({ accepted: false, status: run.status });
  if (!canDriveRun(run)) return json({ error: "other_environment" }, 409);

  const origin = resolveSelfOrigin(request.nextUrl.origin);
  after(logFailure(`tick of run #${runId}`, () => tickAndKick(db, { runId, origin })));
  return json({ accepted: true }, 202);
}
