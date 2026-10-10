import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProductTable } from "@/components/product-table";
import { RankingControls } from "@/components/ranking-controls";
import { getRankedProducts } from "@/data/products";
import { parseRankingParams } from "@/data/ranking-params";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";

export const metadata: Metadata = {
  title: "Winning products · Winning Product Hunter",
};

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
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { includeSample, ...filters } = parseRankingParams(await searchParams);
  await connection();
  if (!isDatabaseConfigured()) {
    return (
      <Notice title="No database configured">
        <p>
          Set <code>DATABASE_URL</code> in <code>.env.local</code> to a Neon connection string, or
          to <code>pglite:./.data/dev</code> for a local demo database.
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
      <Notice title="Database is not set up yet">
        <p>
          The database has no tables. Run <code>npm run db:migrate</code>, or redeploy: Vercel
          builds apply migrations automatically.
        </p>
      </Notice>
    );
  }

  const filtered = Boolean(filters.q || filters.market || filters.minScore !== undefined);
  let content;
  if (products.length > 0) {
    content = <ProductTable products={products} />;
  } else if (filtered) {
    content = (
      <Notice title="No products match these filters">
        <p>Try a broader search, another market or a lower minimum score.</p>
      </Notice>
    );
  } else if (includeSample) {
    content = (
      <Notice title="No scored products yet">
        <p>
          Run <code>npm run pipeline</code> to collect real data, or <code>npm run seed</code> to
          load sample data.
        </p>
      </Notice>
    );
  } else {
    content = (
      <Notice title="No real products yet">
        <p>
          Run <code>npm run pipeline</code> to discover products from real data, or{" "}
          <Link href="/products?sample=1" className="underline underline-offset-4">
            include sample data
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
      />
      {content}
    </>
  );
}

export default function ProductsPage({ searchParams }: PageProps<"/products">) {
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Winning products</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl">
        Ranked by Winning Score: ad longevity, scaling activity, search demand and marketplace
        orders, boosted when sources agree and penalized when the market is crowded.
      </p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground text-sm">Loading rankings…</p>}>
          <RankedProducts searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
