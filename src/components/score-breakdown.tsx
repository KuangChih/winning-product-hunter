import { getDictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";
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
      {/* Stacked rows instead of a wide table: readable on a phone without sideways scrolling. */}
      <ul className="divide-y rounded-lg border">
        {entries.map(([name, s]) => {
          const value = s.value === null ? null : Math.round(s.value * 100);
          return (
            <li key={name} className="space-y-2 px-3 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{t.labels[name]}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {fill(t.weightValue, { pct: pct(s.weight) })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {/* The number next to it carries the value; the bar is only a visual aid. */}
                <div
                  aria-hidden
                  className={cn(
                    "h-2 flex-1 overflow-hidden rounded-full",
                    value === null ? "border border-dashed" : "bg-muted",
                  )}
                >
                  {value !== null && (
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${value}%` }}
                    />
                  )}
                </div>
                <span className="w-8 text-right font-mono text-sm tabular-nums">
                  {value === null ? (
                    <>
                      <span aria-hidden className="text-muted-foreground">
                        —
                      </span>
                      <span className="sr-only">{t.noData}</span>
                    </>
                  ) : (
                    value
                  )}
                </span>
              </div>
              <details className="group text-sm">
                <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs underline-offset-4 hover:underline">
                  {t.howMeasured}
                </summary>
                <p className="text-muted-foreground mt-1">{explain(name, s)}</p>
              </details>
            </li>
          );
        })}
      </ul>
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
