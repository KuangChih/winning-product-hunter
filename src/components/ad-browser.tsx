import Link from "next/link";
import {
  AD_PAGE_SIZE,
  AD_PLATFORMS,
  type AdFilters,
  type AdListItem,
  type AdPage,
} from "@/data/ads";
import { type Dictionary, getDictionary } from "@/i18n/dictionaries";
import { countryName, fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { MARKETS } from "@/lib/markets";
import { sourceLabel } from "@/lib/sources";

const DAY = 86_400_000;

const fieldClass =
  "border-input bg-background h-9 rounded-md border px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1";

type BrowserState = AdFilters & { includeSample: boolean };

/** URL for the ad browser with the given state; defaults are left out to keep links short. */
export function adsHref(state: BrowserState) {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.market) params.set("market", state.market);
  if (state.platform) params.set("platform", state.platform);
  if (state.status) params.set("status", state.status);
  if (state.sort && state.sort !== "longest") params.set("sort", state.sort);
  if (state.page && state.page > 1) params.set("page", String(state.page));
  if (state.includeSample) params.set("sample", "1");
  const qs = params.toString();
  return qs ? `/ads?${qs}` : "/ads";
}

/** Search and filters as a plain GET form, so every view has a shareable URL. */
export function AdControls({ state, locale }: { state: BrowserState; locale: Locale }) {
  const { ads: t, ranking } = getDictionary(locale);
  return (
    <form
      method="get"
      action="/ads"
      role="search"
      aria-label={t.filterLabel}
      className="mb-6 flex flex-wrap items-end gap-3"
    >
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{t.search}</span>
        <input
          type="search"
          name="q"
          defaultValue={state.q ?? ""}
          placeholder={t.searchPlaceholder}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{ranking.market}</span>
        <select name="market" defaultValue={state.market ?? ""} className={fieldClass}>
          <option value="">{ranking.allMarkets}</option>
          {MARKETS.map((m) => (
            <option key={m.code} value={m.code}>
              {countryName(m.code, locale)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{t.platform}</span>
        <select name="platform" defaultValue={state.platform ?? ""} className={fieldClass}>
          <option value="">{t.allPlatforms}</option>
          {AD_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {sourceLabel(p, locale)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{t.status}</span>
        <select name="status" defaultValue={state.status ?? ""} className={fieldClass}>
          <option value="">{ranking.any}</option>
          <option value="active">{t.statusActive}</option>
          <option value="stopped">{t.statusStopped}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{ranking.sortBy}</span>
        <select name="sort" defaultValue={state.sort ?? "longest"} className={fieldClass}>
          {Object.entries(t.sorts).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {state.includeSample && <input type="hidden" name="sample" value="1" />}
      <button
        type="submit"
        className="bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium"
      >
        {ranking.apply}
      </button>
      <Link
        href={state.includeSample ? "/ads?sample=1" : "/ads"}
        className="text-muted-foreground h-9 content-center text-sm underline-offset-4 hover:underline"
      >
        {ranking.reset}
      </Link>
    </form>
  );
}

/** Source label; the public Ad Library website covers all countries, the API only the EU/UK. */
function platformLabel(ad: AdListItem, e: Dictionary["evidence"], locale: Locale) {
  if (ad.source !== "meta_ads") return sourceLabel(ad.source, locale);
  return ad.provider === "ad_library_web" ? e.metaWeb : e.metaApi;
}

function AdCard({ ad, now, locale }: { ad: AdListItem; now: Date; locale: Locale }) {
  const { ads: t, evidence: e } = getDictionary(locale);
  const active = !ad.endedAt || ad.endedAt > now;
  const end = active ? now : ad.endedAt!;
  const days = ad.startedAt ? Math.round((end.getTime() - ad.startedAt.getTime()) / DAY) : null;
  return (
    <li className="flex flex-col gap-2 border-t py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">{ad.advertiserName ?? e.unknownAdvertiser}</span>
          {ad.provider === "fixture" && (
            <span className="rounded border px-1.5 text-[10px] uppercase">{t.sample}</span>
          )}
        </div>
        {ad.title && <p className="line-clamp-2 text-sm">{ad.title}</p>}
        <div className="text-muted-foreground text-xs">
          {[
            platformLabel(ad, e, locale),
            ad.countries.length ? ad.countries.join(", ") : null,
            ad.format ? (e.formats[ad.format] ?? ad.format) : null,
            ad.startedAt
              ? fill(e.started, { date: ad.startedAt.toISOString().slice(0, 10) })
              : null,
            days !== null ? fill(e.days, { n: days }) : null,
            active ? e.active : e.stopped,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm sm:flex-col sm:items-end">
        {ad.url && (
          <a
            href={ad.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            {e.viewAd}
          </a>
        )}
        {ad.product && (
          <Link
            href={`/products/${ad.product.slug}`}
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            {fill(t.productLink, { title: ad.product.title })}
          </Link>
        )}
      </div>
    </li>
  );
}

export function AdList({
  page,
  state,
  now,
  locale,
}: {
  page: AdPage;
  state: BrowserState;
  now: Date;
  locale: Locale;
}) {
  const t = getDictionary(locale).ads;
  const from = (page.page - 1) * AD_PAGE_SIZE + 1;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {fill(t.total, { n: page.total.toLocaleString("en-US") })}
        {page.ads.length > 0 && fill(t.showing, { from, to: from + page.ads.length - 1 })}
      </p>
      <ul className="rounded-lg border px-4">
        {page.ads.map((ad) => (
          <AdCard key={ad.id} ad={ad} now={now} locale={locale} />
        ))}
      </ul>
      {page.pageCount > 1 && (
        <nav aria-label={t.pagination} className="flex items-center justify-between text-sm">
          {page.page > 1 ? (
            <Link href={adsHref({ ...state, page: page.page - 1 })} className="underline">
              {t.previous}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            {fill(t.pageOf, { page: page.page, count: page.pageCount })}
          </span>
          {page.page < page.pageCount ? (
            <Link href={adsHref({ ...state, page: page.page + 1 })} className="underline">
              {t.next}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
