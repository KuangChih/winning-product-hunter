"use client";

import { Languages } from "lucide-react";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_NAMES,
  LOCALES,
  splitLocale,
  type Locale,
} from "@/i18n/locales";

/** Short visible label of each language for the compact header button. */
const SHORT_NAMES: Record<Locale, string> = { en: "EN", "zh-TW": "中文" };

/**
 * Switches between the two languages. The choice is a cookie the proxy reads, so URLs stay the
 * same; the page reloads to render in the new language (ADR-011).
 */
export function LanguageSwitcher({ current, label }: { current: Locale; label: string }) {
  const other = LOCALES.find((l) => l !== current)!;
  return (
    <button
      type="button"
      lang={other}
      aria-label={`${label} ${LOCALE_NAMES[other]}`}
      title={`${label} ${LOCALE_NAMES[other]}`}
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${other}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
        // A prefixed URL (/zh-TW/...) would keep its language, so drop the prefix.
        const { path } = splitLocale(window.location.pathname);
        window.location.assign(path + window.location.search + window.location.hash);
      }}
      className="text-muted-foreground hover:text-foreground hover:bg-secondary inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap"
    >
      <Languages aria-hidden className="size-4" />
      {SHORT_NAMES[other]}
    </button>
  );
}
