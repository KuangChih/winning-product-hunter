import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EvidenceList } from "@/components/evidence-list";
import { MarginEstimate } from "@/components/margin-estimate";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { BlockSkeleton } from "@/components/skeleton";
import { KeyFacts, ProductSummary } from "@/components/product-summary";
import { getProductDetail, getProductTitle } from "@/data/product-detail";
import { isWatched } from "@/data/watchlist";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locales";
import { getLocale } from "@/i18n/server";
import { adFacts } from "@/lib/ad-facts";
import { estimateMargin } from "@/lib/margin";
import { sortByMarketPriority } from "@/lib/markets";

// The page body already streams per request, so this metadata streams with it.
export async function generateMetadata({
  params,
}: PageProps<"/[lang]/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const t = getDictionary(await getLocale());
  await connection();
  let title: string | null = null;
  if (isDatabaseConfigured()) {
    try {
      title = await getProductTitle(await getDb(), decodeURIComponent(slug));
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }
  }
  return { title: `${title ?? t.detail.notFoundTitle} · ${t.site.name}` };
}

async function ProductDetailView({
  params,
  locale,
}: {
  params: Promise<{ slug: string }>;
  locale: Locale;
}) {
  const dict = getDictionary(locale);
  const t = dict.detail;
  const { slug } = await params;
  await connection();
  if (!isDatabaseConfigured()) notFound();

  const db = await getDb();
  let product;
  try {
    product = await getProductDetail(db, decodeURIComponent(slug));
  } catch (err) {
    if (isMissingTableError(err)) notFound();
    throw err;
  }
  // Unknown, or sample (fixture) data, which is for automated tests only.
  if (!product) notFound();
  // Duplicates merged by dedupe keep working links: send them to the surviving product.
  if ("redirectTo" in product) redirect(`/products/${encodeURIComponent(product.redirectTo)}`);
  const now = new Date();
  const facts = adFacts(product.evidence, now);
  const margin = estimateMargin(product.evidence, product.fxRates, product.landedCost);
  const markets = sortByMarketPriority(new Set(product.evidence.flatMap((e) => e.countries)));
  const watched = await isWatched(db, product.id);

  return (
    <>
      <ProductSummary product={product} facts={facts} watched={watched} locale={locale} />

      <KeyFacts
        facts={facts}
        markets={markets}
        retailUsdCents={margin.retailUsdCents}
        retailBasis={margin.retailBasis}
        locale={locale}
      />

      {product.score && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t.whyHeading}</h2>
          <ScoreBreakdown breakdown={product.score.breakdown} locale={locale} />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t.marginHeading}</h2>
        <MarginEstimate estimate={margin} t={dict.margin} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t.evidenceHeading}</h2>
        <EvidenceList
          evidence={product.evidence}
          now={now}
          fxRates={product.fxRates}
          locale={locale}
        />
      </section>
    </>
  );
}

export default async function ProductPage({ params }: PageProps<"/[lang]/products/[slug]">) {
  const locale = await getLocale();
  const t = getDictionary(locale).detail;
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-8 sm:space-y-10 sm:py-10"
    >
      <Link
        href="/products"
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
      >
        {t.backToRankings}
      </Link>
      <Suspense fallback={<BlockSkeleton label={t.loading} />}>
        <ProductDetailView params={params} locale={locale} />
      </Suspense>
    </main>
  );
}
