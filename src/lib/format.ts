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
