import type { ScoreBreakdown as Breakdown, SubScoreName } from "@/scoring/score";

const SUB_SCORE_LABELS: Record<SubScoreName, string> = {
  longevity: "Ad longevity",
  scaling: "Scaling activity",
  marketReach: "Market reach",
  momentum: "Ad momentum",
  demandTrend: "Search demand trend",
  marketplace: "Marketplace orders",
  margin: "Profit margin",
};

function pct(x: number) {
  return `${Math.round(x * 100)}`;
}

export function ScoreBreakdown({ breakdown }: { breakdown: Breakdown }) {
  // Fixed display order: jsonb does not preserve key order.
  const entries = (Object.keys(SUB_SCORE_LABELS) as SubScoreName[])
    .filter((name) => breakdown.subScores[name])
    .map((name) => [name, breakdown.subScores[name]] as const);
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">Signal</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Weight</th>
              <th className="px-3 py-2 font-medium">How it is measured</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, s]) => (
              <tr key={name} className="border-t align-top">
                <td className="px-3 py-3 font-medium">{SUB_SCORE_LABELS[name]}</td>
                <td className="px-3 py-3 tabular-nums">
                  {s.value === null ? (
                    <span className="text-muted-foreground">No data</span>
                  ) : (
                    pct(s.value)
                  )}
                </td>
                <td className="text-muted-foreground px-3 py-3 tabular-nums">{pct(s.weight)}%</td>
                <td className="text-muted-foreground min-w-64 px-3 py-3">{s.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground">Cross-source boost</dt>
          <dd className="font-medium tabular-nums">
            ×{breakdown.corroboration.toFixed(2)} ({breakdown.sources.length} sources)
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground">Saturation penalty</dt>
          <dd className="font-medium tabular-nums">
            −{pct(breakdown.saturation.penalty)}% ({breakdown.saturation.activeAdvertisers} active
            advertisers
            {typeof breakdown.saturation.sellingStores === "number" &&
              `, ${breakdown.saturation.sellingStores} stores selling it`}
            , {breakdown.saturation.ageDays} days old)
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground">Single-source cap</dt>
          <dd className="font-medium">{breakdown.capped ? "Applied (max 70)" : "Not applied"}</dd>
        </div>
      </dl>
    </div>
  );
}
