import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Landing } from "@/components/landing";
import { MarketList } from "@/components/product-table";
import { getRankedProducts } from "@/data/products";
import { getDb, isDatabaseConfigured } from "@/db/client";

/** The three best real products, or a short note when there is nothing to show yet. */
async function TopProductsPreview() {
  await connection();
  const empty = (
    <p className="text-muted-foreground text-sm">
      Rankings appear here once the daily collection has run.
    </p>
  );
  if (!isDatabaseConfigured()) return empty;
  let top;
  try {
    top = await getRankedProducts(await getDb(), { limit: 3 });
  } catch {
    // The landing page must never fail because of the database.
    return empty;
  }
  if (top.length === 0) return empty;
  return (
    <ol className="grid gap-4 sm:grid-cols-3">
      {top.map((p, i) => (
        <li key={p.id} className="rounded-lg border p-4">
          <div className="text-muted-foreground text-xs">#{i + 1}</div>
          <Link
            href={`/products/${p.slug}`}
            className="mt-1 block font-medium underline-offset-4 hover:underline"
          >
            {p.title}
          </Link>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <span className="text-3xl font-semibold tabular-nums">{p.score.toFixed(0)}</span>
            <MarketList markets={p.markets.slice(0, 5)} />
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function Home() {
  return (
    <Landing
      preview={
        <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
          <TopProductsPreview />
        </Suspense>
      }
    />
  );
}
