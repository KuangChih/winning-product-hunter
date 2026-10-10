import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

import { isActive, NavLinks, SiteNav } from "./site-nav";

describe("SiteNav", () => {
  it("marks the current section, including its sub-pages", () => {
    pathname.value = "/products/neck-massager";
    render(<SiteNav />);
    expect(screen.getByRole("link", { name: "Winning products" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Data sources" })).not.toHaveAttribute("aria-current");
  });

  it("renders plain links without an active state as the prerendered fallback", () => {
    render(<NavLinks pathname={null} />);
    expect(screen.getAllByRole("link").every((l) => !l.hasAttribute("aria-current"))).toBe(true);
  });

  it("hides the navigation on the login page", () => {
    pathname.value = "/login";
    render(<SiteNav />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("does not treat a prefix of another word as the same section", () => {
    expect(isActive("/products-old", "/products")).toBe(false);
    expect(isActive("/sources", "/sources")).toBe(true);
  });
});
