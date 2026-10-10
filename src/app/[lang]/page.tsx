import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Landing } from "@/components/landing";
import { Notice } from "@/components/notice";
import { MarketList } from "@/components/product-table";
import { ProductThumb } from "@/components/product-thumb";
import { ScoreBadge } from "@/components/score-badge";
import { ListSkeleton } from "@/components/skeleton";
import { StartDiscoveryCard } from "@/components/start-discovery-card";
import { getPipelineStatus } from "@/data/pipeline-status";
import { getRankedProducts, type RankedProduct } from "@/data/products";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locales";
import { getLocale } from "@/i18n/server";

/** The three best real products, or the start-discovery card when there is nothing yet. */
async function TopProductsPreview({ locale }: { locale: Locale }) {
  await connection();
  const dict = getDictionary(locale);
  // The home page never fails because of the database: a read error says so instead of
  // pretending there are no products.
  const loadError = (
    <Notice title={dict.common.loadErrorTitle} heading="h3">
      <p>{dict.common.loadErrorBody}</p>
    </Notice>
  );
  let top: RankedProduct[] = [];
  if (isDatabaseConfigured()) {
    try {
      top = await getRankedProducts(await getDb(), { limit: 3 });
    } catch (err) {
      // Tables not created yet: the start card below explains it.
      if (!isMissingTableError(err)) return loadError;
    }
  }
  if (top.length === 0) {
    let status;
    try {
      status = await getPipelineStatus();
    } catch {
      return loadError;
    }
    return (
      <StartDiscoveryCard
        title={dict.ranking.noneTitle}
        body={dict.ranking.noneBody}
        status={status}
        labels={dict.discover}
        heading="h3"
      />
    );
  }
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {top.map((p, i) => (
        <li key={p.id} className="flex gap-3 rounded-lg border p-3">
          <ProductThumb src={p.imageUrl} />
          <div className="min-w-0 flex-1">
            <div className="text-muted-foreground text-xs">#{i + 1}</div>
            <Link
              href={`/products/${p.slug}`}
              className="line-clamp-2 font-medium underline-offset-4 hover:underline"
            >
              {p.title}
            </Link>
            <div className="mt-2 flex items-center justify-between gap-2">
              <ScoreBadge score={p.score} />
              <MarketList markets={p.markets.slice(0, 3)} locale={locale} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default async function Home() {
  const locale = await getLocale();
  const t = getDictionary(locale).landing;
  return (
    <Landing
      t={t}
      preview={
        <Suspense fallback={<ListSkeleton label={t.loading} rows={3} />}>
          <TopProductsPreview locale={locale} />
        </Suspense>
      }
    />
  );
}
