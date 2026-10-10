/**
 * Currency conversion with ECB reference rates (first-party, free, published each working day:
 * https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml). Rates are units per EUR.
 */

export interface FxRates {
  /** Date the rates apply to (YYYY-MM-DD). */
  date: string;
  /** Units of each currency per 1 EUR; always includes EUR = 1. */
  perEur: Record<string, number>;
}

export const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export class FxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxError";
  }
}

/** Parses the ECB daily XML. Attributes may use single or double quotes. */
export function parseEcbDaily(xml: string): FxRates {
  const date = xml.match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  if (!date) throw new FxError("ECB XML: missing date");
  const perEur: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    perEur[m[1]] = Number(m[2]);
  }
  if (Object.keys(perEur).length < 2) throw new FxError("ECB XML: no rates");
  return { date, perEur };
}

/** Converts minor units between currencies; returns null when either rate is unknown. */
export function convertCents(
  cents: number,
  from: string,
  to: string,
  rates: FxRates,
): number | null {
  if (from === to) return cents;
  const f = rates.perEur[from];
  const t = rates.perEur[to];
  if (!f || !t) return null;
  return Math.round((cents / f) * t);
}
