import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RankedProduct } from "@/data/products";
import { ProductCard, ProductList, ProductTable } from "./product-table";

// The star posts to a Server Action; the component only needs a function to put in the form.
vi.mock("@/app/[lang]/watchlist/actions", () => ({ setWatched: vi.fn() }));

const NOW = new Date("2026-10-11T00:00:00Z");

const product = (over: Partial<RankedProduct>): RankedProduct => ({
  id: "1",
  slug: "paw-cleaner",
  title: "Paw Cleaner",
  category: null,
  imageUrl: null,
  firstSeenAt: new Date("2026-10-08T00:00:00Z"),
  score: 73.4,
  confidence: 0.7,
  computedAt: NOW,
  sources: ["cj", "meta_ads"],
  markets: ["US", "DE"],
  isSample: false,
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
  it("shows photo, linked title, first seen, score with confidence, price and markets", () => {
    render(
      <ProductTable
        products={[
          product({}),
          product({ id: "2", slug: "real", title: "Real", imageUrl: "https://cdn.example/p.jpg" }),
        ]}
        locale="en"
        now={NOW}
      />,
    );

    const rows = screen.getAllByRole("row").slice(1);
    const first = within(rows[0]);
    expect(first.getByRole("link", { name: "Paw Cleaner" })).toHaveAttribute(
      "href",
      "/products/paw-cleaner",
    );
    expect(first.getByText("First seen 3 days ago")).toBeInTheDocument();
    expect(first.getByText("73")).toHaveAttribute("data-level", "high");
    expect(first.getByText("Medium confidence")).toBeInTheDocument();
    expect(first.getByText("$24.99")).toBeInTheDocument();
    expect(first.getByTitle("United States")).toHaveTextContent("US");
    expect(first.getByTitle("Germany")).toHaveTextContent("DE");
    // Sample data is never shown, so there is no sample badge any more.
    expect(screen.queryByText("Sample data")).toBeNull();
    // A real photo loads lazily; without one there is a placeholder instead of a broken image.
    expect(rows[0].querySelector("img")).toBeNull();
    const img = rows[1].querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://cdn.example/p.jpg");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("keeps the columns in order: product, score, seven signals, price, markets, advertisers", () => {
    render(<ProductTable products={[product({})]} locale="en" now={NOW} />);
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells).toHaveLength(12);
    expect(cells[2]).toHaveTextContent("83");
    expect(cells.slice(3, 9).map((c) => c.textContent)).toEqual(["—", "—", "—", "—", "—", "—"]);
    expect(cells[9]).toHaveTextContent("$24.99");
    expect(cells[11]).toHaveTextContent("2");
  });

  it("folds markets beyond the first three into +N", () => {
    render(
      <ProductTable
        products={[product({ markets: ["US", "GB", "CA", "AU", "DE"] })]}
        locale="en"
        now={NOW}
      />,
    );
    const row = within(screen.getAllByRole("row")[1]);
    expect(row.getByTitle("Canada")).toBeInTheDocument();
    expect(row.queryByTitle("Australia")).toBeNull();
    expect(row.getByTitle("2 more markets")).toHaveTextContent("+2");
  });

  it("translates headers, confidence and country names", () => {
    render(<ProductTable products={[product({})]} locale="zh-TW" now={NOW} />);
    expect(screen.getByRole("columnheader", { name: "廣告主售價（美國）" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "市場" })).toBeInTheDocument();
    const row = within(screen.getAllByRole("row")[1]);
    expect(row.getByText("可信度中")).toBeInTheDocument();
    expect(row.getByText("3 天前首次發現")).toBeInTheDocument();
    expect(row.getByTitle("美國")).toHaveTextContent("US");
    expect(row.getByTitle("德國")).toHaveTextContent("DE");
  });

  it("has sortable signal headers that keep the filters", () => {
    render(
      <ProductTable
        products={[product({})]}
        locale="en"
        filters={{ market: "US", sort: "longevity" }}
        now={NOW}
      />,
    );
    const header = screen.getByRole("columnheader", { name: /Longevity/ });
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(within(header).getByRole("link")).toHaveAttribute(
      "href",
      "/products?market=US&sort=longevity",
    );
    const margin = screen.getByRole("columnheader", { name: /Margin/ });
    expect(margin).not.toHaveAttribute("aria-sort");
    expect(within(margin).getByRole("link")).toHaveAttribute(
      "href",
      "/products?market=US&sort=margin",
    );
  });
});

describe("ProductCard", () => {
  it("shows the score, a one-line summary, markets and all seven signals", () => {
    render(<ProductCard product={product({})} locale="en" watched={false} now={NOW} />);
    expect(screen.getByRole("link", { name: "Paw Cleaner" })).toHaveAttribute(
      "href",
      "/products/paw-cleaner",
    );
    expect(screen.getByText("73")).toHaveAttribute("data-level", "high");
    expect(screen.getByText("$24.99 · 2 advertisers · First seen 3 days ago")).toBeInTheDocument();
    const signals = screen.getAllByRole("definition").map((d) => d.textContent);
    expect(signals).toEqual(["83", "—", "—", "—", "—", "—", "—"]);
    expect(screen.getAllByRole("term").map((d) => d.textContent)).toEqual([
      "Longev.",
      "Scale",
      "Reach",
      "Mom.",
      "Search",
      "Orders",
      "Margin",
    ]);
    const star = screen.getByRole("button", { name: "Watch Paw Cleaner" });
    expect(star).toHaveAttribute("aria-pressed", "false");
  });

  it("says when there is no price and shows a pressed star for watched products", () => {
    render(
      <ProductCard product={product({ retailUsdCents: null })} locale="zh-TW" watched now={NOW} />,
    );
    expect(screen.getByText("沒有美國售價 · 2 個廣告主 · 3 天前首次發現")).toBeInTheDocument();
    const star = screen.getByRole("button", { name: "收藏「Paw Cleaner」" });
    expect(star).toHaveAttribute("aria-pressed", "true");
    expect(star).toHaveAttribute("title", "取消收藏「Paw Cleaner」");
  });

  it("hides the star when the watch state is not given", () => {
    render(<ProductCard product={product({})} locale="en" now={NOW} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ProductList", () => {
  it("renders the table and the cards, with one watch state per product", () => {
    const { container } = render(
      <ProductList
        products={[product({}), product({ id: "2", slug: "b", title: "Bee" })]}
        locale="en"
        watchedIds={new Set(["2"])}
        now={NOW}
      />,
    );
    expect(container.querySelector(".lg\\:block table")).not.toBeNull();
    const cards = container.querySelectorAll(".lg\\:hidden > li");
    expect(cards).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Watch Paw Cleaner" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Watch Bee" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
