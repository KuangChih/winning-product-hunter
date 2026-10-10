/**
 * Target markets (user decision 2026-10-10, see CLAUDE.md): the five English-speaking markets
 * first, then the second-wave European markets. Codes are ISO 3166-1 alpha-2 ("GB", not "UK").
 */
export const MARKETS = [
  { code: "US", name: "United States", tier: 1, currency: "USD" },
  { code: "CA", name: "Canada", tier: 1, currency: "CAD" },
  { code: "GB", name: "United Kingdom", tier: 1, currency: "GBP" },
  { code: "AU", name: "Australia", tier: 1, currency: "AUD" },
  { code: "NZ", name: "New Zealand", tier: 1, currency: "NZD" },
  { code: "DE", name: "Germany", tier: 2, currency: "EUR" },
  { code: "FR", name: "France", tier: 2, currency: "EUR" },
  { code: "SE", name: "Sweden", tier: 2, currency: "SEK" },
  { code: "BE", name: "Belgium", tier: 2, currency: "EUR" },
  { code: "ES", name: "Spain", tier: 2, currency: "EUR" },
  { code: "NO", name: "Norway", tier: 2, currency: "NOK" },
] as const;

export type MarketCode = (typeof MARKETS)[number]["code"];

const MARKET_BY_CODE = new Map<string, (typeof MARKETS)[number]>(MARKETS.map((m) => [m.code, m]));

/** Weight of a country when aggregating signals; tier 1 markets count most. */
export const TIER_WEIGHTS = { 1: 1, 2: 0.6, other: 0.3 } as const;

/** Region codes some sources use instead of countries, expanded to ISO countries. */
const REGION_ALIASES: Record<string, string[]> = {
  UK: ["GB"],
  // EU member states among our markets (Norway is EEA, not EU).
  EU: ["DE", "FR", "SE", "BE", "ES"],
  EEA: ["DE", "FR", "SE", "BE", "ES", "NO"],
};

/**
 * Normalizes a country or region code from a source into ISO 3166-1 alpha-2 country codes.
 * Unknown values are returned upper-cased so nothing is silently dropped.
 */
export function toCountries(code: string | null | undefined): string[] {
  if (!code) return [];
  const upper = code.trim().toUpperCase();
  if (!upper || upper === "WORLDWIDE" || upper === "ALL") return [];
  return REGION_ALIASES[upper] ?? [upper];
}

export function isTargetMarket(country: string): country is MarketCode {
  return MARKET_BY_CODE.has(country);
}

export function marketTier(country: string): 1 | 2 | null {
  return MARKET_BY_CODE.get(country)?.tier ?? null;
}

export function marketWeight(country: string): number {
  const tier = marketTier(country);
  return tier ? TIER_WEIGHTS[tier] : TIER_WEIGHTS.other;
}

/** Local currency of a market (ISO 4217), or undefined for countries we don't target. */
export function marketCurrency(country: string): string | undefined {
  return MARKET_BY_CODE.get(country)?.currency;
}

export function marketName(country: string): string {
  return MARKET_BY_CODE.get(country)?.name ?? country;
}

/** Sorts countries tier 1 first, then tier 2, then others, keeping MARKETS order within tiers. */
export function sortByMarketPriority(countries: Iterable<string>): string[] {
  const order = (c: string) => {
    const i = MARKETS.findIndex((m) => m.code === c);
    return i === -1 ? MARKETS.length : i;
  };
  return [...new Set(countries)].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}
