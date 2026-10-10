import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdControls, AdList, adsHref } from "@/components/ad-browser";
import { getAds, parseAdParams } from "@/data/ads";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import { getDictionary } from "@/i18n/dictionaries";
import { RichText } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLocale());
  return { title: `${t.ads.title} · ${t.site.name}` };
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 rounded-lg border p-6">
      <h2 className="font-semibold">{title}</h2>
      <div className="text-muted-foreground mt-2 space-y-2 text-sm">{children}</div>
    </div>
  );
}

async function AdResults({
  searchParams,
  locale,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  locale: Locale;
}) {
  const { ads: t, common, ranking } = getDictionary(locale);
  const state = parseAdParams(await searchParams);
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

  const now = new Date();
  let page;
  try {
    page = await getAds(await getDb(), { ...state, now });
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
      <Notice title={t.noneTitle}>
        <p>
          <RichText text={t.noneBody} />
        </p>
      </Notice>
    );
  }

  return (
    <>
      <AdControls state={state} locale={locale} />
      {content}
      <p className="text-muted-foreground mt-4 text-sm">
        <Link
          href={adsHref({ ...state, page: 1, includeSample: !state.includeSample })}
          className="underline-offset-4 hover:underline"
        >
          {state.includeSample ? ranking.showRealOnly : ranking.includeSample}
        </Link>
      </p>
    </>
  );
}

export default async function AdsPage({ searchParams }: PageProps<"/[lang]/ads">) {
  const locale = await getLocale();
  const t = getDictionary(locale).ads;
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl">{t.intro}</p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground text-sm">{t.loading}</p>}>
          <AdResults searchParams={searchParams} locale={locale} />
        </Suspense>
      </div>
    </main>
  );
}
