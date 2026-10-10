import type { MarginEstimate as Estimate } from "@/lib/margin";

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground text-xs uppercase">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {note && <div className="text-muted-foreground text-xs">{note}</div>}
    </div>
  );
}

/** Retail vs supplier cost before shipping, with what is missing spelled out. */
export function MarginEstimate({ estimate }: { estimate: Estimate }) {
  const e = estimate;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure
          label="Retail price (US)"
          value={e.retailUsdCents === null ? "—" : usd(e.retailUsdCents)}
          note={
            e.retailUsdCents === null
              ? undefined
              : `Median of ${e.retailOffers} store ${e.retailOffers === 1 ? "offer" : "offers"}`
          }
        />
        <Figure
          label="Supplier cost"
          value={e.supplierUsdCents === null ? "—" : usd(e.supplierUsdCents)}
          note={
            e.supplierUsdCents === null
              ? undefined
              : `Cheapest of ${e.supplierListings} ${e.supplierListings === 1 ? "listing" : "listings"}`
          }
        />
        <Figure
          label="Gross margin"
          value={e.grossMargin === null ? "—" : `${Math.round(e.grossMargin * 100)}%`}
          note={
            e.grossProfitUsdCents === null ? undefined : `${usd(e.grossProfitUsdCents)} per unit`
          }
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {e.missing.length > 0
          ? `Not enough data for a margin yet: needs ${e.missing.join(" and ")}.`
          : "Before shipping, ad spend, payment fees and returns."}
      </p>
    </div>
  );
}
