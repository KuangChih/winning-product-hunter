// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing/pglite";
import { getLatestFxRates, saveFxRates } from "./fx";

describe("fx rates storage", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("returns null before any rates are stored", async () => {
    expect(await getLatestFxRates(t.db)).toBeNull();
  });

  it("returns the most recent day and overwrites a re-fetched day", async () => {
    await saveFxRates(t.db, { date: "2026-10-08", perEur: { EUR: 1, USD: 1.1 } });
    await saveFxRates(t.db, { date: "2026-10-09", perEur: { EUR: 1, USD: 1.2 } });
    await saveFxRates(t.db, { date: "2026-10-09", perEur: { EUR: 1, USD: 1.25 } });

    expect(await getLatestFxRates(t.db)).toEqual({
      date: "2026-10-09",
      perEur: { EUR: 1, USD: 1.25 },
    });
  });
});
