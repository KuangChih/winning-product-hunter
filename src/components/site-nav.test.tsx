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
    expect(screen.getByRole("link", { name: "Products" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Discover" })).not.toHaveAttribute("aria-current");
  });

  it("has the four sections, each with an icon and a visible label", () => {
    pathname.value = "/discover";
    render(<SiteNav labels={en} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Products", "/products"],
      ["Ads", "/ads"],
      ["Watchlist", "/watchlist"],
      ["Discover", "/discover"],
    ]);
    // Icons are decorative; the label is the accessible name.
    for (const link of links) expect(link.querySelector("svg")).toHaveAttribute("aria-hidden");
    expect(screen.getByRole("link", { name: "Discover" })).toHaveAttribute("aria-current", "page");
    // One navigation element for every screen size (a bottom tab bar on phones).
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getByRole("navigation").className).toMatch(/(^| )fixed .* md:static( |$)/);
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
    expect(isActive("/discover", "/discover")).toBe(true);
    expect(isActive("/zh-TW/discover", "/discover")).toBe(true);
  });
});
