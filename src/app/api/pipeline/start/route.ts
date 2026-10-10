/**
 * "Start discovery" (ADR-013): creates a web run, or returns the active one, and runs its first
 * tick after the response. A route rather than a Server Action: action IDs change with every
 * deployment, and a phone tab opened before a deploy would fail.
 *
 * Body (optional JSON): `{ "keywords": "a, b" }` — custom keywords, validated like the CLI's.
 */
import { after, type NextRequest } from "next/server";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { hasSiteAccess, SITE_AUTH_COOKIE } from "@/lib/site-auth";
import { pipelineEnv } from "@/pipeline/live-deps";
import { createRun, isStalled, parseRunOptions, RunOptionsError } from "@/pipeline/runner";
import { resolveSelfOrigin } from "@/pipeline/transport";
import {
  canDriveRun,
  isSameOriginRequest,
  loadProgress,
  logFailure,
  startBlockedReason,
  tickAndKick,
} from "@/pipeline/web";

// Node.js runtime: the default (the bundled docs say to leave out the `runtime` export).
export const maxDuration = 300;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function readKeywords(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return undefined;
  const body: unknown = JSON.parse(text);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RunOptionsError("Body must be a JSON object");
  }
  return (body as { keywords?: unknown }).keywords;
}

export async function POST(request: NextRequest) {
  // The proxy checks the cookie too; checked again here (defense in depth, ADR-003).
  if (!(await hasSiteAccess(request.cookies.get(SITE_AUTH_COOKIE)?.value))) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!isSameOriginRequest(request.headers)) return json({ error: "forbidden_origin" }, 403);

  const configured = isDatabaseConfigured();
  const early = startBlockedReason({ configured, migrated: true });
  if (early) return json({ error: early }, early === "no_database" ? 503 : 403);

  let options;
  try {
    options = parseRunOptions({ keywords: await readKeywords(request) });
  } catch (err) {
    if (err instanceof RunOptionsError) {
      return json({ error: "invalid_options", message: err.message }, 400);
    }
    if (err instanceof SyntaxError) return json({ error: "invalid_json" }, 400);
    throw err;
  }

  const db = await getDb();
  let created: boolean;
  let run;
  try {
    ({ run, created } = await createRun(db, { trigger: "web", options, env: pipelineEnv() }));
  } catch (err) {
    if (isMissingTableError(err)) return json({ error: "migrations" }, 503);
    throw err;
  }

  // A new run starts now; an existing one nobody is driving is resumed (double click, two tabs).
  if (created || (canDriveRun(run) && isStalled(run, Date.now()))) {
    const origin = resolveSelfOrigin(request.nextUrl.origin);
    const runId = run.id;
    after(logFailure(`tick of run #${runId}`, () => tickAndKick(db, { runId, origin })));
  }
  // Keywords sent while another run is active are not used: say so instead of "started".
  const ignoredOptions = !created && options.keywords !== null;
  return json(
    { ok: true, created, ignoredOptions, runId: run.id, progress: await loadProgress(db) },
    created ? 201 : 200,
  );
}
