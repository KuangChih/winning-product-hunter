// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRankedProducts } from "@/data/products";
import type { AnyDatabase } from "./client";
import { closeDb, fetchWithTimeout, getDb, isMissingTableError } from "./client";
import * as schema from "./schema";

describe("isMissingTableError", () => {
  it("recognizes a query against an unmigrated database", async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as AnyDatabase;
    const err = await getRankedProducts(db).catch((e: unknown) => e);
    await client.close();

    expect(isMissingTableError(err)).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isMissingTableError(new Error("boom"))).toBe(false);
    expect(isMissingTableError({ cause: { code: "28P01" } })).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
  });
});

describe("fetchWithTimeout", () => {
  it("aborts a request that does not answer in time", async () => {
    const hanging = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const err = await fetchWithTimeout(20, hanging)("https://db.test/sql").catch((e) => e);
    expect(err).toMatchObject({ name: "TimeoutError" });
  });

  it("keeps the caller's own signal", async () => {
    const controller = new AbortController();
    const seen = vi.fn<typeof fetch>(async (_input, init) => {
      controller.abort(new Error("caller"));
      expect(init?.signal?.aborted).toBe(true);
      return new Response("ok");
    });
    await fetchWithTimeout(60_000, seen)("https://db.test/sql", { signal: controller.signal });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("getDb", () => {
  afterEach(async () => {
    await closeDb();
    vi.unstubAllEnvs();
  });
  const cacheKey = Symbol.for("winning-product-hunter.db");
  const cache = () => (globalThis as Record<symbol, unknown>)[cacheKey];

  it("shares one connection per URL across module copies and reconnects when the URL changes", async () => {
    // Neon clients connect per query, so no network is used here.
    vi.stubEnv("DATABASE_URL", "postgres://u:p@a.example/db");
    const a = await getDb();
    expect(await getDb()).toBe(a);
    expect(cache()).toMatchObject({ url: "postgres://u:p@a.example/db" });
    vi.stubEnv("DATABASE_URL", "postgres://u:p@b.example/db");
    expect(await getDb()).not.toBe(a);
  });

  it("forgets a failed connection so the next call tries again", async () => {
    // A data directory below a file cannot be created.
    const file = path.join(tmpdir(), `wph-not-a-dir-${process.pid}`);
    await writeFile(file, "");
    vi.stubEnv("DATABASE_URL", `pglite:${path.join(file, "db", "data")}`);
    await expect(getDb()).rejects.toThrow();
    await Promise.resolve();
    expect(cache()).toBeUndefined();
  });
});
