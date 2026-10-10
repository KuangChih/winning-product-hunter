import { DISCOVERY_KEYWORDS } from "@/discovery/keywords";
import { MARKETS } from "@/lib/markets";
import type { RunOptions } from "./types";

/** Ad Library requests per run (ADR-006): keyword sweep + advertiser following. */
export const MAX_KEYWORD_REQUESTS = 50;
export const MAX_ADVERTISER_REQUESTS = 20;
export const MAX_AD_REQUESTS_PER_RUN = MAX_KEYWORD_REQUESTS + MAX_ADVERTISER_REQUESTS;
/** Meta sweeps per UTC day, the daily cron included (user decision 2026-10-10). */
export const DAILY_SWEEP_CAP = 3;

/** Custom keyword limits (the web form and `--keyword`). */
export const MAX_CUSTOM_KEYWORDS = 10;
export const MAX_KEYWORD_LENGTH = 60;

export const TIER_1_COUNTRIES = MARKETS.filter((m) => m.tier === 1).map((m) => m.code);

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  keywordCount: 10,
  keywords: null,
  advertisers: 10,
  collect: 20,
  countries: TIER_1_COUNTRIES,
};

export class RunOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunOptionsError";
  }
}

/**
 * Custom keywords from free text ("a, b" or a list): trimmed, blanks and duplicates (ignoring
 * case) dropped. Throws RunOptionsError over the limits. Empty input → null (use the rotation).
 */
export function parseKeywords(input: string | string[] | null | undefined): string[] | null {
  if (input === null || input === undefined) return null;
  const parts = (Array.isArray(input) ? input : input.split(/[,\n]/))
    .map((k) => k.replace(/\s+/g, " ").trim())
    .filter((k) => k.length > 0);
  const seen = new Set<string>();
  const keywords = parts.filter((k) => {
    const key = k.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (keywords.length === 0) return null;
  if (keywords.length > MAX_CUSTOM_KEYWORDS) {
    throw new RunOptionsError(`At most ${MAX_CUSTOM_KEYWORDS} keywords`);
  }
  const long = keywords.find((k) => k.length > MAX_KEYWORD_LENGTH);
  if (long) {
    throw new RunOptionsError(`Keywords must be at most ${MAX_KEYWORD_LENGTH} characters`);
  }
  return keywords;
}

function intIn(value: unknown, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new RunOptionsError(`${name} must be an integer from ${min} to ${max}`);
  }
  return n;
}

/** Validates run options (from the CLI, a web form or a saved run), filling in defaults. */
export function parseRunOptions(
  input: Partial<Record<keyof RunOptions, unknown>> = {},
): RunOptions {
  const countries = input.countries ?? DEFAULT_RUN_OPTIONS.countries;
  if (
    !Array.isArray(countries) ||
    countries.length === 0 ||
    !countries.every((c) => typeof c === "string" && /^[A-Z]{2}$/.test(c))
  ) {
    throw new RunOptionsError("countries must be a non-empty list of ISO country codes");
  }
  const rawKeywords = input.keywords;
  if (
    rawKeywords !== undefined &&
    rawKeywords !== null &&
    typeof rawKeywords !== "string" &&
    !(Array.isArray(rawKeywords) && rawKeywords.every((k) => typeof k === "string"))
  ) {
    throw new RunOptionsError("keywords must be text");
  }
  return {
    keywordCount: intIn(
      input.keywordCount,
      "keywords",
      1,
      DISCOVERY_KEYWORDS.length,
      DEFAULT_RUN_OPTIONS.keywordCount,
    ),
    keywords: parseKeywords(rawKeywords as string | string[] | null | undefined),
    advertisers: intIn(
      input.advertisers,
      "advertisers",
      0,
      MAX_ADVERTISER_REQUESTS,
      DEFAULT_RUN_OPTIONS.advertisers,
    ),
    collect: intIn(input.collect, "collect", 0, 200, DEFAULT_RUN_OPTIONS.collect),
    countries: [...new Set(countries as string[])],
  };
}
