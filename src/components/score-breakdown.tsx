import { getDictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import {
  type ScoreBreakdown as Breakdown,
  SUB_SCORE_ORDER as ORDER,
  type SubScore,
  type SubScoreName,
} from "@/scoring/score";

function pct(x: number) {
  return `${Math.round(x * 100)}`;
}

export function ScoreBreakdown({ breakdown, locale }: { breakdown: Breakdown; locale: Locale }) {
  const t = getDictionary(locale).breakdown;
  const entries = ORDER.filter((name) => breakdown.subScores[name]).map(
    (name) => [name, breakdown.subScores[name]] as const,
  );
  // Newer scores store a translatable code with their numbers. Older ones only have an English
  // sentence: shown as-is in English, replaced by a static method description otherwise.
  const explain = (name: SubScoreName, s: SubScore) => {
    if (s.explain) return fill(t.explain[s.explain.key], s.explain.params ?? {});
    return locale === "en" ? s.basis : t.methods[name];
  };
  const { saturation } = breakdown;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">{t.signal}</th>
              <th className="px-3 py-2 font-medium">{t.score}</th>
              <th className="px-3 py-2 font-medium">{t.weight}</th>
              <th className="px-3 py-2 font-medium">{t.howMeasured}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, s]) => (
              <tr key={name} className="border-t align-top">
                <td className="px-3 py-3 font-medium">{t.labels[name]}</td>
                <td className="px-3 py-3 tabular-nums">
                  {s.value === null ? (
                    <span className="text-muted-foreground">{t.noData}</span>
                  ) : (
                    pct(s.value)
                  )}
                </td>
                <td className="text-muted-foreground px-3 py-3 tabular-nums">{pct(s.weight)}%</td>
                <td className="text-muted-foreground min-w-64 px-3 py-3">{explain(name, s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground">{t.corroboration}</dt>
          <dd className="font-medium tabular-nums">
            {fill(t.corroborationValue, {
              boost: breakdown.corroboration.toFixed(2),
              n: breakdown.sources.length,
            })}
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground">{t.saturation}</dt>
          <dd className="font-medium tabular-nums">
            {fill(t.saturationValue, {
              pct: pct(saturation.penalty),
              advertisers: saturation.activeAdvertisers,
              stores:
                typeof saturation.sellingStores === "number"
                  ? fill(t.saturationStores, { n: saturation.sellingStores })
                  : "",
              days: saturation.ageDays,
            })}
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground">{t.cap}</dt>
          <dd className="font-medium">{breakdown.capped ? t.capApplied : t.capNotApplied}</dd>
        </div>
      </dl>
    </div>
  );
}
