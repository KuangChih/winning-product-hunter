import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { DiscoveryPanel } from "@/components/discovery-panel";
import { ErrorText, RunStatusBadge } from "@/components/run-progress";
import { BlockSkeleton } from "@/components/skeleton";
import { getPipelineStatus, getRecentRuns } from "@/data/pipeline-status";
import { getSourceHealth, type HealthStatus } from "@/data/source-health";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { getDictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { getLocale } from "@/i18n/server";
import { formatUtc } from "@/lib/format";
import { sourceLabel } from "@/lib/sources";
import { cn } from "@/lib/utils";
import { MAX_CUSTOM_KEYWORDS } from "@/pipeline/runner";

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLocale());
  return { title: `${t.discover.title} · ${t.site.name}` };
}

/** Start button, notices and live progress (the client part polls while a run is active). */
async function DiscoveryLive({ locale }: { locale: Locale }) {
  const t = getDictionary(locale).discover;
  await connection();
  const status = await getPipelineStatus();
  return (
    <DiscoveryPanel
      initialStatus={status}
      labels={t}
      locale={locale}
      maxKeywords={MAX_CUSTOM_KEYWORDS}
    />
  );
}

async function RunHistory({ locale }: { locale: Locale }) {
  const t = getDictionary(locale).discover;
  await connection();
  const runs = await getRecentRuns(10);
  if (runs.length === 0) return <p className="text-muted-foreground text-sm">{t.historyEmpty}</p>;
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {runs.map((run) => (
        <li key={run.id} className="flex flex-col gap-1 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">{formatUtc(run.createdAt)}</span>
            <span className="text-muted-foreground">{t.triggers[run.trigger]}</span>
            <RunStatusBadge status={run.status} labels={t} />
          </div>
          <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
            <span>{fill(t.historyNewProducts, { n: run.summary.newProducts })}</span>
            <span>{fill(t.historyNewAds, { n: run.summary.newAds })}</span>
            {run.customKeywords && run.keywords && (
              <span className="break-words">
                {fill(t.customKeywordsUsed, { list: run.keywords.join(", ") })}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

const STATUS_CLASS: Record<HealthStatus, string> = {
  healthy: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-50",
  degraded: "bg-amber-100 text-amber-900 dark:bg-amber-900/70 dark:text-amber-50",
  stale: "bg-amber-100 text-amber-900 dark:bg-amber-900/70 dark:text-amber-50",
  failing: "bg-red-100 text-red-900 dark:bg-red-900/70 dark:text-red-50",
};

async function SourceHealthList({ locale }: { locale: Locale }) {
  const { sources: t, discover } = getDictionary(locale);
  await connection();
  if (!isDatabaseConfigured()) {
    return <p className="text-muted-foreground text-sm">{t.noDatabase}</p>;
  }
  let health;
  try {
    health = await getSourceHealth(await getDb());
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return <p className="text-muted-foreground text-sm">{t.noTables}</p>;
  }
  if (health.length === 0) return <p className="text-muted-foreground text-sm">{t.noRuns}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {health.map((h) => (
        <li key={`${h.source}|${h.provider}`} className="rounded-lg border p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium">{sourceLabel(h.source, locale)}</div>
              <div className="text-muted-foreground text-xs">
                {t.providers[h.provider] ?? h.provider}
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium",
                STATUS_CLASS[h.status],
              )}
            >
              {t.status[h.status]}
            </span>
          </div>
          {h.lastRun.error && (
            <ErrorText message={h.lastRun.error} labels={discover} className="mt-2 text-xs" />
          )}
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-muted-foreground">{t.columns.lastRun}</dt>
            <dd className="tabular-nums">{formatUtc(h.lastRun.startedAt)}</dd>
            <dt className="text-muted-foreground">{t.columns.items}</dt>
            <dd className="tabular-nums">{h.lastRun.itemsFetched}</dd>
            <dt className="text-muted-foreground">{t.columns.lastSuccess}</dt>
            <dd className="tabular-nums">{formatUtc(h.lastSuccessAt)}</dd>
            <dt className="text-muted-foreground">{t.columns.runs}</dt>
            <dd className="tabular-nums">
              {h.runs}
              {h.failures > 0 && fill(t.failed, { n: h.failures })}
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

export default async function DiscoverPage() {
  const locale = await getLocale();
  const { discover: t, sources } = getDictionary(locale);
  return (
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-4 py-8 sm:py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.title}</h1>
        <p className="text-muted-foreground mt-2">{t.intro}</p>
      </div>

      <Suspense fallback={<BlockSkeleton label={t.loading} />}>
        <DiscoveryLive locale={locale} />
      </Suspense>

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          {t.historyTitle}
        </h2>
        <Suspense fallback={<BlockSkeleton label={t.loading} />}>
          <RunHistory locale={locale} />
        </Suspense>
      </section>

      <section aria-labelledby="health-heading" className="space-y-3">
        <h2 id="health-heading" className="text-lg font-semibold">
          {sources.title}
        </h2>
        <p className="text-muted-foreground text-sm">{sources.intro}</p>
        <Suspense fallback={<BlockSkeleton label={t.loading} />}>
          <SourceHealthList locale={locale} />
        </Suspense>
      </section>

      <section aria-labelledby="how-heading" className="space-y-3">
        <h2 id="how-heading" className="text-lg font-semibold">
          {t.howTitle}
        </h2>
        <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
          {t.how.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}
