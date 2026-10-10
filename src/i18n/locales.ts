/**
 * Supported UI languages (ADR-011). URLs stay unprefixed (`/products`); the proxy rewrites them
 * to `/[lang]/...` from the language cookie. Prefixed URLs (`/zh-TW/products`) also work.
 */
export const LOCALES = ["en", "zh-TW"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";
/** One year: a language choice is long-lived. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Names shown in the language switcher, each in its own language. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", "zh-TW": "繁體中文" };

export function isLocale(value: string | null | undefined): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? "");
}

/** Splits a leading locale segment off a pathname: `/zh-TW/products` → zh-TW + `/products`. */
export function splitLocale(pathname: string): { locale: Locale | null; path: string } {
  const [, first, ...rest] = pathname.split("/");
  if (!isLocale(first)) return { locale: null, path: pathname };
  return { locale: first, path: `/${rest.join("/")}` };
}

/** The internal path for a request: unprefixed paths get the cookie's (or default) locale. */
export function localizedPath(pathname: string, cookieLocale: string | undefined): string | null {
  if (splitLocale(pathname).locale) return null; // already localized
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  return `/${locale}${pathname === "/" ? "" : pathname}`;
}
