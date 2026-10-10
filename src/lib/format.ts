/** Display formatting shared by pages (deterministic: the same on the server and the client). */

/** US dollars from cents: 2499 → "$24.99". */
export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * A time as "2026-10-11 06:30 UTC" (or "—" when missing). UTC on purpose: the server and the
 * browser render the same text, so hydration never disagrees.
 */
export function formatUtc(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

const DAY_MS = 86_400_000;

/**
 * How long ago, in whole days or coarser ("today", "3 days ago", "2 months ago"; zh-TW "今天",
 * "3 天前"). Server-rendered only, so the clock difference with the browser does not matter.
 */
export function formatAgo(value: Date, now: Date, locale: string): string {
  const days = Math.max(0, Math.floor((now.getTime() - value.getTime()) / DAY_MS));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (days < 31) return rtf.format(-days, "day");
  if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}
