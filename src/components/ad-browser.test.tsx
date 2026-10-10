import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AdListItem } from "@/data/ads";
import { AdControls, AdList, adsHref } from "./ad-browser";

const hidden = { hidden: true };

const NOW = new Date("2026-10-10T00:00:00Z");
const ad: AdListItem = {
  id: "1",
  source: "meta_ads",
  provider: "ad_library_web",
  title: "Smart ear cleaner",
  url: "https://www.facebook.com/ads/library/?id=1",
  imageUrl: null,
  advertiserName: "Amblora",
  countries: ["AU"],
  format: "video",
  startedAt: new Date("2026-08-17T00:00:00Z"),
  endedAt: null,
  lastSeenAt: NOW,
  product: { slug: "ear-cleaner", title: "Ear Cleaner" },
};
const state = { sort: "longest" as const, page: 1 };

describe("ad browser", () => {
  it("builds short shareable URLs", () => {
    expect(adsHref(state)).toBe("/ads");
    expect(adsHref({ ...state, market: "US", sort: "newest", page: 2 })).toBe(
      "/ads?market=US&sort=newest&page=2",
    );
  });

  it("folds market, platform and status away and shows them as removable chips", () => {
    render(
      <AdControls
        state={{ ...state, q: "ear", market: "US", status: "active", page: 3 }}
        locale="en"
      />,
    );
    expect(screen.getByText("Filters (2)")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Market", ...hidden })).toHaveValue("US");
    // Removing a filter goes back to the first page.
    expect(
      screen.getByRole("link", { name: "Remove filter: Market: United States" }),
    ).toHaveAttribute("href", "/ads?q=ear&status=active");
    expect(screen.getByRole("link", { name: "Remove filter: Status: Active" })).toHaveAttribute(
      "href",
      "/ads?q=ear&market=US",
    );
    expect(screen.getByRole("link", { name: "Clear all" })).toHaveAttribute("href", "/ads");
  });

  it("renders filters and ad cards in English", () => {
    render(<AdControls state={state} locale="en" />);
    render(
      <AdList
        page={{ ads: [ad], total: 1, page: 1, pageCount: 1 }}
        state={state}
        now={NOW}
        locale="en"
      />,
    );
    expect(screen.getByRole("search", { name: "Filter ads" })).toBeInTheDocument();
    expect(screen.getByText("1 ads · showing 1–1")).toBeInTheDocument();
    expect(
      screen.getByText("Meta Ad Library · AU · video · started 2026-08-17 · 54 days · active"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Product: Ear Cleaner" })).toHaveAttribute(
      "href",
      "/products/ear-cleaner",
    );
  });

  it("renders filters, ad cards and pagination in Traditional Chinese", () => {
    render(<AdControls state={state} locale="zh-TW" />);
    render(
      <AdList
        page={{ ads: [ad], total: 120, page: 2, pageCount: 3 }}
        state={state}
        now={NOW}
        locale="zh-TW"
      />,
    );
    expect(screen.getByRole("search", { name: "篩選廣告" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "平台", ...hidden })).toHaveTextContent("所有平台");
    expect(screen.getByRole("option", { name: "投放最久" })).toBeInTheDocument();
    expect(screen.getByText("120 則廣告 · 顯示第 51–51 則")).toBeInTheDocument();
    expect(
      screen.getByText("Meta Ad Library · AU · 影片 · 2026-08-17 開始 · 54 天 · 投放中"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "產品：Ear Cleaner" })).toBeInTheDocument();
    expect(screen.getByText("第 2 頁，共 3 頁")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 上一頁" })).toHaveAttribute("href", "/ads");
  });
});
