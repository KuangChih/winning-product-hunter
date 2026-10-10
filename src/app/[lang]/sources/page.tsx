import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { getSourceHealth, type HealthStatus } from "@/data/source-health";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { getDictionary } from "@/i18n/dictionaries";
import { fill, RichText } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { getLocale } from "@/i18n/server";
import { sourceLabel } from "@/lib/sources";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLocale());
  return { title: `${t.sources.title} · ${t.site.name}` };
}

const STATUS_CLASS: Record<HealthStatus, string> = {
  healthy: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  degraded: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  stale: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  failing: "bg-red-500/15 text-red-700 dark:text-red-400",
};

function formatTime(d: Date | null) {
  return d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—";
}

async function HealthTable({ locale }: { locale: Locale }) {
  const t = getDictionary(locale).sources;
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
  if (health.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        <RichText text={t.noRuns} />
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[48rem] text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">{t.columns.source}</th>
            <th className="px-3 py-2 font-medium">{t.columns.status}</th>
            <th className="px-3 py-2 font-medium">{t.columns.lastRun}</th>
            <th className="px-3 py-2 font-medium">{t.columns.items}</th>
            <th className="px-3 py-2 font-medium">{t.columns.lastSuccess}</th>
            <th className="px-3 py-2 font-medium">{t.columns.runs}</th>
          </tr>
        </thead>
        <tbody>
          {health.map((h) => (
            <tr key={`${h.source}|${h.provider}`} className="border-t align-top">
              <td className="px-3 py-3">
                <div className="font-medium">{sourceLabel(h.source, locale)}</div>
                <div className="text-muted-foreground text-xs">
                  {t.providers[h.provider] ?? h.provider}
                </div>
              </td>
              <td className="px-3 py-3">
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-xs font-medium",
                    STATUS_CLASS[h.status],
                  )}
                >
                  {t.status[h.status]}
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
                  <span className="text-muted-foreground">{fill(t.failed, { n: h.failures })}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function SourcesPage() {
  const locale = await getLocale();
  const { sources: t, common } = getDictionary(locale);
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl">{t.intro}</p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground text-sm">{common.loading}</p>}>
          <HealthTable locale={locale} />
        </Suspense>
      </div>
    </main>
  );
}
