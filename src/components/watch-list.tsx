import Link from "next/link";
import { scoreChange, type WatchedProduct } from "@/data/watchlist";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locales";
import { ProductThumb } from "./product-thumb";
import { ScoreBadge } from "./score-badge";
import { ScoreChange } from "./watch-alerts";
import { WatchButton } from "./watch-button";

function Value({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs whitespace-nowrap">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/**
 * Watched products, one per row: a card on a phone (the numbers wrap under the name), a compact
 * row from `md` up. Same markup at every width, so there is never a sideways scroll.
 */
export function WatchList({ items, locale }: { items: WatchedProduct[]; locale: Locale }) {
  const { watchlist: t, detail } = getDictionary(locale);
  return (
    <ul aria-label={t.listLabel} className="space-y-3">
      {items.map((w) => (
        <li key={w.productId}>
          <article className="flex flex-wrap items-center gap-3 rounded-lg border p-3 md:flex-nowrap md:gap-4">
            <ProductThumb src={w.imageUrl} size="sm" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm leading-snug font-medium">
                <Link
                  href={`/products/${w.slug}`}
                  className="line-clamp-2 break-words underline-offset-4 hover:underline"
                >
                  {w.title}
                </Link>
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t.columns.added} {w.addedAt.toISOString().slice(0, 10)}
              </p>
            </div>
            <dl className="order-last grid w-full grid-cols-3 gap-3 md:order-none md:flex md:w-auto md:gap-6">
              <Value label={t.columns.score}>
                {w.score === null ? (
                  <span className="text-muted-foreground">{t.notScored}</span>
                ) : (
                  <ScoreBadge score={w.score} />
                )}
              </Value>
              <Value label={t.columns.lastUpdate}>
                <ScoreChange value={scoreChange(w.score, w.previousScore)} />
              </Value>
              <Value label={t.columns.sinceAdded}>
                <ScoreChange value={scoreChange(w.score, w.scoreAtAdd)} />
              </Value>
            </dl>
            <WatchButton productId={w.productId} watched labels={detail} />
          </article>
        </li>
      ))}
    </ul>
  );
}
