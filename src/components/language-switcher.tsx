"use client";

import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_NAMES,
  LOCALES,
  splitLocale,
  type Locale,
} from "@/i18n/locales";

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
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${other}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
        // A prefixed URL (/zh-TW/...) would keep its language, so drop the prefix.
        const { path } = splitLocale(window.location.pathname);
        window.location.assign(path + window.location.search + window.location.hash);
      }}
      className="text-muted-foreground hover:text-foreground hover:bg-secondary h-8 rounded-md px-2 text-sm whitespace-nowrap"
    >
      {LOCALE_NAMES[other]}
    </button>
  );
}
