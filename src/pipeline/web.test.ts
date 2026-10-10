// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pipelineRuns } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { parseEcbDaily } from "@/lib/fx";
import { createRun, getRun, parseRunOptions, shouldCronStart, type RunnerDeps } from "./runner";
import type { KickResult } from "./transport";
import {
  canDriveRun,
  isSameOriginRequest,
  pipelineGate,
  startBlockedReason,
  tickAndKick,
  toStatus,
  watchdogAction,
} from "./web";

const ecbXml = fs.readFileSync(
  path.resolve(__dirname, "../ingestion/sources/__recordings__/ecb-eurofxref-daily.xml"),
  "utf8",
);

describe("where the pipeline may run", () => {
  it("runs in production and locally, not on previews or when disabled", () => {
    expect(pipelineGate({})).toBeNull();
    expect(pipelineGate({ VERCEL: "1", VERCEL_ENV: "production" })).toBeNull();
    expect(pipelineGate({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe("preview");
    expect(
      pipelineGate({ VERCEL: "1", VERCEL_ENV: "preview", PIPELINE_ALLOW_PREVIEW: "1" }),
    ).toBeNull();
    expect(pipelineGate({ PIPELINE_DISABLED: "1" })).toBe("disabled");
    expect(pipelineGate({ VERCEL: "1", VERCEL_ENV: "production", PIPELINE_DISABLED: "1" })).toBe(
      "disabled",
    );
  });

  it("drives only its own environment's runs, or a CLI's", () => {
    const prod = { VERCEL: "1", VERCEL_ENV: "production" };
    const preview = { VERCEL: "1", VERCEL_ENV: "preview", PIPELINE_ALLOW_PREVIEW: "1" };
    expect(canDriveRun({ env: "production" }, prod)).toBe(true);
    expect(canDriveRun({ env: "local" }, prod)).toBe(true);
    expect(canDriveRun({ env: "github" }, prod)).toBe(true);
    expect(canDriveRun({ env: "production" }, preview)).toBe(false);
    expect(canDriveRun({ env: "preview" }, prod)).toBe(false);
    expect(canDriveRun({ env: "local" }, {})).toBe(true);
  });

  it("explains why the start button cannot work", () => {
    const ok = { configured: true, migrated: true };
    expect(startBlockedReason(ok, {})).toBeNull();
    expect(startBlockedReason(ok, { PIPELINE_DISABLED: "1" })).toBe("disabled");
    expect(startBlockedReason(ok, { VERCEL: "1", VERCEL_ENV: "preview" })).toBe("preview");
    // Fail closed (ADR-008): no public production site may start sweeps.
    expect(startBlockedReason(ok, { VERCEL: "1", VERCEL_ENV: "production" })).toBe(
      "site_password_required",
    );
    expect(
      startBlockedReason(ok, { VERCEL: "1", VERCEL_ENV: "production", SITE_PASSWORD: "x" }),
    ).toBeNull();
    expect(startBlockedReason({ configured: false, migrated: false }, {})).toBe("no_database");
    expect(startBlockedReason({ configured: true, migrated: false }, {})).toBe("migrations");
  });

  it("reports flags in the status, never the cron secret", () => {
    const s = toStatus(null, { configured: false, migrated: false }, { CRON_SECRET: "s3cret" });
    expect(s).toMatchObject({
      configured: false,
      disabled: false,
      cronConfigured: true,
      canStart: false,
      startBlockedReason: "no_database",
      run: null,
      adLibrary: null,
    });
    expect(JSON.stringify(s)).not.toContain("s3cret");
    expect(
      toStatus(null, { configured: true, migrated: true }, { PIPELINE_DISABLED: "1" }),
    ).toMatchObject({
      disabled: true,
      canStart: false,
      cronConfigured: false,
      startBlockedReason: "disabled",
    });
  });

  it("accepts only same-origin start requests", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(isSameOriginRequest(h({ origin: "https://wph.example", host: "wph.example" }))).toBe(
      true,
    );
    expect(
      isSameOriginRequest(
        h({ origin: "https://wph.example", host: "internal", "x-forwarded-host": "wph.example" }),
      ),
    ).toBe(true);
    expect(isSameOriginRequest(h({ origin: "https://evil.example", host: "wph.example" }))).toBe(
      false,
    );
    expect(isSameOriginRequest(h({ host: "wph.example" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "null", host: "wph.example" }))).toBe(false);
  });
});

describe("tick and hand-off", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await t.close();
  });

  // No sources: discovery and collection are skipped, the rest runs on the empty database.
  const deps: RunnerDeps = {
    egress: "local",
    clock: { now: () => Date.now(), sleep: async () => {} },
    fetchFxRates: async () => parseEcbDaily(ecbXml),
  };
  const newRun = async (env = "local") =>
    (
      await createRun(t.db, {
        trigger: "web",
        options: parseRunOptions({ keywords: "posture corrector", advertisers: 0, collect: 0 }),
        env,
      })
    ).run;

  it("hands an unfinished run to the next tick and stops when it is finished", async () => {
    const run = await newRun();
    const kick = vi.fn(async (): Promise<KickResult> => ({ ok: true }));
    const origin = "http://localhost:3000";

    // One unit per tick: every tick but the last hands off.
    let ticks = 0;
    for (;;) {
      const r = await tickAndKick(t.db, { runId: run.id, origin, deps, budgetMs: 0, kick });
      ticks++;
      if (r.tick.kind !== "continue") {
        expect(r).toEqual({ tick: expect.objectContaining({ kind: "finished" }), kick: null });
        break;
      }
      expect(r.kick).toEqual({ ok: true });
      expect(ticks).toBeLessThan(30);
    }
    expect(kick).toHaveBeenCalledTimes(ticks - 1);
    expect(kick).toHaveBeenCalledWith({ origin, runId: run.id, env: process.env });
    const done = await getRun(t.db, run.id);
    expect(done?.status).not.toBe("running");
    expect(done?.lastKickError).toBeNull();
  });

  it("retries a failed hand-off once and records the error for the watchdog", async () => {
    const run = await newRun();
    const kick = vi.fn(async (): Promise<KickResult> => ({
      ok: false,
      error: "HTTP 502",
      retryable: true,
    }));
    const sleep = vi.fn(async () => {});
    const r = await tickAndKick(t.db, {
      runId: run.id,
      origin: "http://localhost:3000",
      deps,
      budgetMs: 0,
      kick,
      sleep,
    });
    expect(r.tick.kind).toBe("continue");
    expect(kick).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect((await getRun(t.db, run.id))?.lastKickError).toBe("HTTP 502");

    // Without a trusted origin nothing is sent; the reason is recorded.
    const none = vi.fn();
    await tickAndKick(t.db, { runId: run.id, origin: null, deps, budgetMs: 0, kick: none });
    expect(none).not.toHaveBeenCalled();
    expect((await getRun(t.db, run.id))?.lastKickError).toMatch(/No trusted origin/);

    // A later successful hand-off clears it.
    await tickAndKick(t.db, {
      runId: run.id,
      origin: "http://localhost:3000",
      deps,
      budgetMs: 0,
      kick: async () => ({ ok: true }),
    });
    expect((await getRun(t.db, run.id))?.lastKickError).toBeNull();

    // A failed hand-off followed by the watchdog finishing the run: the error does not stay on
    // the finished run.
    for (let i = 0; i < 30; i++) {
      const r = await tickAndKick(t.db, { runId: run.id, origin: null, deps, budgetMs: 0 });
      if (r.tick.kind !== "continue") break;
      expect((await getRun(t.db, run.id))?.lastKickError).toMatch(/No trusted origin/);
    }
    const done = await getRun(t.db, run.id);
    expect(done?.status).not.toBe("running");
    expect(done?.lastKickError).toBeNull();
  });

  it("resumes a run nobody has driven for a while, only in its own environment", async () => {
    const run = await newRun();
    expect(await watchdogAction(t.db, run, {})).toBe("none"); // just created
    await t.db
      .update(pipelineRuns)
      .set({ updatedAt: sql`now() - interval '2 minutes'` })
      .where(eq(pipelineRuns.id, run.id));
    const stale = (await getRun(t.db, run.id))!;
    expect(await watchdogAction(t.db, stale, {})).toBe("resume");
    expect(await watchdogAction(t.db, stale, { VERCEL: "1", VERCEL_ENV: "production" })).toBe(
      "resume", // a local (CLI-style) run may be resumed by production
    );

    const copied = { ...stale, env: "production" };
    expect(
      await watchdogAction(t.db, copied, {
        VERCEL: "1",
        VERCEL_ENV: "preview",
        PIPELINE_ALLOW_PREVIEW: "1",
      }),
    ).toBe("none");

    // Past its tick limit: failed instead of resumed.
    await t.db.update(pipelineRuns).set({ ticks: 99 }).where(eq(pipelineRuns.id, run.id));
    expect(await watchdogAction(t.db, (await getRun(t.db, run.id))!, {})).toBe("expired");
    expect((await getRun(t.db, run.id))?.status).toBe("failed");

    // A run of another environment past its limits is failed from here too (it would block
    // the day's cron run otherwise); within its limits it is left alone (above).
    const other = await newRun();
    await t.db
      .update(pipelineRuns)
      .set({ env: "preview", ticks: 99 })
      .where(eq(pipelineRuns.id, other.id));
    const prodEnv = { VERCEL: "1", VERCEL_ENV: "production" };
    expect(await watchdogAction(t.db, (await getRun(t.db, other.id))!, prodEnv)).toBe("expired");
    expect((await getRun(t.db, other.id))?.status).toBe("failed");
  });

  it("starts the daily cron run once per UTC day", async () => {
    const now = new Date();
    expect(await shouldCronStart(t.db, now)).toEqual({ start: true });

    // A failed cron run is retried by the next cron call.
    const failed = await createRun(t.db, {
      trigger: "cron",
      options: parseRunOptions(),
      env: "local",
    });
    await t.db
      .update(pipelineRuns)
      .set({ status: "failed" })
      .where(eq(pipelineRuns.id, failed.run.id));
    expect(await shouldCronStart(t.db, now)).toEqual({ start: true });

    const ok = await createRun(t.db, { trigger: "cron", options: parseRunOptions(), env: "local" });
    expect(await shouldCronStart(t.db, now)).toEqual({ start: false, reason: "cron_ran_today" });
    await t.db.delete(pipelineRuns).where(eq(pipelineRuns.id, ok.run.id));

    // A button sweep earlier that day also counts.
    const web = await newRun();
    await t.db
      .update(pipelineRuns)
      .set({ status: "succeeded", adLibraryRequests: 3 })
      .where(eq(pipelineRuns.id, web.id));
    expect(await shouldCronStart(t.db, now)).toEqual({ start: false, reason: "swept_today" });
    // Not the next day.
    expect(await shouldCronStart(t.db, new Date(now.getTime() + 86_400_000))).toEqual({
      start: true,
    });
  });
});
