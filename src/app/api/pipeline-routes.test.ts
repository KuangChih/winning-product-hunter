// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pipelineRuns } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { pipelineTickToken } from "@/lib/internal-auth";
import { SITE_AUTH_COOKIE, siteToken } from "@/lib/site-auth";
import { createRun, getActiveRun, getRun, parseRunOptions } from "@/pipeline/runner";
import { GET as cron } from "./internal/cron/daily/route";
import { POST as tick } from "./internal/pipeline/tick/route";
import { POST as start } from "./pipeline/start/route";
import { GET as status } from "./pipeline/status/route";

const h = vi.hoisted(() => ({
  db: null as unknown,
  after: [] as (() => Promise<unknown>)[],
  tickAndKick: vi.fn(async () => ({ tick: { kind: "continue", units: 1 }, kick: { ok: true } })),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => Promise<unknown>) => h.after.push(fn),
}));
vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: async () => h.db,
}));
// No real requests: the background tick is replaced (tickAndKick has its own tests).
vi.mock("@/pipeline/web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/pipeline/web")>()),
  tickAndKick: h.tickAndKick,
}));

const BASE = "http://localhost:3000";
const req = (
  path: string,
  {
    method = "GET",
    headers = {},
    body,
  }: { method?: string; headers?: Record<string, string>; body?: string } = {},
) => new NextRequest(`${BASE}${path}`, { method, headers, body });

describe("pipeline routes", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
    h.db = t.db;
    h.after.length = 0;
    h.tickAndKick.mockClear();
    vi.stubEnv("DATABASE_URL", "pglite:./test-only");
    vi.stubEnv("SITE_PASSWORD", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("PIPELINE_DISABLED", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await t.close();
  });

  const runAfter = async () => {
    for (const fn of h.after.splice(0)) await fn();
  };
  const startReq = (body?: string, headers: Record<string, string> = {}) =>
    req("/api/pipeline/start", {
      method: "POST",
      headers: {
        origin: BASE,
        host: "localhost:3000",
        "content-type": "application/json",
        ...headers,
      },
      body,
    });

  describe("POST /api/pipeline/start", () => {
    it("creates a web run with custom keywords and runs its first tick after the response", async () => {
      const res = await start(
        startReq(JSON.stringify({ keywords: "posture corrector, Led mask" })),
      );
      expect(res.status).toBe(201);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, created: true });
      expect(body.progress.run).toMatchObject({
        id: body.runId,
        trigger: "web",
        status: "running",
      });
      expect(body.progress.run.keywords).toEqual(["posture corrector", "Led mask"]);

      expect(h.after).toHaveLength(1);
      await runAfter();
      expect(h.tickAndKick).toHaveBeenCalledWith(t.db, {
        runId: body.runId,
        origin: "http://localhost:3000",
      });
    });

    it("returns the active run instead of starting a second one", async () => {
      const first = await (await start(startReq())).json();
      h.after.length = 0;
      const res = await start(startReq(JSON.stringify({ keywords: "other" })));
      expect(res.status).toBe(200);
      // The keywords of the second request were not used, and the response says so.
      expect(await res.json()).toMatchObject({
        created: false,
        ignoredOptions: true,
        runId: first.runId,
      });
      expect(h.after).toHaveLength(0); // the run is being driven already
      expect((await t.db.select().from(pipelineRuns)).length).toBe(1);
      expect(await (await start(startReq())).json()).toMatchObject({ ignoredOptions: false });
    });

    it("resumes a stalled active run, but never one of another environment", async () => {
      const first = await (await start(startReq())).json();
      h.after.length = 0;
      await t.db
        .update(pipelineRuns)
        .set({ updatedAt: sql`now() - interval '2 minutes'` })
        .where(eq(pipelineRuns.id, first.runId));
      const res = await start(startReq());
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ created: false, runId: first.runId });
      expect(h.after).toHaveLength(1);
      await runAfter();
      expect(h.tickAndKick).toHaveBeenCalledTimes(1);
      expect(h.tickAndKick).toHaveBeenCalledWith(t.db, { runId: first.runId, origin: BASE });

      // A preview database copy of the run: stalled, but not this deployment's to drive.
      h.tickAndKick.mockClear();
      await t.db
        .update(pipelineRuns)
        .set({ env: "preview", updatedAt: sql`now() - interval '2 minutes'` })
        .where(eq(pipelineRuns.id, first.runId));
      const other = await start(startReq());
      expect(await other.json()).toMatchObject({ created: false, runId: first.runId });
      expect(h.after).toHaveLength(0);
      expect(h.tickAndKick).not.toHaveBeenCalled();
    });

    it("validates the keywords", async () => {
      const tooMany = Array.from({ length: 11 }, (_, i) => `k${i}`).join(",");
      const res = await start(startReq(JSON.stringify({ keywords: tooMany })));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_options" });
      expect((await start(startReq("{nope"))).status).toBe(400);
      expect((await start(startReq(JSON.stringify({ keywords: 5 })))).status).toBe(400);
      expect(await getActiveRun(t.db)).toBeNull();
    });

    it("refuses other origins, missing cookies and an unprotected production site", async () => {
      expect((await start(startReq(undefined, { origin: "https://evil.example" }))).status).toBe(
        403,
      );
      expect((await start(startReq(undefined, { origin: "" }))).status).toBe(403);

      vi.stubEnv("SITE_PASSWORD", "secret");
      expect((await start(startReq())).status).toBe(401);
      const cookie = `${SITE_AUTH_COOKIE}=${await siteToken("secret")}`;
      vi.stubEnv("PIPELINE_DISABLED", "1");
      expect(await (await start(startReq(undefined, { cookie }))).json()).toEqual({
        error: "disabled",
      });

      vi.stubEnv("PIPELINE_DISABLED", "");
      vi.stubEnv("SITE_PASSWORD", "");
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", "production");
      const res = await start(startReq());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "site_password_required" });
      expect(await getActiveRun(t.db)).toBeNull();
    });
  });

  describe("GET /api/pipeline/status", () => {
    it("returns progress JSON with the start and cron flags", async () => {
      const res = await status(req("/api/pipeline/status"));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toMatchObject({
        configured: true,
        setup: null,
        disabled: false,
        cronConfigured: false,
        canStart: true,
        startBlockedReason: null,
        run: null,
        adLibrary: { sweepsToday: 0, dailySweepCap: 3 },
      });

      vi.stubEnv("CRON_SECRET", "s3cret");
      vi.stubEnv("PIPELINE_DISABLED", "1");
      const off = await (await status(req("/api/pipeline/status"))).json();
      expect(off).toMatchObject({ disabled: true, canStart: false, cronConfigured: true });
      expect(JSON.stringify(off)).not.toContain("s3cret");

      vi.stubEnv("DATABASE_URL", "");
      expect(await (await status(req("/api/pipeline/status"))).json()).toMatchObject({
        configured: false,
        startBlockedReason: "disabled",
        run: null,
      });
    });

    it("requires the site cookie when a password is set", async () => {
      vi.stubEnv("SITE_PASSWORD", "secret");
      expect((await status(req("/api/pipeline/status"))).status).toBe(401);
      const cookie = `${SITE_AUTH_COOKIE}=${await siteToken("secret")}`;
      expect((await status(req("/api/pipeline/status", { headers: { cookie } }))).status).toBe(200);
    });

    it("resumes a stalled run after the response (watchdog), once", async () => {
      const { run } = await createRun(t.db, {
        trigger: "web",
        options: parseRunOptions(),
        env: "local",
      });
      await status(req("/api/pipeline/status"));
      expect(h.after).toHaveLength(0); // fresh: someone is about to drive it

      await t.db
        .update(pipelineRuns)
        .set({ updatedAt: sql`now() - interval '2 minutes'` })
        .where(eq(pipelineRuns.id, run.id));
      const body = await (await status(req("/api/pipeline/status"))).json();
      expect(body.run).toMatchObject({ id: run.id, stalled: true });
      expect(h.after).toHaveLength(1);
      await runAfter();
      expect(h.tickAndKick).toHaveBeenCalledWith(t.db, { runId: run.id, origin: BASE });

      // Disabled: progress only, no ticks.
      vi.stubEnv("PIPELINE_DISABLED", "1");
      await status(req("/api/pipeline/status"));
      expect(h.after).toHaveLength(0);
    });
  });

  describe("POST /api/internal/pipeline/tick", () => {
    const tickReq = (auth?: string, body: unknown = { runId: 1 }) =>
      req("/api/internal/pipeline/tick", {
        method: "POST",
        headers: auth ? { authorization: auth } : {},
        body: JSON.stringify(body),
      });

    it("needs a configured secret and the derived Bearer token", async () => {
      vi.stubEnv("DATABASE_URL", "");
      expect((await tick(tickReq("Bearer x"))).status).toBe(503);
      vi.stubEnv("DATABASE_URL", "pglite:./test-only");
      expect((await tick(tickReq())).status).toBe(401);
      expect((await tick(tickReq("Bearer wrong"))).status).toBe(401);
      // The site cookie is not enough.
      vi.stubEnv("SITE_PASSWORD", "secret");
      const cookie = `${SITE_AUTH_COOKIE}=${await siteToken("secret")}`;
      const withCookie = req("/api/internal/pipeline/tick", {
        method: "POST",
        headers: { cookie },
        body: "{}",
      });
      expect((await tick(withCookie)).status).toBe(401);
      expect(h.after).toHaveLength(0);
    });

    it("accepts a valid token with 202 and ticks after the response", async () => {
      const { run } = await createRun(t.db, {
        trigger: "web",
        options: parseRunOptions(),
        env: "local",
      });
      const auth = `Bearer ${await pipelineTickToken()}`;
      const res = await tick(tickReq(auth, { runId: run.id }));
      expect(res.status).toBe(202);
      expect(h.after).toHaveLength(1);
      await runAfter();
      expect(h.tickAndKick).toHaveBeenCalledWith(t.db, { runId: run.id, origin: BASE });

      expect((await tick(tickReq(auth, { runId: "x" }))).status).toBe(400);
      expect((await tick(tickReq(auth, { runId: run.id + 1 }))).status).toBe(404);
      await t.db
        .update(pipelineRuns)
        .set({ status: "succeeded" })
        .where(eq(pipelineRuns.id, run.id));
      const done = await tick(tickReq(auth, { runId: run.id }));
      expect(done.status).toBe(200);
      expect(await done.json()).toMatchObject({ accepted: false });
      expect(h.after).toHaveLength(0);
    });

    it("stops the chain when disabled or for a run of another environment", async () => {
      const { run } = await createRun(t.db, {
        trigger: "web",
        options: parseRunOptions(),
        env: "production",
      });
      const auth = `Bearer ${await pipelineTickToken()}`;
      // Running locally: production's run is not ours.
      const other = await tick(tickReq(auth, { runId: run.id }));
      expect(other.status).toBe(409);
      expect(await other.json()).toEqual({ error: "other_environment" });

      vi.stubEnv("PIPELINE_DISABLED", "1");
      const off = await tick(tickReq(auth, { runId: run.id }));
      expect(off.status).toBe(503);
      expect(await off.json()).toEqual({ error: "disabled" });
      expect(h.after).toHaveLength(0);
      expect(h.tickAndKick).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/internal/cron/daily", () => {
    const cronReq = (auth?: string) =>
      req("/api/internal/cron/daily", { headers: auth ? { authorization: auth } : {} });

    it("answers 503 without CRON_SECRET and 401 with a wrong one", async () => {
      expect((await cron(cronReq("Bearer anything"))).status).toBe(503);
      vi.stubEnv("CRON_SECRET", "s3cret");
      expect((await cron(cronReq())).status).toBe(401);
      expect((await cron(cronReq("Bearer wrong"))).status).toBe(401);
      expect(await getActiveRun(t.db)).toBeNull();
    });

    it("starts one cron run a day and resumes it when stalled", async () => {
      vi.stubEnv("CRON_SECRET", "s3cret");
      const first = await (await cron(cronReq("Bearer s3cret"))).json();
      expect(first).toMatchObject({ action: "started" });
      expect(h.after).toHaveLength(1);
      h.after.length = 0;
      const run = (await getActiveRun(t.db))!;
      expect(run).toMatchObject({ id: first.runId, trigger: "cron" });

      // The next hour's call: still running → nothing to do.
      expect(await (await cron(cronReq("Bearer s3cret"))).json()).toEqual({
        action: "running",
        runId: run.id,
      });
      expect(h.after).toHaveLength(0);

      // Nobody drove it for a while → resumed.
      await t.db
        .update(pipelineRuns)
        .set({ updatedAt: sql`now() - interval '2 minutes'` })
        .where(eq(pipelineRuns.id, run.id));
      expect(await (await cron(cronReq("Bearer s3cret"))).json()).toEqual({
        action: "resumed",
        runId: run.id,
      });
      expect(h.after).toHaveLength(1);
      h.after.length = 0;

      // Finished: the later calls that day start nothing.
      await t.db
        .update(pipelineRuns)
        .set({ status: "succeeded" })
        .where(eq(pipelineRuns.id, run.id));
      expect(await (await cron(cronReq("Bearer s3cret"))).json()).toEqual({
        action: "skipped",
        reason: "cron_ran_today",
      });
      expect((await t.db.select().from(pipelineRuns)).length).toBe(1);
    });

    it("fails an expired run and then decides today's run", async () => {
      vi.stubEnv("CRON_SECRET", "s3cret");
      // A cron run that used up its ticks with nobody holding it (a broken chain).
      const { run: old } = await createRun(t.db, {
        trigger: "cron",
        options: parseRunOptions(),
        env: "local",
      });
      await t.db.update(pipelineRuns).set({ ticks: 40 }).where(eq(pipelineRuns.id, old.id));

      // A failed cron run does not count and nothing swept today: a new run starts.
      const res = await (await cron(cronReq("Bearer s3cret"))).json();
      expect((await getRun(t.db, old.id))?.status).toBe("failed");
      expect(res).toMatchObject({ action: "started" });
      expect(res.runId).not.toBe(old.id);
      expect(h.after).toHaveLength(1);
      h.after.length = 0;

      // Same again, but the expired run had already swept Meta today: skipped.
      await t.db
        .update(pipelineRuns)
        .set({ ticks: 40, adLibraryRequests: 5 })
        .where(eq(pipelineRuns.id, res.runId));
      expect(await (await cron(cronReq("Bearer s3cret"))).json()).toEqual({
        action: "skipped",
        reason: "swept_today",
      });
      expect((await getRun(t.db, res.runId))?.status).toBe("failed");
      expect(await getActiveRun(t.db)).toBeNull();
      expect(h.after).toHaveLength(0);
    });

    it("answers 503 before migrations instead of failing", async () => {
      vi.stubEnv("CRON_SECRET", "s3cret");
      await t.db.execute(sql`drop table pipeline_runs cascade`);
      const res = await cron(cronReq("Bearer s3cret"));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "migrations" });
    });

    it("does nothing when the pipeline is disabled", async () => {
      vi.stubEnv("CRON_SECRET", "s3cret");
      vi.stubEnv("PIPELINE_DISABLED", "1");
      expect(await (await cron(cronReq("Bearer s3cret"))).json()).toEqual({
        action: "skipped",
        reason: "disabled",
      });
      expect(await getActiveRun(t.db)).toBeNull();
    });
  });
});
