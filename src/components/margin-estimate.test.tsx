import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n/dictionaries";
import { MarginEstimate } from "./margin-estimate";

const en = getDictionary("en").margin;
const zh = getDictionary("zh-TW").margin;

describe("MarginEstimate", () => {
  it("shows retail, the CJ variant, shipping and the landed margin", () => {
    render(
      <MarginEstimate
        t={en}
        estimate={{
          retailUsdCents: 2500,
          retailBasis: "own_listing",
          retailOffers: 3,
          supplierUsdCents: 486,
          supplierListings: 1,
          landed: {
            country: "US",
            variantKey: "Blue-60cm",
            variantPriceCents: 486,
            variantBasis: "store_options",
            matchedVariants: 10,
            totalVariants: 22,
            carrier: "YunExpress Ordinary",
            freightCents: 714,
            minDays: 4,
            maxDays: 7,
            maxDaysAllowed: 15,
            quotedAt: new Date("2026-10-11T08:00:00Z"),
          },
          shippingUsdCents: 714,
          grossProfitUsdCents: 1300,
          grossMargin: 0.52,
          missing: [],
        }}
      />,
    );
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText("$4.86")).toBeInTheDocument();
    expect(screen.getByText("$7.14")).toBeInTheDocument();
    expect(screen.getByText("52%")).toBeInTheDocument();
    expect(screen.getByText("$13.00 per unit")).toBeInTheDocument();
    expect(
      screen.getByText(
        "CJ variant “Blue-60cm”: most expensive of the 10 variants the same-photo stores offer (of 22)",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("YunExpress Ordinary, 4–7 days (CJ quote 2026-10-11)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Landed margin")).toBeInTheDocument();
    expect(screen.getByText(/before ad spend/)).toBeInTheDocument();
  });

  it("says when no CJ shipping option arrives in time, and gives no margin", () => {
    render(
      <MarginEstimate
        t={zh}
        estimate={{
          retailUsdCents: 2500,
          retailBasis: "same_photo",
          retailOffers: 1,
          supplierUsdCents: 1013,
          supplierListings: 1,
          landed: {
            country: "US",
            variantKey: "Set12-USB",
            variantPriceCents: 1013,
            variantBasis: "max_variant",
            matchedVariants: 18,
            totalVariants: 18,
            carrier: null,
            freightCents: null,
            minDays: null,
            maxDays: null,
            maxDaysAllowed: 15,
            quotedAt: new Date("2026-10-11T08:00:00Z"),
          },
          shippingUsdCents: null,
          grossProfitUsdCents: null,
          grossMargin: null,
          missing: ["shipping"],
        }}
      />,
    );
    expect(
      screen.getByText("CJ 規格「Set12-USB」：不確定店家賣哪個規格：18 個規格中最貴的"),
    ).toBeInTheDocument();
    expect(screen.getByText("CJ 沒有 15 天內送達的物流")).toBeInTheDocument();
    expect(
      screen.getByText("資料還不夠算毛利：需要CJ 寄到美國、15 天內送達的運費報價。"),
    ).toBeInTheDocument();
  });

  it("says what is missing when the estimate is incomplete", () => {
    render(
      <MarginEstimate
        t={en}
        estimate={{
          retailUsdCents: 2500,
          retailBasis: "own_listing",
          retailOffers: 1,
          supplierUsdCents: null,
          supplierListings: 0,
          landed: null,
          shippingUsdCents: null,
          grossProfitUsdCents: null,
          grossMargin: null,
          missing: ["supplier"],
        }}
      />,
    );
    expect(screen.getByText("From the advertiser's own store")).toBeInTheDocument();
    expect(
      screen.getByText(/needs a supplier cost \(CJ Dropshipping listing\)/),
    ).toBeInTheDocument();
  });

  it("labels a price taken from stores selling the same photo", () => {
    render(
      <MarginEstimate
        t={zh}
        estimate={{
          retailUsdCents: 2500,
          retailBasis: "same_photo",
          retailOffers: 4,
          supplierUsdCents: 500,
          supplierListings: 1,
          landed: null,
          shippingUsdCents: null,
          grossProfitUsdCents: 2000,
          grossMargin: 0.8,
          missing: [],
        }}
      />,
    );
    expect(screen.getByText("同款商品售價（美國）")).toBeInTheDocument();
    expect(screen.getByText("4 家賣同款（照片相同）商品的店家中位數")).toBeInTheDocument();
  });

  it("words everything in Traditional Chinese, joining missing inputs naturally", () => {
    render(
      <MarginEstimate
        t={zh}
        estimate={{
          retailUsdCents: null,
          retailBasis: null,
          retailOffers: 0,
          supplierUsdCents: null,
          supplierListings: 0,
          landed: null,
          shippingUsdCents: null,
          grossProfitUsdCents: null,
          grossMargin: null,
          missing: ["retail", "supplier", "shipping"],
        }}
      />,
    );
    expect(screen.getByText("到岸毛利率")).toBeInTheDocument();
    expect(
      screen.getByText(
        "資料還不夠算毛利：需要廣告主自己商店的售價，或賣同款（照片相同）商品的店家售價（Shopify Global Catalog）、供應商報價（CJ Dropshipping）與CJ 寄到美國、15 天內送達的運費報價。",
      ),
    ).toBeInTheDocument();
  });
});
