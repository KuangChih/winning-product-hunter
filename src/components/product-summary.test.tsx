import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProductDetail } from "@/data/product-detail";
import type { AdFacts } from "@/lib/ad-facts";
import type { ScoreBreakdown } from "@/scoring/score";
import { KeyFacts, ProductSummary } from "./product-summary";

// The watch button posts to a Server Action; the component only needs a function for the form.
vi.mock("@/app/[lang]/watchlist/actions", () => ({ setWatched: vi.fn() }));

const product: ProductDetail = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "neck-fan",
  title: "Neck Fan",
  imageUrl: null,
  canonicalUrl: "https://shop.example/products/neck-fan",
  canonicalKind: "advertiser",
  firstSeenAt: new Date("2026-09-01T00:00:00Z"),
  score: {
    score: 72.4,
    confidence: 0.8,
    computedAt: new Date("2026-10-10T00:00:00Z"),
    breakdown: {} as ScoreBreakdown,
  },
  scoreHistory: [
    { score: 60, computedAt: new Date("2026-10-09T00:00:00Z") },
    { score: 72.4, computedAt: new Date("2026-10-10T00:00:00Z") },
  ],
  evidence: [],
  isSample: false,
  fxRates: null,
};

const facts: AdFacts = {
  totalAds: 12,
  activeAds: 9,
  activeAdvertisers: 3,
  longestRunDays: 64,
  landingDomains: ["shop.example"],
  primaryAd: { url: "https://www.facebook.com/ads/library/?id=1", days: 64 },
};

describe("ProductSummary", () => {
  it("shows the name, score, confidence, history, watch toggle and source links", () => {
    render(<ProductSummary product={product} facts={facts} watched={false} locale="en" />);
    expect(screen.getByRole("heading", { level: 1, name: "Neck Fan" })).toBeInTheDocument();
    expect(screen.getByText("First seen 2026-09-01")).toBeInTheDocument();
    expect(screen.getByText("72")).toHaveAttribute("data-level", "high");
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Winning Score history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "☆ Watch" })).toBeInTheDocument();

    const store = screen.getByRole("link", { name: /^Advertiser's product page/ });
    expect(store).toHaveAttribute("href", "https://shop.example/products/neck-fan");
    const ad = screen.getByRole("link", { name: /^Longest-running ad in Meta Ad Library/ });
    expect(ad).toHaveTextContent("running 64 days");
    for (const link of [store, ad]) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveTextContent("(opens in a new tab)");
    }
  });

  it("says when there is no score and leaves out links it does not have", () => {
    render(
      <ProductSummary
        product={{ ...product, score: null, scoreHistory: [], canonicalUrl: "javascript:x" }}
        facts={{ ...facts, primaryAd: null }}
        watched
        locale="zh-TW"
      />,
    );
    expect(screen.getByText("這個產品還沒有評分。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "★ 已收藏" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("calls a product found on CJ's page a CJ product page, not the advertiser's", () => {
    render(
      <ProductSummary
        product={{
          ...product,
          canonicalUrl: "https://cjdropshipping.com/product/neck-fan-p-1.html",
          canonicalKind: "cj",
        }}
        facts={{ ...facts, primaryAd: null }}
        watched={false}
        locale="zh-TW"
      />,
    );
    expect(screen.getByRole("link", { name: /^CJ 商品頁/ })).toHaveAttribute(
      "href",
      "https://cjdropshipping.com/product/neck-fan-p-1.html",
    );
    expect(screen.queryByRole("link", { name: /廣告主商品頁/ })).toBeNull();
  });
});

describe("KeyFacts", () => {
  it("lists the key numbers in Traditional Chinese", () => {
    render(<KeyFacts facts={facts} markets={["US", "GB"]} retailUsdCents={2999} locale="zh-TW" />);
    const value = (label: string) =>
      screen.getByText(label, { selector: "dt" }).nextElementSibling!.textContent;
    expect(screen.getByRole("heading", { name: "重點數字" })).toBeInTheDocument();
    expect(value("投放中的廣告")).toBe("9 則（共 12 則）");
    expect(value("投放中的廣告主")).toBe("3");
    expect(value("投放最久的廣告")).toBe("64 天");
    expect(value("廣告主售價（美國）")).toBe("$29.99");
    expect(value("廣告連到的網域")).toBe("shop.example");
    expect(value("市場")).toBe("USGB");
    // One domain: no warning.
    expect(screen.queryByText(/個不同網域/)).toBeNull();
  });

  it("shows a dash for missing data and warns when ads link to several domains", () => {
    render(
      <KeyFacts
        facts={{
          ...facts,
          totalAds: 0,
          activeAds: 0,
          activeAdvertisers: 0,
          longestRunDays: null,
          landingDomains: ["a.example", "b.example", "c.example"],
        }}
        markets={[]}
        retailUsdCents={null}
        locale="en"
      />,
    );
    const value = (label: string) =>
      screen.getByText(label, { selector: "dt" }).nextElementSibling!.textContent;
    expect(value("Active ads")).toBe("—");
    expect(value("Active advertisers")).toBe("—");
    expect(value("Longest-running ad")).toBe("—");
    expect(value("Advertiser's price (US)")).toBe("—");
    expect(value("Markets")).toBe("—");
    expect(value("Ad landing domains")).toBe("3");
    const warning = screen.getByRole("heading", {
      name: "Ads for this product link to 3 different domains",
    }).parentElement!;
    expect(
      within(warning)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["a.example", "b.example", "c.example"]);
  });
});
