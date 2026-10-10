import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProductTable } from "@/components/product-table";
import { getRankedProducts } from "@/data/products";
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

async function RankedProducts({ includeSample }: { includeSample: boolean }) {
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
    products = await getRankedProducts(await getDb(), { includeSample });
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
  if (products.length === 0) {
    return includeSample ? (
      <Notice title="No scored products yet">
        <p>
          Run <code>npm run pipeline</code> to collect real data, or <code>npm run seed</code> to
          load sample data.
        </p>
      </Notice>
    ) : (
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
  return <ProductTable products={products} />;
}

async function SampleToggle({ searchParams }: { searchParams: Promise<{ sample?: string }> }) {
  const includeSample = (await searchParams).sample === "1";
  return (
    <>
      <nav aria-label="Data filter" className="mb-4 flex gap-2 text-sm">
        <Link
          href="/products"
          aria-current={includeSample ? undefined : "page"}
          className={
            includeSample
              ? "text-muted-foreground underline-offset-4 hover:underline"
              : "font-medium"
          }
        >
          Real data only
        </Link>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <Link
          href="/products?sample=1"
          aria-current={includeSample ? "page" : undefined}
          className={
            includeSample
              ? "font-medium"
              : "text-muted-foreground underline-offset-4 hover:underline"
          }
        >
          Include sample data
        </Link>
      </nav>
      <RankedProducts includeSample={includeSample} />
    </>
  );
}

export default function ProductsPage({ searchParams }: PageProps<"/products">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Winning products</h1>
        <Link
          href="/sources"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          Data sources
        </Link>
      </div>
      <p className="text-muted-foreground mt-2 max-w-2xl">
        Ranked by Winning Score: ad longevity, scaling activity, search demand and marketplace
        orders, boosted when sources agree and penalized when the market is crowded.
      </p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground text-sm">Loading rankings…</p>}>
          <SampleToggle searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
