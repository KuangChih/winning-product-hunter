/**
 * Daily real-data pipeline: ECB rates → discover products (Meta Ad Library) → follow advertisers
 * → collect Shopify Global Catalog evidence → advertiser stores → dedupe → match → score. Runs
 * the same resumable runner as the website's "start discovery" button (ADR-013), here without a
 * time budget; on Neon it attaches to a run that is already active.
 *
 *   npm run pipeline -- [--keywords=10] [--advertisers=10] [--collect=20] [--keyword="a,b"]
 *
 * PIPELINE_TICK_BUDGET_MS=<ms> splits the run into ticks as on Vercel (for testing resumption).
 */
import "@/lib/load-env";
import { getDb } from "@/db/client";
import { createLiveDeps, pipelineEnv } from "@/pipeline/live-deps";
import {
  abandonRun,
  createRun,
  driveRun,
  parseRunOptions,
  tickBudgetMs,
  type RunOptions,
} from "@/pipeline/runner";
import type { PipelineRunRow } from "@/pipeline/runner/store";
import { isLeaseFree } from "@/pipeline/runner/watchdog";
import { STEP_ORDER } from "@/pipeline/runner/state";
import { runJob } from "./run-job";

export function parsePipelineArgs(argv: string[]): RunOptions {
  const input: Record<string, unknown> = {};
  const names: Record<string, string> = {
    keywords: "keywordCount",
    advertisers: "advertisers",
    collect: "collect",
    keyword: "keywords",
  };
  for (const a of argv) {
    const m = /^--([a-z]+)=([\s\S]*)$/.exec(a);
    if (!m || !(m[1] in names)) throw new Error(`Unknown argument ${a}`);
    input[names[m[1]]] = m[1] === "keyword" ? m[2] : Number(m[2]);
  }
  return parseRunOptions(input);
}

/**
 * What the CLI does with the run `createRun` returned: drive it ("attach" when another caller
 * created it), or, on a local PGlite database (one process at a time), "replace" a run left by a
 * dead process, and "refuse" while another process (e.g. the dev server) still holds it.
 */
export function cliRunAction(
  run: Pick<PipelineRunRow, "lockedUntil">,
  { created, pglite, now }: { created: boolean; pglite: boolean; now: number },
): "drive" | "attach" | "replace" | "refuse" {
  if (created) return "drive";
  if (!pglite) return "attach";
  return isLeaseFree(run as PipelineRunRow, now) ? "replace" : "refuse";
}

async function main() {
  const options = parsePipelineArgs(process.argv.slice(2));
  const db = await getDb();
  const deps = createLiveDeps();
  const pglite = (process.env.DATABASE_URL ?? "").startsWith("pglite:");

  let { run, created } = await createRun(db, { trigger: "cli", options, env: pipelineEnv() });
  const action = cliRunAction(run, { created, pglite, now: Date.now() });
  if (action === "refuse") {
    throw new Error(
      `Pipeline run #${run.id} is being driven by another process; stop it (e.g. the dev server) first`,
    );
  }
  if (action === "replace") {
    await abandonRun(db, run.id, "Interrupted: replaced by a new CLI run on the local database");
    console.log(`Closed interrupted run #${run.id}.`);
    ({ run, created } = await createRun(db, { trigger: "cli", options, env: pipelineEnv() }));
  }
  console.log(
    created
      ? `Started pipeline run #${run.id}.`
      : `Attaching to active run #${run.id} (${run.trigger}); its own options are used.`,
  );

  const budgetMs = process.env.PIPELINE_TICK_BUDGET_MS ? tickBudgetMs() : Infinity;
  const started = Date.now();
  const final = await driveRun(db, deps, run.id, {
    budgetMs,
    onTick: (r, tick) => {
      const units = "units" in r ? ` ${r.units} units` : "";
      console.log(`tick ${tick}: ${r.kind}${units}`);
    },
  });

  const s = final.state;
  for (const name of STEP_ORDER) {
    const st = s.steps[name];
    const ok = st.status === "done" ? "ok  " : st.status === "skipped" ? "skip" : "FAIL";
    const text = st.detail ?? st.skipReason ?? st.status;
    console.log(`${ok} ${name}: ${text}${st.error ? ` (${st.error})` : ""}`);
  }
  console.log(
    `run #${final.id} ${final.status} in ${final.ticks} ticks, ${Math.round((Date.now() - started) / 1000)} s: ` +
      `${final.adLibraryRequests} Meta requests, ${s.results.newProducts} new products, ` +
      `${s.results.newAds} new ads, ${s.results.productsScored} products scored` +
      (s.adLibrary.blocked ? `; Meta blocked: ${s.adLibrary.blocked.reason}` : ""),
  );
  if (final.status !== "succeeded") process.exitCode = 1;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("jobs/pipeline.ts")) {
  runJob(main);
}
