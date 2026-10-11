import { render, screen, within } from "@testing-library/react";
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
  advertiserId: null,
  advertiserName: null,
  landingUrl: null,
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
    const rows = screen.getAllByRole("listitem").slice(0, 2);
    // Longest-running first, with a day badge and a status chip.
    expect(rows[0]).toHaveTextContent("Paw Store 2");
    expect(within(rows[0]).getByText("31 days")).toBeInTheDocument();
    expect(within(rows[0]).getByText("stopped")).toBeInTheDocument();
    expect(within(rows[1]).getByText("18 days")).toBeInTheDocument();
    expect(within(rows[1]).getByText("active")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View ad (opens in a new tab)" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
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

    expect(screen.getByText("Similar products in the Shopify catalog (4)")).toBeInTheDocument();
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

  it("shows the 5 longest-running ads first and the rest behind a show-all disclosure", () => {
    const ads = Array.from({ length: 7 }, (_, i) => ({
      ...base,
      id: `ad${i}`,
      advertiserName: `Store ${i}`,
      startedAt: new Date(NOW.getTime() - (i + 1) * 86_400_000),
    }));
    const { container } = render(<EvidenceList now={NOW} evidence={ads} />);
    const section = container.querySelector("details")!;
    expect(section).toHaveAttribute("open");
    expect(within(section.querySelector("summary")!).getByRole("heading")).toHaveTextContent(
      "Ads (7)",
    );
    const firstList = section.querySelector("ul")!;
    expect(
      within(firstList)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining("Store 6"),
      expect.stringContaining("Store 5"),
      expect.stringContaining("Store 4"),
      expect.stringContaining("Store 3"),
      expect.stringContaining("Store 2"),
    ]);
    const more = screen.getByText("Show all 7 ads").closest("details")!;
    expect(more).not.toHaveAttribute("open");
    expect(within(more).getAllByRole("listitem")).toHaveLength(2);
  });

  it("opens ads and advertiser stores, folds the rest, and links only to web URLs", () => {
    const { container } = render(
      <EvidenceList
        now={NOW}
        evidence={[
          {
            ...base,
            id: "a",
            url: "javascript:alert(1)",
            landingUrl: "https://www.shop.example/products/cup?x=1",
          },
          {
            ...base,
            id: "own",
            source: "shopify",
            provider: "shopify_catalog_lookup",
            kind: "store_product",
            title: "Cup",
            countries: ["US"],
            priceCents: 1999,
            currency: "USD",
          },
          {
            ...base,
            id: "sim",
            source: "shopify",
            provider: "shopify_catalog",
            kind: "store_product",
            title: "Other cup",
            countries: ["US"],
            priceCents: 999,
            currency: "USD",
          },
        ]}
      />,
    );
    const sections = [...container.querySelectorAll(":scope > div > details")];
    expect(
      sections.map((d) => [d.querySelector("h3")!.textContent, d.hasAttribute("open")]),
    ).toEqual([
      ["Ads (1)", true],
      ["Advertiser stores (1)", true],
      ["Similar products in the Shopify catalog (1)", false],
    ]);
    // A stored javascript: URL never becomes a link; the landing store's domain is shown.
    expect(screen.queryByRole("link", { name: /View ad/ })).toBeNull();
    expect(screen.getByText(/shop\.example/)).toBeInTheDocument();
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
    expect(screen.getByText("Meta Ad Library · US · 影片 · 2026-09-21 開始")).toBeInTheDocument();
    expect(screen.getByText("18 天")).toBeInTheDocument();
    expect(screen.getByText("投放中")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看廣告 （在新分頁開啟）" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Shopify 商品目錄中的同類商品（1）" }),
    ).toBeInTheDocument();
    expect(screen.getByText("英國")).toBeInTheDocument();
    expect(screen.getByText("售價中位數 19.99 GBP")).toBeInTheDocument();
    expect(screen.getByText("價格 4.50 USD · 90 天售出 1,300 件")).toBeInTheDocument();
  });

  it("shows CJ's own counts as platform counts", () => {
    render(
      <EvidenceList
        now={NOW}
        locale="zh-TW"
        evidence={[
          {
            ...base,
            id: "cj",
            source: "cj",
            provider: "cj_api",
            kind: "listing",
            priceCents: 389,
            currency: "USD",
            url: "https://cjdropshipping.com/product/x-p-1.html",
            metrics: { orders_total: 682, stores_listed: 9158 },
          },
        ]}
      />,
    );
    expect(screen.getByText("CJ（供應商銷量）")).toBeInTheDocument();
    expect(screen.getByText("價格 3.89 USD · CJ 訂單 682 筆 · 9,158 家店上架")).toBeInTheDocument();
    expect(screen.getByText(/CJ 平台計數：.*不代表整個市場/)).toBeInTheDocument();
  });
});
