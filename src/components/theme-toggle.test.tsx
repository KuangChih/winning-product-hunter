import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDarkTheme,
  nextThemePreference,
  parseThemePreference,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/lib/theme";
import { ThemeToggle } from "./theme-toggle";

function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: dark, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

describe("theme helpers", () => {
  it("parses stored preferences, defaulting to system", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("blue")).toBe("system");
  });

  it("follows the OS only for the system preference", () => {
    expect(isDarkTheme("system", true)).toBe(true);
    expect(isDarkTheme("system", false)).toBe(false);
    expect(isDarkTheme("light", true)).toBe(false);
    expect(isDarkTheme("dark", false)).toBe(true);
  });

  it("cycles system → light → dark → system", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
  });
});

describe("theme init script", () => {
  beforeEach(() => document.documentElement.classList.remove("dark"));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("applies the stored or system theme before paint", () => {
    mockSystemDark(true);
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    localStorage.setItem(THEME_STORAGE_KEY, "light");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    mockSystemDark(false);
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("cycles the preference, stores it and updates the page", () => {
    render(<ThemeToggle />);
    const button = () => screen.getByRole("button");
    expect(button()).toHaveAccessibleName(/^System theme/);

    act(() => fireEvent.click(button()));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button()).toHaveAccessibleName(/^Light theme/);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => fireEvent.click(button()));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => fireEvent.click(button()));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(button()).toHaveAccessibleName(/^System theme/);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
