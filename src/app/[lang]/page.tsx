import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { HOME_LINK_CLASS, StatusStrip } from "@/components/home-status";
import { Notice } from "@/components/notice";
import { ProductCard } from "@/components/product-table";
import { ListSkeleton } from "@/components/skeleton";
import { StartDiscoveryCard } from "@/components/start-discovery-card";
import { buttonVariants } from "@/components/ui/button";
import { WatchAlerts } from "@/components/watch-alerts";
import { getPipelineStatus } from "@/data/pipeline-status";
import { getRankedProducts, type RankedProduct } from "@/data/products";
import { getWatchedIds, getWatchlist, scoreAlerts, type WatchedProduct } from "@/data/watchlist";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { getDictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { getLocale } from "@/i18n/server";
import type { PipelineStatus } from "@/pipeline/web";

/** How many top products the home page shows. */
const TOP_COUNT = 6;

/** The live part of the home page: status, watchlist alerts and the top products. */
async function Dashboard({ locale }: { locale: Locale }) {
  await connection();
  const dict = getDictionary(locale);
  const t = dict.home;
  // The home page never fails because of the database: a read error says so instead of
  // pretending there are no products.
  const loadError = (
    <Notice title={dict.common.loadErrorTitle}>
      <p>{dict.common.loadErrorBody}</p>
    </Notice>
  );

  const db = isDatabaseConfigured() ? await getDb() : null;
  let ranked: RankedProduct[] = [];
  let alerts: WatchedProduct[] = [];
  let status: PipelineStatus;
  try {
    [ranked, alerts, status] = await Promise.all([
      db ? getRankedProducts(db) : [],
      db ? getWatchlist(db).then((items) => scoreAlerts(items)) : [],
      getPipelineStatus(process.env, db ?? undefined),
    ]);
  } catch (err) {
    // Tables not created yet: the start card explains it.
    if (!isMissingTableError(err)) return loadError;
    try {
      status = await getPipelineStatus(process.env, db ?? undefined);
    } catch {
      return loadError;
    }
  }

  if (ranked.length === 0) {
    return (
      <StartDiscoveryCard
        title={dict.ranking.noneTitle}
        body={dict.ranking.noneBody}
        status={status}
        labels={dict.discover}
      />
    );
  }

  const top = ranked.slice(0, TOP_COUNT);
  const watchedIds = await getWatchedIds(
    db!,
    top.map((p) => p.id),
  );
  const now = new Date();
  return (
    <div className="space-y-6">
      <StatusStrip ranked={ranked} status={status} dict={dict} />
      <WatchAlerts alerts={alerts} labels={dict.watchlist} />
      <section aria-labelledby="top-heading" className="space-y-3">
        <h2 id="top-heading" className="text-lg font-semibold">
          {t.previewHeading}
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {top.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} locale={locale} watched={watchedIds.has(p.id)} now={now} />
            </li>
          ))}
        </ol>
        <Link href="/products" className={HOME_LINK_CLASS}>
          {fill(t.viewAll, { n: ranked.length.toLocaleString("en-US") })}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </section>
    </div>
  );
}

export default async function Home() {
  const locale = await getLocale();
  const t = getDictionary(locale).home;
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Winning Product Hunter
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm sm:text-base">{t.intro}</p>
        </div>
        <Link href="/products" className={buttonVariants()}>
          {t.ctaProducts}
        </Link>
      </div>
      <div className="mt-6 sm:mt-8">
        <Suspense fallback={<ListSkeleton label={t.loading} rows={3} />}>
          <Dashboard locale={locale} />
        </Suspense>
      </div>
    </main>
  );
}
