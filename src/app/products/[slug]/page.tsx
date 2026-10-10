import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EvidenceList } from "@/components/evidence-list";
import { MarginEstimate } from "@/components/margin-estimate";
import { SampleDataBadge } from "@/components/product-table";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { Sparkline } from "@/components/sparkline";
import { WatchButton } from "@/components/watch-button";
import { getProductDetail, getProductTitle } from "@/data/product-detail";
import { isWatched } from "@/data/watchlist";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { estimateMargin } from "@/lib/margin";
import { confidenceLabel } from "@/scoring/score";

const CONFIDENCE_TEXT = { low: "Low", medium: "Medium", high: "High" } as const;
const SITE_NAME = "Winning Product Hunter";

// The page body already streams per request, so this metadata streams with it.
export async function generateMetadata({
  params,
}: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  await connection();
  let title: string | null = null;
  if (isDatabaseConfigured()) {
    try {
      title = await getProductTitle(await getDb(), decodeURIComponent(slug));
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }
  }
  return { title: title ? `${title} · ${SITE_NAME}` : `Product not found · ${SITE_NAME}` };
}

async function ProductDetailView({ params }: { params: Promise<{ slug: string }> }) {
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
  if (!product) notFound();
  // Duplicates merged by dedupe keep working links: send them to the surviving product.
  if ("redirectTo" in product) redirect(`/products/${encodeURIComponent(product.redirectTo)}`);
  const watched = await isWatched(db, product.id);

  const now = new Date();
  return (
    <>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{product.title}</h1>
          {product.isSample && <SampleDataBadge />}
          <div className="ml-auto">
            <WatchButton productId={product.id} watched={watched} />
          </div>
        </div>
        {product.score ? (
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <div className="text-muted-foreground text-xs uppercase">Winning Score</div>
              <div className="text-5xl font-semibold tabular-nums">
                {product.score.score.toFixed(0)}
              </div>
            </div>
            <div className="text-sm">
              <div>
                Confidence:{" "}
                <span className="font-medium">
                  {CONFIDENCE_TEXT[confidenceLabel(product.score.confidence)]}
                </span>
              </div>
              <div className="text-muted-foreground">
                Updated {product.score.computedAt.toISOString().slice(0, 10)}
              </div>
            </div>
            <Sparkline
              values={product.scoreHistory.map((s) => s.score)}
              label="Winning Score history"
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">This product has not been scored yet.</p>
        )}
      </header>

      {product.score && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Why this score</h2>
          <ScoreBreakdown breakdown={product.score.breakdown} />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Margin estimate</h2>
        <MarginEstimate estimate={estimateMargin(product.evidence, product.fxRates)} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Evidence</h2>
        <EvidenceList evidence={product.evidence} now={now} fxRates={product.fxRates} />
      </section>
    </>
  );
}

export default function ProductPage({ params }: PageProps<"/products/[slug]">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-10 px-4 py-10">
      <Link
        href="/products"
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
      >
        ← All winning products
      </Link>
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading product…</p>}>
        <ProductDetailView params={params} />
      </Suspense>
    </main>
  );
}
