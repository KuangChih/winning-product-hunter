import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/i18n/dictionaries";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

import { isActive, NavLinks, SiteNav } from "./site-nav";

const en = getDictionary("en").nav;
const zh = getDictionary("zh-TW").nav;

describe("SiteNav", () => {
  it("marks the current section, including its sub-pages", () => {
    pathname.value = "/products/neck-massager";
    render(<SiteNav labels={en} />);
    expect(screen.getByRole("link", { name: "Winning products" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Data sources" })).not.toHaveAttribute("aria-current");
  });

  it("renders plain links without an active state as the prerendered fallback", () => {
    render(<NavLinks pathname={null} labels={en} />);
    expect(screen.getAllByRole("link").every((l) => !l.hasAttribute("aria-current"))).toBe(true);
  });

  it("hides the navigation on the login page, with or without a language prefix", () => {
    pathname.value = "/login";
    const { unmount } = render(<SiteNav labels={en} />);
    expect(screen.queryByRole("navigation")).toBeNull();
    unmount();
    pathname.value = "/zh-TW/login";
    render(<SiteNav labels={zh} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows translated labels and keeps the active state on prefixed URLs", () => {
    pathname.value = "/zh-TW/ads";
    render(<SiteNav labels={zh} />);
    expect(screen.getByRole("navigation", { name: "主要導覽" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "廣告" })).toHaveAttribute("aria-current", "page");
    // Links stay unprefixed: the language cookie picks the language.
    expect(screen.getByRole("link", { name: "廣告" })).toHaveAttribute("href", "/ads");
  });

  it("does not treat a prefix of another word as the same section", () => {
    expect(isActive("/products-old", "/products")).toBe(false);
    expect(isActive("/sources", "/sources")).toBe(true);
    expect(isActive("/zh-TW/sources", "/sources")).toBe(true);
  });
});
