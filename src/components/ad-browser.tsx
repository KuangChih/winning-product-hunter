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
import { externalHref, urlHost } from "@/lib/ad-facts";
import { MARKETS } from "@/lib/markets";
import { sourceLabel } from "@/lib/sources";
import { AdRunBadges } from "./ad-badges";
import { FilterChips, FilterDisclosure, type FilterChip } from "./filter-disclosure";
import { Pagination } from "./pagination";
import { fieldClass } from "./ui/field";

type BrowserState = AdFilters;

/** URL for the ad browser with the given state; defaults are left out to keep links short. */
export function adsHref(state: BrowserState) {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.market) params.set("market", state.market);
  if (state.platform) params.set("platform", state.platform);
  if (state.status) params.set("status", state.status);
  if (state.sort && state.sort !== "longest") params.set("sort", state.sort);
  if (state.page && state.page > 1) params.set("page", String(state.page));
  const qs = params.toString();
  return qs ? `/ads?${qs}` : "/ads";
}

/** Applied filters as removable chips (each link goes back to the first page). */
export function adFilterChips(state: BrowserState, locale: Locale): FilterChip[] {
  const { ads: t, ranking, common } = getDictionary(locale);
  const base = { ...state, page: 1 };
  const chip = (name: string, value: string, without: BrowserState): FilterChip => ({
    label: fill(common.chip, { name, value }),
    removeHref: adsHref(without),
  });
  const chips: FilterChip[] = [];
  if (state.q) chips.push(chip(t.search, state.q, { ...base, q: undefined }));
  if (state.market) {
    chips.push(
      chip(ranking.market, countryName(state.market, locale), { ...base, market: undefined }),
    );
  }
  if (state.platform) {
    chips.push(
      chip(t.platform, sourceLabel(state.platform, locale), { ...base, platform: undefined }),
    );
  }
  if (state.status) {
    chips.push(
      chip(t.status, state.status === "active" ? t.statusActive : t.statusStopped, {
        ...base,
        status: undefined,
      }),
    );
  }
  return chips;
}

/**
 * Search and filters as a plain GET form, so every view has a shareable URL. Search and sort
 * stay visible; market, platform and status fold away and show as chips once applied.
 */
export function AdControls({ state, locale }: { state: BrowserState; locale: Locale }) {
  const { ads: t, ranking, common } = getDictionary(locale);
  const folded = [state.market, state.platform, state.status].filter(Boolean).length;
  return (
    <div className="mb-6 space-y-3">
      <form
        method="get"
        action="/ads"
        role="search"
        aria-label={t.filterLabel}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs">
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
          <span className="text-muted-foreground">{ranking.sortBy}</span>
          <select name="sort" defaultValue={state.sort ?? "longest"} className={fieldClass}>
            {Object.entries(t.sorts).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium"
        >
          {ranking.apply}
        </button>
        <FilterDisclosure
          label={common.filters}
          activeLabel={common.filtersActive}
          activeCount={folded}
          applyLabel={ranking.apply}
        >
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
        </FilterDisclosure>
      </form>
      <FilterChips
        chips={adFilterChips(state, locale)}
        clearHref={adsHref({ sort: state.sort })}
        labels={common}
      />
    </div>
  );
}

/** Source label; the public Ad Library website covers all countries, the API only the EU/UK. */
function platformLabel(ad: AdListItem, e: Dictionary["evidence"], locale: Locale) {
  if (ad.source !== "meta_ads") return sourceLabel(ad.source, locale);
  return ad.provider === "ad_library_web" ? e.metaWeb : e.metaApi;
}

export function AdCard({ ad, now, locale }: { ad: AdListItem; now: Date; locale: Locale }) {
  const { ads: t, evidence: e, detail } = getDictionary(locale);
  const href = externalHref(ad.url);
  const meta = [
    platformLabel(ad, e, locale),
    ad.countries.length ? ad.countries.join(", ") : null,
    ad.format ? (e.formats[ad.format] ?? ad.format) : null,
    ad.startedAt ? fill(e.started, { date: ad.startedAt.toISOString().slice(0, 10) }) : null,
    urlHost(ad.landingUrl),
  ];
  return (
    <article className="flex h-full flex-col gap-2 rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="min-w-0 font-medium break-words">
          {ad.advertiserName ?? e.unknownAdvertiser}
        </h2>
        <AdRunBadges ad={ad} now={now} labels={e} />
      </div>
      {ad.title && <p className="line-clamp-3 text-sm break-words">{ad.title}</p>}
      <p className="text-muted-foreground text-xs break-words">
        {meta.filter(Boolean).join(" · ")}
      </p>
      {(href || ad.product) && (
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-sm">
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-4"
            >
              {e.viewAd} <span className="sr-only">{detail.newTab}</span>
            </a>
          )}
          {ad.product && (
            <Link
              href={`/products/${ad.product.slug}`}
              className="text-muted-foreground min-w-0 break-words underline-offset-4 hover:underline"
            >
              {fill(t.productLink, { title: ad.product.title })}
            </Link>
          )}
        </div>
      )}
    </article>
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
      <ul className="grid gap-3 md:grid-cols-2">
        {page.ads.map((ad) => (
          <li key={ad.id}>
            <AdCard ad={ad} now={now} locale={locale} />
          </li>
        ))}
      </ul>
      <Pagination
        page={page.page}
        pageCount={page.pageCount}
        hrefFor={(n) => adsHref({ ...state, page: n })}
        labels={t}
      />
    </div>
  );
}
