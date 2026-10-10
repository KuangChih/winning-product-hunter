// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signalSnapshots } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { fixtureAdapters } from "@/ingestion/fixtures";
import { runIngestion } from "./run";

describe("re-ingesting a historical series", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("does not duplicate snapshots that share an item, metric and timestamp", async () => {
    const trends = fixtureAdapters.google_trends!;
    await runIngestion(t.db, trends(), { queries: [], limit: 500 });
    await runIngestion(t.db, trends(), { queries: [], limit: 500 });

    // 5 queries x 11 complete weeks, once.
    expect(await t.db.select().from(signalSnapshots)).toHaveLength(55);
  });
});
