// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it, vi } from "vitest";
import { getRankedProducts } from "@/data/products";
import type { AnyDatabase } from "./client";
import { fetchWithTimeout, isMissingTableError } from "./client";
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
