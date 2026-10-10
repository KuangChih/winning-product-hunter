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
  sources: ["aliexpress", "meta_ads"],
  markets: ["US", "DE"],
  isSample: true,
  breakdown: {
    saturation: { activeAdvertisers: 2 },
  } as RankedProduct["breakdown"],
  ...over,
});

describe("ProductTable", () => {
  it("shows rank, linked title, score, evidence sources and the sample-data label", () => {
    render(
      <ProductTable
        products={[product({}), product({ id: "2", slug: "real", title: "Real", isSample: false })]}
      />,
    );

    const rows = screen.getAllByRole("row").slice(1);
    const first = within(rows[0]);
    expect(first.getByRole("link", { name: "Paw Cleaner" })).toHaveAttribute(
      "href",
      "/products/paw-cleaner",
    );
    expect(first.getByText("73")).toBeInTheDocument();
    expect(first.getByText("Medium")).toBeInTheDocument();
    expect(first.getByText("Meta Ads (EU)")).toBeInTheDocument();
    expect(first.getByText("Sample data")).toBeInTheDocument();
    expect(first.getByTitle("United States")).toHaveTextContent("US");
    expect(first.getByTitle("Germany")).toHaveTextContent("DE");
    expect(within(rows[1]).queryByText("Sample data")).toBeNull();
  });
});
