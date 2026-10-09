// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { getRankedProducts } from "@/data/products";
import type { AnyDatabase } from "./client";
import { isMissingTableError } from "./client";
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
