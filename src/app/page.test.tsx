import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Landing } from "@/components/landing";

describe("Landing", () => {
  it("renders the product name, calls to action and the preview slot", () => {
    render(<Landing preview={<p>preview here</p>} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Winning Product Hunter");
    expect(screen.getByRole("link", { name: "See winning products" })).toHaveAttribute(
      "href",
      "/products",
    );
    expect(screen.getByRole("link", { name: "How the data is collected" })).toHaveAttribute(
      "href",
      "/sources",
    );
    expect(screen.getByText("preview here")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Why it is different" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Data sources" })).toHaveTextContent("Meta Ad Library");
  });
});
