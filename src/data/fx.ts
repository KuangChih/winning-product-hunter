import { desc, eq, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { fxRates } from "@/db/schema";
import type { FxRates } from "@/lib/fx";

/** Stores one day of rates; re-running for the same day overwrites it. */
export async function saveFxRates(db: AnyDatabase, rates: FxRates): Promise<number> {
  const rows = Object.entries(rates.perEur).map(([currency, perEur]) => ({
    date: rates.date,
    currency,
    perEur,
  }));
  await db
    .insert(fxRates)
    .values(rows)
    .onConflictDoUpdate({
      target: [fxRates.date, fxRates.currency],
      set: { perEur: sql.raw("excluded.per_eur") },
    });
  return rows.length;
}

/** Most recent day of rates, or null when none have been fetched yet. */
export async function getLatestFxRates(db: AnyDatabase): Promise<FxRates | null> {
  const [latest] = await db
    .select({ date: fxRates.date })
    .from(fxRates)
    .orderBy(desc(fxRates.date))
    .limit(1);
  if (!latest) return null;
  const rows = await db.select().from(fxRates).where(eq(fxRates.date, latest.date));
  return { date: latest.date, perEur: Object.fromEntries(rows.map((r) => [r.currency, r.perEur])) };
}
