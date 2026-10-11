import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n/dictionaries";
import { MarginEstimate } from "./margin-estimate";

const en = getDictionary("en").margin;
const zh = getDictionary("zh-TW").margin;

describe("MarginEstimate", () => {
  it("shows retail, supplier cost and gross margin", () => {
    render(
      <MarginEstimate
        t={en}
        estimate={{
          retailUsdCents: 2500,
          retailBasis: "own_listing",
          retailOffers: 3,
          supplierUsdCents: 600,
          supplierListings: 2,
          grossProfitUsdCents: 1900,
          grossMargin: 0.76,
          missing: [],
        }}
      />,
    );
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText("$6.00")).toBeInTheDocument();
    expect(screen.getByText("76%")).toBeInTheDocument();
    expect(screen.getByText("$19.00 per unit")).toBeInTheDocument();
    expect(screen.getByText("Median of 3 advertiser stores")).toBeInTheDocument();
    expect(screen.getByText(/Before shipping/)).toBeInTheDocument();
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
          grossProfitUsdCents: null,
          grossMargin: null,
          missing: ["retail", "supplier"],
        }}
      />,
    );
    expect(screen.getByText("毛利率")).toBeInTheDocument();
    expect(
      screen.getByText(
        "資料還不夠算毛利：需要廣告主自己商店的售價，或賣同款（照片相同）商品的店家售價（Shopify Global Catalog）與供應商報價（CJ Dropshipping）。",
      ),
    ).toBeInTheDocument();
  });
});
