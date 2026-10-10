import type { Dictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/format";
import { formatUsd as usd } from "@/lib/format";
import type { MarginEstimate as Estimate } from "@/lib/margin";

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
export function MarginEstimate({ estimate, t }: { estimate: Estimate; t: Dictionary["margin"] }) {
  const e = estimate;
  const missing = e.missing.map((m) => (m === "retail" ? t.missingRetail : t.missingSupplier));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure
          label={t.retail}
          value={e.retailUsdCents === null ? "—" : usd(e.retailUsdCents)}
          note={
            e.retailUsdCents === null
              ? undefined
              : e.retailOffers === 1
                ? t.retailNoteOne
                : fill(t.retailNote, { n: e.retailOffers })
          }
        />
        <Figure
          label={t.supplier}
          value={e.supplierUsdCents === null ? "—" : usd(e.supplierUsdCents)}
          note={
            e.supplierUsdCents === null
              ? undefined
              : e.supplierListings === 1
                ? t.supplierNoteOne
                : fill(t.supplierNote, { n: e.supplierListings })
          }
        />
        <Figure
          label={t.grossMargin}
          value={e.grossMargin === null ? "—" : `${Math.round(e.grossMargin * 100)}%`}
          note={
            e.grossProfitUsdCents === null
              ? undefined
              : fill(t.perUnit, { amount: usd(e.grossProfitUsdCents) })
          }
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {missing.length > 0 ? fill(t.missing, { items: missing.join(t.missingJoin) }) : t.caveat}
      </p>
    </div>
  );
}
