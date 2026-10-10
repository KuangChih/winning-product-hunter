import { lang } from "next/root-params";
import { getDictionary } from "./dictionaries";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locales";

/** The current request's language, from the `[lang]` root segment (Server Components only). */
export async function getLocale(): Promise<Locale> {
  const value = await lang();
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getT() {
  return getDictionary(await getLocale());
}
