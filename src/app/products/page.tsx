import type { Metadata } from "next";
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

async function RankedProducts() {
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
    products = await getRankedProducts(await getDb());
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
    return (
      <Notice title="No scored products yet">
        <p>
          Run <code>npm run seed</code> to load sample data.
        </p>
      </Notice>
    );
  }
  return <ProductTable products={products} />;
}

export default function ProductsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Winning products</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl">
        Ranked by Winning Score: ad longevity, scaling activity, search demand and marketplace
        orders, boosted when sources agree and penalized when the market is crowded.
      </p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground text-sm">Loading rankings…</p>}>
          <RankedProducts />
        </Suspense>
      </div>
    </main>
  );
}
