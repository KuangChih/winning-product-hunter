import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdControls, AdList, adsHref } from "@/components/ad-browser";
import { getAds, parseAdParams } from "@/data/ads";
import { getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";

export const metadata: Metadata = {
  title: "Ads · Winning Product Hunter",
};

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
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const state = parseAdParams(await searchParams);
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

  const now = new Date();
  let page;
  try {
    page = await getAds(await getDb(), { ...state, now });
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

  const filtered = Boolean(state.q || state.market || state.platform || state.status);
  let content;
  if (page.ads.length > 0) {
    content = <AdList page={page} state={state} now={now} />;
  } else if (state.page > 1 && page.total > 0) {
    content = (
      <Notice title="No ads on this page">
        <p>
          <Link href={adsHref({ ...state, page: 1 })} className="underline underline-offset-4">
            Go to the first page
          </Link>
          .
        </p>
      </Notice>
    );
  } else if (filtered) {
    content = (
      <Notice title="No ads match these filters">
        <p>Try a broader search, another market or platform.</p>
      </Notice>
    );
  } else {
    content = (
      <Notice title="No ads collected yet">
        <p>
          Run <code>npm run pipeline</code> to collect ads from the Meta Ad Library
          {state.includeSample ? "" : ", or include sample data"}.
        </p>
      </Notice>
    );
  }

  return (
    <>
      <AdControls state={state} />
      {content}
      <p className="text-muted-foreground mt-4 text-sm">
        <Link
          href={adsHref({ ...state, page: 1, includeSample: !state.includeSample })}
          className="underline-offset-4 hover:underline"
        >
          {state.includeSample ? "Show real data only" : "Include sample data"}
        </Link>
      </p>
    </>
  );
}

export default function AdsPage({ searchParams }: PageProps<"/ads">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Ads</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl">
        Every ad we have collected, across platforms. Ads that keep running for weeks are usually
        profitable; open any ad to check it at the source.
      </p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground text-sm">Loading ads…</p>}>
          <AdResults searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
