import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getSourceHealth, type HealthStatus } from "@/data/source-health";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { sourceLabel } from "@/lib/sources";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Data sources · Winning Product Hunter",
};

const STATUS_STYLE: Record<HealthStatus, { label: string; className: string }> = {
  healthy: {
    label: "Healthy",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  degraded: {
    label: "Some failures",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  stale: { label: "Stale", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  failing: { label: "Failing", className: "bg-red-500/15 text-red-700 dark:text-red-400" },
};

const PROVIDER_LABELS: Record<string, string> = {
  ad_library_web: "Ad Library website",
  shopify_catalog: "Global Catalog",
  fixture: "Sample data",
};

function formatTime(d: Date | null) {
  return d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—";
}

async function HealthTable() {
  await connection();
  if (!isDatabaseConfigured()) {
    return <p className="text-muted-foreground text-sm">No database configured.</p>;
  }
  let health;
  try {
    health = await getSourceHealth(await getDb());
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return <p className="text-muted-foreground text-sm">The database has no tables yet.</p>;
  }
  if (health.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No collection runs in the last 7 days. Run <code>npm run pipeline</code>.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Last run</th>
            <th className="px-3 py-2 font-medium">Items</th>
            <th className="px-3 py-2 font-medium">Last success</th>
            <th className="px-3 py-2 font-medium">Runs (7 days)</th>
          </tr>
        </thead>
        <tbody>
          {health.map((h) => (
            <tr key={`${h.source}|${h.provider}`} className="border-t align-top">
              <td className="px-3 py-3">
                <div className="font-medium">{sourceLabel(h.source)}</div>
                <div className="text-muted-foreground text-xs">
                  {PROVIDER_LABELS[h.provider] ?? h.provider}
                </div>
              </td>
              <td className="px-3 py-3">
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-xs font-medium",
                    STATUS_STYLE[h.status].className,
                  )}
                >
                  {STATUS_STYLE[h.status].label}
                </span>
                {h.lastRun.error && (
                  <p className="text-muted-foreground mt-1 max-w-xs text-xs break-words">
                    {h.lastRun.error}
                  </p>
                )}
              </td>
              <td className="px-3 py-3 tabular-nums">{formatTime(h.lastRun.startedAt)}</td>
              <td className="px-3 py-3 tabular-nums">{h.lastRun.itemsFetched}</td>
              <td className="px-3 py-3 tabular-nums">{formatTime(h.lastSuccessAt)}</td>
              <td className="px-3 py-3 tabular-nums">
                {h.runs}
                {h.failures > 0 && (
                  <span className="text-muted-foreground"> ({h.failures} failed)</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SourcesPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <Link
        href="/products"
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
      >
        ← Winning products
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Data sources</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl">
        Health of each data collection run over the last 7 days. A blocked or failing source shows
        its last error here; other sources keep running.
      </p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
          <HealthTable />
        </Suspense>
      </div>
    </main>
  );
}
