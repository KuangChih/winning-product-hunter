import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EvidenceItem } from "@/data/product-detail";
import { EvidenceList } from "./evidence-list";

const NOW = new Date("2026-10-09T00:00:00Z");
const base: EvidenceItem = {
  id: "x",
  source: "meta_ads",
  provider: "fixture",
  kind: "ad",
  title: null,
  url: null,
  region: null,
  countries: [],
  advertiserName: null,
  format: null,
  startedAt: null,
  endedAt: null,
  priceCents: null,
  currency: null,
  metrics: {},
  series: {},
};

describe("EvidenceList", () => {
  it("shows ad running days and status, the trend sparkline and supplier price", () => {
    render(
      <EvidenceList
        now={NOW}
        evidence={[
          {
            ...base,
            id: "a",
            advertiserName: "Paw Store 1",
            format: "video",
            startedAt: new Date("2026-09-21T00:00:00Z"),
            url: "https://www.facebook.com/ads/archive/render_ad/?id=1",
          },
          {
            ...base,
            id: "b",
            advertiserName: "Paw Store 2",
            startedAt: new Date("2026-08-01T00:00:00Z"),
            endedAt: new Date("2026-09-01T00:00:00Z"),
          },
          {
            ...base,
            id: "t",
            source: "google_trends",
            kind: "trend",
            title: "cleaner cup",
            region: "US",
            series: {
              search_interest: [
                { observedAt: new Date("2026-09-01"), value: 10 },
                { observedAt: new Date("2026-09-08"), value: 30 },
              ],
            },
          },
          {
            ...base,
            id: "l",
            source: "cj",
            kind: "listing",
            priceCents: 380,
            currency: "USD",
            metrics: { units_sold_90d: 1300, stores_listed: 80 },
          },
        ]}
      />,
    );

    expect(screen.getByText("Ads (2)")).toBeInTheDocument();
    expect(screen.getByText(/18 days · active/)).toBeInTheDocument();
    expect(screen.getByText(/31 days · stopped/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View ad" })).toHaveAttribute("target", "_blank");
    expect(
      screen.getByRole("img", { name: "Search interest for cleaner cup" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Price 3\.80 USD · 1,300 sold in 90 days · listed by 80 stores/),
    ).toBeInTheDocument();
  });

  it("groups store offers by country with a same-currency median price and catalog supply", () => {
    const offer = (id: string, country: string, cents: number, currency: string) => ({
      ...base,
      id,
      source: "shopify",
      kind: "store_product",
      title: `Offer ${id}`,
      countries: [country],
      advertiserName: `Store ${id}`,
      priceCents: cents,
      currency,
      url: `https://store-${id}.example/p`,
      metrics: { rating: 4.5, rating_count: 12 },
    });
    render(
      <EvidenceList
        now={NOW}
        evidence={[
          offer("a", "GB", 1600, "GBP"),
          offer("b", "GB", 3000, "GBP"),
          offer("c", "GB", 4499, "USD"),
          offer("d", "US", 1999, "USD"),
          {
            ...base,
            id: "s",
            source: "shopify",
            kind: "trend",
            title: "paw cleaner",
            countries: ["GB"],
            metrics: { catalog_results: 398 },
          },
        ]}
      />,
    );

    expect(screen.getByText("Stores selling it (4)")).toBeInTheDocument();
    // US is listed before GB (market priority); without FX rates the GB median ignores USD.
    const headings = screen.getAllByText(/United States|United Kingdom/).map((e) => e.textContent);
    expect(headings).toEqual(["United States", "United Kingdom"]);
    expect(
      screen.getByText(/Median price 23\.00 GBP · ~398 matching products in Shopify catalog/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Store a · 16\.00 GBP · ★ 4\.5 \(12\)/)).toBeInTheDocument();
    // Catalog supply items are not shown as search-demand trends.
    expect(screen.queryByText("Search demand")).toBeNull();
  });

  it("labels public Ad Library ads with their country, variants and the active-ad count", () => {
    render(
      <EvidenceList
        now={NOW}
        evidence={[
          {
            ...base,
            id: "w",
            provider: "ad_library_web",
            advertiserName: "Axzenia",
            countries: ["US"],
            format: "video",
            startedAt: new Date("2024-10-31T00:00:00Z"),
            metrics: { creative_variants: 2 },
          },
          {
            ...base,
            id: "c",
            kind: "trend",
            provider: "ad_library_web",
            countries: ["US"],
            metrics: { active_ads: 1700 },
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        /Meta Ad Library · US · video · 2 ads use this creative · started 2024-10-31/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Active ads for this search in Meta Ad Library: US ~1,700/),
    ).toBeInTheDocument();
  });

  it("says when there is no evidence", () => {
    render(<EvidenceList now={NOW} evidence={[]} />);
    expect(screen.getByText("No evidence collected yet.")).toBeInTheDocument();
  });

  it("renders ads, stores and supplier listings in Traditional Chinese", () => {
    render(
      <EvidenceList
        now={NOW}
        locale="zh-TW"
        evidence={[
          {
            ...base,
            id: "a",
            provider: "ad_library_web",
            advertiserName: "Paw Store",
            countries: ["US"],
            format: "video",
            startedAt: new Date("2026-09-21T00:00:00Z"),
            url: "https://www.facebook.com/ads/library/?id=1",
          },
          {
            ...base,
            id: "s",
            source: "shopify",
            kind: "store_product",
            title: "Paw Cleaner Cup",
            countries: ["GB"],
            priceCents: 1999,
            currency: "GBP",
          },
          {
            ...base,
            id: "l",
            source: "cj",
            kind: "listing",
            priceCents: 450,
            currency: "USD",
            metrics: { units_sold_90d: 1300 },
          },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "廣告（1）" })).toBeInTheDocument();
    expect(
      screen.getByText("Meta Ad Library · US · 影片 · 2026-09-21 開始 · 18 天 · 投放中"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看廣告" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "販售的店家（1）" })).toBeInTheDocument();
    expect(screen.getByText("英國")).toBeInTheDocument();
    expect(screen.getByText("售價中位數 19.99 GBP")).toBeInTheDocument();
    expect(screen.getByText("價格 4.50 USD · 90 天售出 1,300 件")).toBeInTheDocument();
  });
});
