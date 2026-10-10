import { describe, expect, it } from "vitest";
import { parseDiscoverArgs } from "./discover";

describe("parseDiscoverArgs", () => {
  it("defaults to today's 10 keywords in the five priority markets", () => {
    const args = parseDiscoverArgs([], new Date("2026-10-10T00:00:00Z"));
    expect(args.keywords).toHaveLength(10);
    expect(args.countries).toEqual(["US", "CA", "GB", "AU", "NZ"]);
  });

  it("accepts explicit keywords and countries", () => {
    expect(parseDiscoverArgs(["--keyword=neck massager", "--countries=us"])).toEqual({
      keywords: ["neck massager"],
      countries: ["US"],
    });
    expect(() => parseDiscoverArgs(["--nope"])).toThrow(/Unknown/);
  });
});
