import Link from "next/link";
import type { RankedProduct } from "@/data/products";
import { marketName, marketTier } from "@/lib/markets";
import { sourceLabel } from "@/lib/sources";
import { confidenceLabel } from "@/scoring/score";
import { cn } from "@/lib/utils";

const CONFIDENCE_TEXT = { low: "Low", medium: "Medium", high: "High" } as const;

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-right font-mono text-sm font-semibold tabular-nums">
        {score.toFixed(0)}
      </span>
      <div className="bg-muted h-2 w-24 overflow-hidden rounded-full" aria-hidden>
        <div className="bg-primary h-full rounded-full" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

/** Countries with evidence; priority (tier 1) markets are emphasized. */
export function MarketList({ markets }: { markets: string[] }) {
  if (markets.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {markets.map((m) => (
        <li
          key={m}
          title={marketName(m)}
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-xs",
            marketTier(m) === 1 ? "bg-primary text-primary-foreground" : "bg-secondary",
          )}
        >
          {m}
        </li>
      ))}
    </ul>
  );
}

export function SampleDataBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400",
        className,
      )}
      title="Generated sample data, not real market data"
    >
      Sample data
    </span>
  );
}

export function ProductTable({ products }: { products: RankedProduct[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      {/* Scroll sideways on small screens instead of squeezing every column into tall rows. */}
      <table className="w-full min-w-[60rem] text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Product</th>
            <th className="px-3 py-2 font-medium">Winning Score</th>
            <th className="px-3 py-2 font-medium">Confidence</th>
            <th className="px-3 py-2 font-medium">Markets</th>
            <th className="px-3 py-2 font-medium">Evidence</th>
            <th className="px-3 py-2 font-medium">Active advertisers</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => (
            <tr key={p.id} className="hover:bg-muted/30 border-t">
              <td className="text-muted-foreground px-3 py-3 tabular-nums">{i + 1}</td>
              <td className="min-w-48 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/products/${p.slug}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {p.title}
                  </Link>
                  {p.isSample && <SampleDataBadge />}
                </div>
              </td>
              <td className="px-3 py-3">
                <ScoreBar score={p.score} />
              </td>
              <td className="px-3 py-3">{CONFIDENCE_TEXT[confidenceLabel(p.confidence)]}</td>
              <td className="min-w-44 px-3 py-3">
                <MarketList markets={p.markets} />
              </td>
              <td className="min-w-48 px-3 py-3">
                <ul className="flex flex-wrap gap-1">
                  {p.sources.map((s) => (
                    <li key={s} className="bg-secondary rounded px-1.5 py-0.5 text-xs">
                      {sourceLabel(s)}
                    </li>
                  ))}
                </ul>
              </td>
              <td className="px-3 py-3 tabular-nums">{p.breakdown.saturation.activeAdvertisers}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
