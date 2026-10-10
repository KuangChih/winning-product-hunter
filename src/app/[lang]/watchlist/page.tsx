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
import { type Dictionary, getDictionary } from "@/i18n/dictionaries";
import { fill, RichText } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { getLocale } from "@/i18n/server";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLocale());
  return { title: `${t.watchlist.title} · ${t.site.name}` };
}

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

/** "moved {change} to {score}…" with the colored change element in place of `{change}`. */
function AlertText({
  template,
  change,
  score,
}: {
  template: string;
  change: React.ReactNode;
  score: string;
}) {
  const [before, after = ""] = fill(template, { score }).split("{change}");
  return (
    <>
      {before}
      {change}
      {after}
    </>
  );
}

function WatchTable({ items, dict }: { items: WatchedProduct[]; dict: Dictionary }) {
  const t = dict.watchlist;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="text-muted-foreground border-b text-left text-xs uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">{t.columns.product}</th>
            <th className="px-3 py-2 text-right font-medium">{t.columns.score}</th>
            <th className="px-3 py-2 text-right font-medium">{t.columns.lastUpdate}</th>
            <th className="px-3 py-2 text-right font-medium">{t.columns.sinceAdded}</th>
            <th className="px-3 py-2 font-medium">{t.columns.added}</th>
            <th className="px-3 py-2">
              <span className="sr-only">{t.columns.actions}</span>
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
                {w.score === null ? t.notScored : w.score.toFixed(0)}
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
                <WatchButton productId={w.productId} watched labels={dict.detail} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Watchlist({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const { watchlist: t, common } = dict;
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

  let items;
  try {
    items = await getWatchlist(await getDb());
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

  if (items.length === 0) {
    return (
      <Notice title={t.emptyTitle}>
        <p>
          {t.emptyBefore}{" "}
          <Link href="/products" className="underline underline-offset-4">
            {t.emptyLink}
          </Link>{" "}
          {t.emptyAfter}
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
            {t.alertsHeading}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {alerts.map((w) => (
              <li key={w.productId}>
                <Link href={`/products/${w.slug}`} className="underline underline-offset-4">
                  {w.title}
                </Link>{" "}
                <AlertText
                  template={t.alertMoved}
                  change={<Change value={scoreChange(w.score, w.previousScore)} />}
                  score={w.score!.toFixed(0)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      <WatchTable items={items} dict={dict} />
    </div>
  );
}

export default async function WatchlistPage() {
  const locale = await getLocale();
  const t = getDictionary(locale).watchlist;
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl">
        {fill(t.intro, { n: ALERT_THRESHOLD })}
      </p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground text-sm">{t.loading}</p>}>
          <Watchlist locale={locale} />
        </Suspense>
      </div>
    </main>
  );
}
