// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/testing/pglite";
import { fetchDiscoveryItems } from "@/discovery/discover";
import { HttpError } from "@/ingestion/http";
import { AdLibraryBlockedError } from "@/ingestion/sources/meta-ad-library-web";
import { cliRunAction, parsePipelineArgs } from "@/jobs/pipeline";
import { createLiveDeps, pipelineEgress, pipelineEnv } from "@/pipeline/live-deps";
import {
  adLibraryAllowance,
  clearBackoff,
  getBackoff,
  isAdLibraryBlock,
  recordBlock,
} from "./guards";
import { DEFAULT_RUN_OPTIONS, parseKeywords, parseRunOptions, RunOptionsError } from "./options";

const HOUR = 3_600_000;

describe("Meta back-off", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("escalates per egress and resets after a success", async () => {
    const at = new Date("2026-10-10T08:00:00Z");
    expect((await recordBlock(t.db, "ad_library_web", "vercel", "CAPTCHA", at)).getTime()).toBe(
      at.getTime() + 6 * HOUR,
    );
    const later = new Date(at.getTime() + 7 * HOUR);
    expect((await recordBlock(t.db, "ad_library_web", "vercel", "CAPTCHA", later)).getTime()).toBe(
      later.getTime() + 12 * HOUR,
    );
    expect(await getBackoff(t.db, "ad_library_web", "vercel")).toMatchObject({ strikes: 2 });

    const blocked = await adLibraryAllowance(t.db, { egress: "vercel", now: later });
    expect(blocked).toMatchObject({ allowed: false, reason: "backoff", strikes: 2 });
    expect(await adLibraryAllowance(t.db, { egress: "local", now: later })).toMatchObject({
      allowed: true,
      sweep: 1,
    });

    await clearBackoff(t.db, "ad_library_web", "vercel");
    expect(await getBackoff(t.db, "ad_library_web", "vercel")).toBeNull();
  });

  it("treats CAPTCHA, login walls and 403/429 as blocks", () => {
    expect(isAdLibraryBlock(new AdLibraryBlockedError("CAPTCHA required"))).toBe(true);
    expect(isAdLibraryBlock(new HttpError(429, "https://www.facebook.com/ads/library/", ""))).toBe(
      true,
    );
    expect(isAdLibraryBlock(new HttpError(500, "https://www.facebook.com/ads/library/", ""))).toBe(
      false,
    );
    expect(isAdLibraryBlock(new Error("socket hang up"))).toBe(false);
  });
});

describe("run options", () => {
  it("validates custom keywords", () => {
    expect(parseKeywords(" led  mask, Neck massager ,led mask,, ")).toEqual([
      "led mask",
      "Neck massager",
    ]);
    expect(parseKeywords("  ")).toBeNull();
    // Full-width comma and the enumeration comma typed on Chinese keyboards, and new lines.
    expect(parseKeywords("頸部按摩器，寵物梳、led mask\nneck fan")).toEqual([
      "頸部按摩器",
      "寵物梳",
      "led mask",
      "neck fan",
    ]);
    expect(() => parseKeywords(Array.from({ length: 11 }, (_, i) => `k${i}`))).toThrow(
      RunOptionsError,
    );
    expect(() => parseKeywords("x".repeat(61))).toThrow(/60 characters/);
  });

  it("fills defaults and rejects out-of-range numbers", () => {
    expect(parseRunOptions()).toEqual(DEFAULT_RUN_OPTIONS);
    expect(() => parseRunOptions({ collect: -1 })).toThrow(RunOptionsError);
    expect(() => parseRunOptions({ advertisers: 21 })).toThrow(RunOptionsError);
    expect(() => parseRunOptions({ countries: ["usa"] })).toThrow(RunOptionsError);
  });

  it("parses the CLI flags", () => {
    expect(
      parsePipelineArgs(["--keywords=1", "--advertisers=1", "--collect=2", "--keyword=a, b"]),
    ).toMatchObject({ keywordCount: 1, advertisers: 1, collect: 2, keywords: ["a", "b"] });
    expect(() => parsePipelineArgs(["--keywords=x"])).toThrow(RunOptionsError);
    expect(() => parsePipelineArgs(["--dry-run"])).toThrow(/Unknown argument/);
  });
});

describe("CLI run handling", () => {
  const now = Date.parse("2026-10-10T08:00:00Z");
  const held = { lockedUntil: new Date(now + 60_000) };
  const free = { lockedUntil: new Date(now - 1_000) };

  it("drives its own run and attaches to an active one on Neon", () => {
    expect(cliRunAction(held, { created: true, pglite: true, now })).toBe("drive");
    expect(cliRunAction(held, { created: false, pglite: false, now })).toBe("attach");
  });

  it("on PGlite replaces a run left by a dead process, refuses one still held", () => {
    expect(cliRunAction(free, { created: false, pglite: true, now })).toBe("replace");
    expect(cliRunAction({ lockedUntil: null }, { created: false, pglite: true, now })).toBe(
      "replace",
    );
    expect(cliRunAction(held, { created: false, pglite: true, now })).toBe("refuse");
  });
});

describe("live sources", () => {
  it("labels the egress so a block of one network does not stop another", () => {
    expect(pipelineEgress({})).toBe("local");
    expect(pipelineEgress({ VERCEL: "1" })).toBe("vercel");
    expect(pipelineEgress({ GITHUB_ACTIONS: "true" })).toBe("github");
    expect(pipelineEnv({ GITHUB_ACTIONS: "true" })).toBe("github");
    expect(pipelineEnv({ VERCEL: "1", VERCEL_ENV: "production" })).toBe("production");
  });

  it("sends a refused Ad Library request once (no uncounted retry after a 429)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("", { status: 429, headers: { "retry-after": "1" } }),
    );
    const deps = createLiveDeps({}, { fetchImpl });
    const adapter = deps.adLibrary!({ mode: "keyword", countries: ["US"] });
    const { failure } = await fetchDiscoveryItems(adapter, ["posture corrector"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(isAdLibraryBlock(failure)).toBe(true);
  });
});
