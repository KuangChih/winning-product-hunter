// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyDatabase } from "@/db/client";
import * as schema from "@/db/schema";
import { pipelineRuns } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { DEFAULT_RUN_OPTIONS, listRecentRuns } from "@/pipeline/runner";
import type { RunState } from "@/pipeline/runner";
import { getPipelineStatus, getRecentRuns } from "./pipeline-status";

const LOCAL = {}; // a local server: no Vercel variables
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 10, 6, minutes));

function run(id: number, minutes: number, status: "succeeded" | "failed" | "running") {
  return {
    id,
    trigger: "web" as const,
    status,
    env: "local",
    options: DEFAULT_RUN_OPTIONS,
    // An old or partial state is shown without steps instead of failing the page.
    state: {} as RunState,
    createdAt: at(minutes),
    updatedAt: at(minutes),
    finishedAt: status === "running" ? null : at(minutes + 5),
  };
}

describe("pipeline status for pages", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("works without a database", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const status = await getPipelineStatus(LOCAL);
    expect(status).toMatchObject({
      configured: false,
      canStart: false,
      startBlockedReason: "no_database",
      run: null,
    });
    expect(await getRecentRuns()).toEqual([]);
  });

  it("reports missing tables instead of failing", async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as AnyDatabase;
    try {
      expect(await getPipelineStatus(LOCAL, db)).toMatchObject({
        configured: true,
        setup: "migrations",
        canStart: false,
        startBlockedReason: "migrations",
      });
      expect(await getRecentRuns(10, db)).toEqual([]);
    } finally {
      await client.close();
    }
  });

  describe("with runs", () => {
    let t: Awaited<ReturnType<typeof createTestDb>>;
    beforeEach(async () => {
      t = await createTestDb();
      await t.db
        .insert(pipelineRuns)
        .values([
          run(1, 0, "succeeded"),
          run(2, 30, "failed"),
          run(3, 10, "succeeded"),
          run(4, 50, "running"),
        ]);
    });
    afterEach(async () => {
      await t.close();
    });

    it("lists the newest runs first, up to the limit", async () => {
      expect((await listRecentRuns(t.db, 3)).map((r) => r.id)).toEqual([4, 2, 3]);
      const recent = await getRecentRuns(10, t.db, at(55).getTime());
      expect(recent.map((r) => [r.id, r.status])).toEqual([
        [4, "running"],
        [2, "failed"],
        [3, "succeeded"],
        [1, "succeeded"],
      ]);
      expect(recent[0].steps).toEqual([]);
      expect(await getRecentRuns(2, t.db)).toHaveLength(2);
    });

    it("reports the latest run and the last finished one", async () => {
      const status = await getPipelineStatus(LOCAL, t.db);
      expect(status.run).toMatchObject({ id: 4, status: "running" });
      expect(status.lastRun).toMatchObject({ id: 2, status: "failed" });
      expect(status).toMatchObject({ configured: true, canStart: true, cronConfigured: false });
    });
  });
});
