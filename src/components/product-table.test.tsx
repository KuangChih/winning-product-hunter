import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RankedProduct } from "@/data/products";
import { ProductTable } from "./product-table";

const product = (over: Partial<RankedProduct>): RankedProduct => ({
  id: "1",
  slug: "paw-cleaner",
  title: "Paw Cleaner",
  category: null,
  imageUrl: null,
  score: 73.4,
  confidence: 0.7,
  computedAt: new Date(),
  sources: ["cj", "meta_ads"],
  markets: ["US", "DE"],
  isSample: true,
  retailUsdCents: 2499,
  breakdown: {
    saturation: { activeAdvertisers: 2 },
    subScores: {
      longevity: { value: 0.83, weight: 0.15, raw: null, basis: "" },
      margin: { value: null, weight: 0.15, raw: null, basis: "" },
    },
  } as unknown as RankedProduct["breakdown"],
  ...over,
});

describe("ProductTable", () => {
  it("shows rank, linked title, score, evidence sources and the sample-data label", () => {
    render(
      <ProductTable
        products={[product({}), product({ id: "2", slug: "real", title: "Real", isSample: false })]}
        locale="en"
      />,
    );

    const rows = screen.getAllByRole("row").slice(1);
    const first = within(rows[0]);
    expect(first.getByRole("link", { name: "Paw Cleaner" })).toHaveAttribute(
      "href",
      "/products/paw-cleaner",
    );
    expect(first.getByText("73")).toBeInTheDocument();
    expect(first.getByText("$24.99")).toBeInTheDocument();
    expect(first.getByText("Medium")).toBeInTheDocument();
    expect(first.getByText("Meta Ads")).toBeInTheDocument();
    expect(first.getByText("Sample data")).toBeInTheDocument();
    expect(first.getByTitle("United States")).toHaveTextContent("US");
    expect(first.getByTitle("Germany")).toHaveTextContent("DE");
    expect(within(rows[1]).queryByText("Sample data")).toBeNull();
  });

  it("translates headers, confidence, badge and country names", () => {
    render(<ProductTable products={[product({})]} locale="zh-TW" />);
    expect(screen.getByRole("columnheader", { name: "可信度" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "售價（美國）" })).toBeInTheDocument();
    const row = within(screen.getAllByRole("row")[1]);
    expect(row.getByText("中")).toBeInTheDocument();
    expect(row.getByText("樣本資料")).toBeInTheDocument();
    expect(row.getByTitle("美國")).toHaveTextContent("US");
    expect(row.getByTitle("德國")).toHaveTextContent("DE");
  });

  it("shows every sub-score, a dash when there is no data, and sortable headers", () => {
    render(
      <ProductTable
        products={[product({})]}
        locale="en"
        filters={{ market: "US", sort: "longevity" }}
        includeSample={false}
      />,
    );
    const header = screen.getByRole("columnheader", { name: /Longevity/ });
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(within(header).getByRole("link")).toHaveAttribute(
      "href",
      "/products?market=US&sort=longevity",
    );
    expect(
      within(screen.getByRole("columnheader", { name: /Margin/ })).getByRole("link"),
    ).toHaveAttribute("href", "/products?market=US&sort=margin");

    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    // #, product, score, then the seven signals in order.
    expect(cells.slice(3, 10).map((c) => c.textContent)).toEqual([
      "83",
      "—",
      "—",
      "—",
      "—",
      "—",
      "—",
    ]);
  });
});
