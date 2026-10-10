import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProductTable } from "@/components/product-table";
import { RankingControls } from "@/components/ranking-controls";
import { getRankedProducts } from "@/data/products";
import { parseRankingParams } from "@/data/ranking-params";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { getDictionary } from "@/i18n/dictionaries";
import { RichText } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLocale());
  return { title: `${t.ranking.title} · ${t.site.name}` };
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 rounded-lg border p-6">
      <h2 className="font-semibold">{title}</h2>
      <div className="text-muted-foreground mt-2 space-y-2 text-sm">{children}</div>
    </div>
  );
}

async function RankedProducts({
  searchParams,
  locale,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  locale: Locale;
}) {
  const { ranking: t, common } = getDictionary(locale);
  const { includeSample, ...filters } = parseRankingParams(await searchParams);
  await connection();
  if (!isDatabaseConfigured()) {
    return (
      <Notice title={common.noDatabaseTitle}>
        <p>
          <RichText text={common.noDatabaseBody} />
        </p>
      </Notice>
    );
  }

  let products;
  try {
    products = await getRankedProducts(await getDb(), { includeSample, ...filters });
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return (
      <Notice title={common.notSetUpTitle}>
        <p>
          <RichText text={common.notSetUpBody} />
        </p>
      </Notice>
    );
  }

  const filtered = Boolean(filters.q || filters.market || filters.minScore !== undefined);
  let content;
  if (products.length > 0) {
    content = <ProductTable products={products} locale={locale} />;
  } else if (filtered) {
    content = (
      <Notice title={t.noMatchTitle}>
        <p>{t.noMatchBody}</p>
      </Notice>
    );
  } else if (includeSample) {
    content = (
      <Notice title={t.noScoredTitle}>
        <p>
          <RichText text={t.noScoredBody} />
        </p>
      </Notice>
    );
  } else {
    content = (
      <Notice title={t.noRealTitle}>
        <p>
          <RichText text={t.noRealBody} />{" "}
          <Link href="/products?sample=1" className="underline underline-offset-4">
            {t.includeSampleLink}
          </Link>
          .
        </p>
      </Notice>
    );
  }
  return (
    <>
      <RankingControls
        filters={filters}
        includeSample={includeSample}
        resultCount={products.length}
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
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl">{t.intro}</p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground text-sm">{t.loading}</p>}>
          <RankedProducts searchParams={searchParams} locale={locale} />
        </Suspense>
      </div>
    </main>
  );
}
