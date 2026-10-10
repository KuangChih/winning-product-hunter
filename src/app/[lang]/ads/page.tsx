import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdControls, AdList, adsHref } from "@/components/ad-browser";
import { Notice } from "@/components/notice";
import { ListSkeleton } from "@/components/skeleton";
import { StartDiscoveryCard } from "@/components/start-discovery-card";
import { getAds, parseAdParams } from "@/data/ads";
import { getPipelineStatus } from "@/data/pipeline-status";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locales";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLocale());
  return { title: `${t.ads.title} · ${t.site.name}` };
}

async function AdResults({
  searchParams,
  locale,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  locale: Locale;
}) {
  const { ads: t, common, discover } = getDictionary(locale);
  const state = parseAdParams(await searchParams);
  await connection();
  if (!isDatabaseConfigured()) {
    return (
      <Notice title={common.noDatabaseTitle}>
        <p>{common.noDatabaseBody}</p>
      </Notice>
    );
  }

  const now = new Date();
  const db = await getDb();
  let page;
  try {
    page = await getAds(db, { ...state, now });
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return (
      <Notice title={common.notSetUpTitle}>
        <p>{common.notSetUpBody}</p>
      </Notice>
    );
  }

  const filtered = Boolean(state.q || state.market || state.platform || state.status);
  let content;
  if (page.ads.length > 0) {
    content = <AdList page={page} state={state} now={now} locale={locale} />;
  } else if (state.page > 1 && page.total > 0) {
    content = (
      <Notice title={t.emptyPageTitle}>
        <p>
          <Link href={adsHref({ ...state, page: 1 })} className="underline underline-offset-4">
            {t.firstPage}
          </Link>
        </p>
      </Notice>
    );
  } else if (filtered) {
    content = (
      <Notice title={t.noMatchTitle}>
        <p>{t.noMatchBody}</p>
      </Notice>
    );
  } else {
    content = (
      <StartDiscoveryCard
        title={t.noneTitle}
        body={t.noneBody}
        status={await getPipelineStatus(process.env, db)}
        labels={discover}
      />
    );
  }

  return (
    <>
      <AdControls state={state} locale={locale} />
      {content}
    </>
  );
}

export default async function AdsPage({ searchParams }: PageProps<"/[lang]/ads">) {
  const locale = await getLocale();
  const t = getDictionary(locale).ads;
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.title}</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl text-sm sm:text-base">{t.intro}</p>
      <div className="mt-6 sm:mt-8">
        <Suspense fallback={<ListSkeleton label={t.loading} />}>
          <AdResults searchParams={searchParams} locale={locale} />
        </Suspense>
      </div>
    </main>
  );
}
