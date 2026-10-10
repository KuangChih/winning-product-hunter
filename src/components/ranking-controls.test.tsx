import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RankingControls } from "./ranking-controls";

// Filters inside the folded panel are in the DOM but not displayed until it is opened.
const hidden = { hidden: true };

describe("RankingControls", () => {
  it("prefills the form and shows applied filters as removable chips", () => {
    render(
      <RankingControls
        filters={{
          q: "neck",
          market: "GB",
          minScore: 60,
          minPrice: 15,
          maxPrice: 60,
          source: "shopify",
          sort: "newest",
        }}
        resultCount={3}
        locale="en"
      />,
    );

    expect(screen.getByRole("searchbox")).toHaveValue("neck");
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("newest");
    expect(screen.getByRole("combobox", { name: "Market", ...hidden })).toHaveValue("GB");
    expect(screen.getByRole("combobox", { name: "Min. score", ...hidden })).toHaveValue("60");
    expect(screen.getByRole("spinbutton", { name: "Min. price (US$)", ...hidden })).toHaveValue(15);
    expect(screen.getByRole("spinbutton", { name: "Max. price (US$)", ...hidden })).toHaveValue(60);
    expect(screen.getByRole("combobox", { name: "Evidence", ...hidden })).toHaveValue("shopify");
    expect(screen.getByText("3 products")).toBeInTheDocument();
    // Search stays outside the panel; the five folded filters are counted on its toggle.
    expect(screen.getByText("Filters (5)")).toBeInTheDocument();

    const chips = within(screen.getByRole("list", { name: "Active filters" }));
    expect(chips.getAllByRole("link")).toHaveLength(6);
    expect(
      chips.getByRole("link", { name: "Remove filter: Market: United Kingdom" }),
    ).toHaveAttribute(
      "href",
      "/products?q=neck&minScore=60&minPrice=15&maxPrice=60&source=shopify&sort=newest",
    );
    expect(chips.getByRole("link", { name: "Remove filter: Search: neck" })).toHaveAttribute(
      "href",
      "/products?market=GB&minScore=60&minPrice=15&maxPrice=60&source=shopify&sort=newest",
    );
    // Clearing keeps the sort order.
    expect(screen.getByRole("link", { name: "Clear all" })).toHaveAttribute(
      "href",
      "/products?sort=newest",
    );
    // No sample-data switch: sample data is never shown.
    expect(screen.queryByText(/sample/i)).toBeNull();
  });

  it("renders labels, sorts and country names in Traditional Chinese", () => {
    render(<RankingControls filters={{}} resultCount={2} locale="zh-TW" />);
    expect(screen.getByRole("search", { name: "篩選產品" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "市場", ...hidden })).toHaveTextContent("英國");
    expect(screen.getByRole("option", { name: "競爭最少" })).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "最低售價（US$）", ...hidden }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "證據來源", ...hidden })).toHaveTextContent(
      "Shopify 店家",
    );
    expect(screen.getByText("2 個產品")).toBeInTheDocument();
    expect(screen.getByText("篩選")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "已套用的篩選" })).toBeNull();
  });

  it("offers sorting by each signal and opens the signal filters when one is set", () => {
    render(
      <RankingControls filters={{ signals: { momentum: "data" }, sort: "momentum" }} locale="en" />,
    );
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("momentum");
    expect(screen.getByRole("option", { name: "Highest Margin" })).toBeInTheDocument();
    expect(screen.getByText("Signal filters (1 on)")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Momentum", ...hidden })).toHaveValue("data");
    expect(screen.getByRole("combobox", { name: "Longevity", ...hidden })).toHaveValue("");
    expect(screen.getByRole("link", { name: "Remove filter: Momentum: Has data" })).toHaveAttribute(
      "href",
      "/products?sort=momentum",
    );
  });
});
