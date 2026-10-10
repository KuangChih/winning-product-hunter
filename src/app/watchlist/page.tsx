import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { WatchButton } from "@/components/watch-button";
import {
  ALERT_THRESHOLD,
  getWatchlist,
  scoreAlerts,
  scoreChange,
  type WatchedProduct,
} from "@/data/watchlist";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Watchlist · Winning Product Hunter",
};

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 rounded-lg border p-6">
      <h2 className="font-semibold">{title}</h2>
      <div className="text-muted-foreground mt-2 space-y-2 text-sm">{children}</div>
    </div>
  );
}

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const rounded = Math.round(value);
  return (
    <span
      className={cn(
        "tabular-nums",
        rounded > 0 && "text-emerald-600 dark:text-emerald-400",
        rounded < 0 && "text-red-600 dark:text-red-400",
      )}
    >
      {rounded > 0 ? `+${rounded}` : rounded === 0 ? "0" : `−${Math.abs(rounded)}`}
    </span>
  );
}

function WatchTable({ items }: { items: WatchedProduct[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="text-muted-foreground border-b text-left text-xs uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">Product</th>
            <th className="px-3 py-2 text-right font-medium">Score</th>
            <th className="px-3 py-2 text-right font-medium">Last update</th>
            <th className="px-3 py-2 text-right font-medium">Since added</th>
            <th className="px-3 py-2 font-medium">Added</th>
            <th className="px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <tr key={w.productId} className="border-t first:border-t-0">
              <td className="px-3 py-2">
                <Link
                  href={`/products/${w.slug}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {w.title}
                </Link>
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {w.score === null ? "Not scored" : w.score.toFixed(0)}
              </td>
              <td className="px-3 py-2 text-right">
                <Change value={scoreChange(w.score, w.previousScore)} />
              </td>
              <td className="px-3 py-2 text-right">
                <Change value={scoreChange(w.score, w.scoreAtAdd)} />
              </td>
              <td className="text-muted-foreground px-3 py-2">
                {w.addedAt.toISOString().slice(0, 10)}
              </td>
              <td className="px-3 py-2 text-right">
                <WatchButton productId={w.productId} watched />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Watchlist() {
  await connection();
  if (!isDatabaseConfigured()) {
    return (
      <Notice title="No database configured">
        <p>
          Set <code>DATABASE_URL</code> in <code>.env.local</code>.
        </p>
      </Notice>
    );
  }

  let items;
  try {
    items = await getWatchlist(await getDb());
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return (
      <Notice title="Database is not set up yet">
        <p>
          Run <code>npm run db:migrate</code>, or redeploy: Vercel builds apply migrations
          automatically.
        </p>
      </Notice>
    );
  }

  if (items.length === 0) {
    return (
      <Notice title="Nothing watched yet">
        <p>
          Open a product from the{" "}
          <Link href="/products" className="underline underline-offset-4">
            rankings
          </Link>{" "}
          and press Watch to follow its score here.
        </p>
      </Notice>
    );
  }

  const alerts = scoreAlerts(items);
  return (
    <div className="space-y-6">
      {alerts.length > 0 && (
        <section
          aria-labelledby="alerts-heading"
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
        >
          <h2 id="alerts-heading" className="font-semibold">
            Score changes
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {alerts.map((w) => (
              <li key={w.productId}>
                <Link href={`/products/${w.slug}`} className="underline underline-offset-4">
                  {w.title}
                </Link>{" "}
                moved <Change value={scoreChange(w.score, w.previousScore)} /> to{" "}
                {w.score!.toFixed(0)} in the last update.
              </li>
            ))}
          </ul>
        </section>
      )}
      <WatchTable items={items} />
    </div>
  );
}

export default function WatchlistPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Watchlist</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl">
        Products you follow. Moves of {ALERT_THRESHOLD}+ points since the previous daily update are
        highlighted.
      </p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground text-sm">Loading watchlist…</p>}>
          <Watchlist />
        </Suspense>
      </div>
    </main>
  );
}
