import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Landing } from "@/components/landing";
import { getDictionary } from "@/i18n/dictionaries";

describe("Landing", () => {
  it("renders the product name, calls to action and the preview slot", () => {
    render(<Landing t={getDictionary("en").landing} preview={<p>preview here</p>} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Winning Product Hunter");
    expect(screen.getByRole("link", { name: "See winning products" })).toHaveAttribute(
      "href",
      "/products",
    );
    expect(screen.getByRole("link", { name: "Discover new products" })).toHaveAttribute(
      "href",
      "/discover",
    );
    expect(screen.getByText("preview here")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Why it is different" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Data sources" })).toHaveTextContent("Meta Ad Library");
  });

  it("renders in Traditional Chinese with the same structure", () => {
    render(<Landing t={getDictionary("zh-TW").landing} preview={null} />);

    // The product name stays in English.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Winning Product Hunter");
    expect(screen.getByRole("link", { name: "查看熱賣產品" })).toHaveAttribute("href", "/products");
    expect(screen.getByRole("heading", { name: "有什麼不同" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
    expect(screen.getByRole("list", { name: "資料來源" })).toHaveTextContent("Meta Ad Library");
  });
});
