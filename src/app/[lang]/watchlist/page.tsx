import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Notice } from "@/components/notice";
import { ScoreBadge } from "@/components/score-badge";
import { ListSkeleton } from "@/components/skeleton";
import { WatchButton } from "@/components/watch-button";
import { ScoreChange, WatchAlerts } from "@/components/watch-alerts";
import {
  ALERT_THRESHOLD,
  getWatchlist,
  scoreAlerts,
  scoreChange,
  type WatchedProduct,
} from "@/data/watchlist";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { type Dictionary, getDictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLocale());
  return { title: `${t.watchlist.title} · ${t.site.name}` };
}

function WatchTable({ items, dict }: { items: WatchedProduct[]; dict: Dictionary }) {
  const t = dict.watchlist;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="text-muted-foreground border-b text-left text-xs uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">{t.columns.product}</th>
            <th className="px-3 py-2 text-right font-medium">{t.columns.score}</th>
            <th className="px-3 py-2 text-right font-medium">{t.columns.lastUpdate}</th>
            <th className="px-3 py-2 text-right font-medium">{t.columns.sinceAdded}</th>
            <th className="px-3 py-2 font-medium">{t.columns.added}</th>
            <th className="px-3 py-2">
              <span className="sr-only">{t.columns.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <tr key={w.productId} className="border-t first:border-t-0">
              <td className="px-3 py-2">
                <Link
                  href={`/products/${w.slug}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {w.title}
                </Link>
              </td>
              <td className="px-3 py-2 text-right">
                {w.score === null ? (
                  <span className="text-muted-foreground">{t.notScored}</span>
                ) : (
                  <ScoreBadge score={w.score} />
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <ScoreChange value={scoreChange(w.score, w.previousScore)} />
              </td>
              <td className="px-3 py-2 text-right">
                <ScoreChange value={scoreChange(w.score, w.scoreAtAdd)} />
              </td>
              <td className="text-muted-foreground px-3 py-2">
                {w.addedAt.toISOString().slice(0, 10)}
              </td>
              <td className="px-3 py-2 text-right">
                <WatchButton productId={w.productId} watched labels={dict.detail} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Watchlist({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const { watchlist: t, common } = dict;
  await connection();
  if (!isDatabaseConfigured()) {
    return (
      <Notice title={common.noDatabaseTitle}>
        <p>{common.noDatabaseBody}</p>
      </Notice>
    );
  }

  let items;
  try {
    items = await getWatchlist(await getDb());
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return (
      <Notice title={common.notSetUpTitle}>
        <p>{common.notSetUpBody}</p>
      </Notice>
    );
  }

  if (items.length === 0) {
    return (
      <Notice title={t.emptyTitle}>
        <p>
          {t.emptyBefore}{" "}
          <Link href="/products" className="underline underline-offset-4">
            {t.emptyLink}
          </Link>{" "}
          {t.emptyAfter}
        </p>
      </Notice>
    );
  }

  const alerts = scoreAlerts(items);
  return (
    <div className="space-y-6">
      <WatchAlerts alerts={alerts} labels={t} />
      <WatchTable items={items} dict={dict} />
    </div>
  );
}

export default async function WatchlistPage() {
  const locale = await getLocale();
  const t = getDictionary(locale).watchlist;
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.title}</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl text-sm sm:text-base">
        {fill(t.intro, { n: ALERT_THRESHOLD })}
      </p>
      <div className="mt-6 sm:mt-8">
        <Suspense fallback={<ListSkeleton label={t.loading} rows={3} />}>
          <Watchlist locale={locale} />
        </Suspense>
      </div>
    </main>
  );
}
