import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RankingControls } from "./ranking-controls";

describe("RankingControls", () => {
  it("prefills the form and keeps filters when toggling sample data", () => {
    render(
      <RankingControls
        filters={{ q: "neck", market: "GB", minScore: 60, sort: "newest" }}
        includeSample={false}
        resultCount={3}
      />,
    );

    expect(screen.getByRole("searchbox")).toHaveValue("neck");
    expect(screen.getByRole("combobox", { name: "Market" })).toHaveValue("GB");
    expect(screen.getByRole("combobox", { name: "Min. score" })).toHaveValue("60");
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("newest");
    expect(screen.getByText(/3 products/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Include sample data" })).toHaveAttribute(
      "href",
      "/products?q=neck&market=GB&minScore=60&sort=newest&sample=1",
    );
  });
});
