import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WatchedProduct } from "@/data/watchlist";
import { WatchList } from "./watch-list";

// The unwatch button posts to a Server Action; the component only needs a function for the form.
vi.mock("@/app/[lang]/watchlist/actions", () => ({ setWatched: vi.fn() }));

const item = (over: Partial<WatchedProduct>): WatchedProduct => ({
  productId: "11111111-1111-1111-1111-111111111111",
  slug: "neck-fan",
  title: "Neck Fan",
  imageUrl: null,
  addedAt: new Date("2026-10-01T00:00:00Z"),
  scoreAtAdd: 60,
  score: 68,
  scoredAt: new Date("2026-10-10T00:00:00Z"),
  previousScore: 70,
  ...over,
});

describe("WatchList", () => {
  it("shows each product with its score, changes and an unwatch button", () => {
    render(
      <WatchList
        items={[
          item({}),
          item({
            productId: "22222222-2222-2222-2222-222222222222",
            slug: "new",
            title: "New Thing",
            score: null,
            scoreAtAdd: null,
            previousScore: null,
          }),
        ]}
        locale="en"
      />,
    );
    const [first, second] = within(
      screen.getByRole("list", { name: "Watched products" }),
    ).getAllByRole("article");
    expect(within(first).getByRole("link", { name: "Neck Fan" })).toHaveAttribute(
      "href",
      "/products/neck-fan",
    );
    const value = (scope: HTMLElement, label: string) =>
      within(scope).getByText(label, { selector: "dt" }).nextElementSibling!.textContent;
    expect(value(first, "Score")).toBe("68");
    expect(value(first, "Last update")).toBe("−2");
    expect(value(first, "Since added")).toBe("+8");
    expect(within(first).getByText("Added 2026-10-01")).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "★ Watching" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // No score yet: said in words, and the changes are dashes rather than invented numbers.
    expect(value(second, "Score")).toBe("Not scored");
    expect(value(second, "Last update")).toBe("—");
    expect(value(second, "Since added")).toBe("—");
  });

  it("is translated", () => {
    render(<WatchList items={[item({})]} locale="zh-TW" />);
    expect(screen.getByRole("list", { name: "收藏的產品" })).toBeInTheDocument();
    expect(screen.getByText("與上次更新相比")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "★ 已收藏" })).toBeInTheDocument();
  });
});
