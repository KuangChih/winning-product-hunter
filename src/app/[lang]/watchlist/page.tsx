import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Notice } from "@/components/notice";
import { ListSkeleton } from "@/components/skeleton";
import { WatchAlerts } from "@/components/watch-alerts";
import { WatchList } from "@/components/watch-list";
import { ALERT_THRESHOLD, getWatchlist, scoreAlerts } from "@/data/watchlist";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { getDictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLocale());
  return { title: `${t.watchlist.title} · ${t.site.name}` };
}

async function Watchlist({ locale }: { locale: Locale }) {
  const { watchlist: t, common } = getDictionary(locale);
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
      <WatchList items={items} locale={locale} />
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
