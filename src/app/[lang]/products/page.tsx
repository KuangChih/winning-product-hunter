import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Notice } from "@/components/notice";
import { ProductTable } from "@/components/product-table";
import { RankingControls } from "@/components/ranking-controls";
import { ListSkeleton } from "@/components/skeleton";
import { StartDiscoveryCard } from "@/components/start-discovery-card";
import { getPipelineStatus } from "@/data/pipeline-status";
import { getRankedProducts } from "@/data/products";
import { parseRankingParams } from "@/data/ranking-params";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locales";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLocale());
  return { title: `${t.ranking.title} · ${t.site.name}` };
}

async function RankedProducts({
  searchParams,
  locale,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  locale: Locale;
}) {
  const { ranking: t, common, discover } = getDictionary(locale);
  const filters = parseRankingParams(await searchParams);
  await connection();
  if (!isDatabaseConfigured()) {
    return (
      <Notice title={common.noDatabaseTitle}>
        <p>{common.noDatabaseBody}</p>
      </Notice>
    );
  }

  const db = await getDb();
  let products;
  try {
    products = await getRankedProducts(db, filters);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return (
      <Notice title={common.notSetUpTitle}>
        <p>{common.notSetUpBody}</p>
      </Notice>
    );
  }

  const filtered = Boolean(
    filters.q ||
    filters.market ||
    filters.source ||
    filters.signals ||
    filters.minScore !== undefined ||
    filters.minPrice !== undefined ||
    filters.maxPrice !== undefined,
  );
  let content;
  if (products.length > 0) {
    content = (
      <>
        <ProductTable products={products} locale={locale} filters={filters} />
        <p className="text-muted-foreground mt-2 text-xs">
          {t.signalsNote} {t.priceNote}
        </p>
      </>
    );
  } else if (filtered) {
    content = (
      <Notice title={t.noMatchTitle}>
        <p>{t.noMatchBody}</p>
      </Notice>
    );
  } else {
    content = (
      <StartDiscoveryCard
        title={t.noneTitle}
        body={t.noneBody}
        status={await getPipelineStatus(process.env, db)}
        labels={discover}
      />
    );
  }
  return (
    <>
      <RankingControls
        filters={filters}
        // "0 products" next to the empty-state card would only repeat it.
        resultCount={products.length > 0 || filtered ? products.length : undefined}
        locale={locale}
      />
      {content}
    </>
  );
}

export default async function ProductsPage({ searchParams }: PageProps<"/[lang]/products">) {
  const locale = await getLocale();
  const t = getDictionary(locale).ranking;
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.title}</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl text-sm sm:text-base">{t.intro}</p>
      <div className="mt-6 sm:mt-8">
        <Suspense fallback={<ListSkeleton label={t.loading} />}>
          <RankedProducts searchParams={searchParams} locale={locale} />
        </Suspense>
      </div>
    </main>
  );
}
