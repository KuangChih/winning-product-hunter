import Link from "next/link";
import { Suspense } from "react";
import { getDictionary } from "@/i18n/dictionaries";
import { getLocale } from "@/i18n/server";
import { LanguageSwitcher } from "./language-switcher";
import { NavLinks, SiteNav } from "./site-nav";
import { ThemeToggle } from "./theme-toggle";

/**
 * Site header. The current-page highlight depends on the URL, which is runtime data, so the
 * nav streams inside Suspense while the rest of the header stays in the prerendered shell.
 */
export async function SiteHeader() {
  const locale = await getLocale();
  const t = getDictionary(locale);
  return (
    <header className="border-b">
      <div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
        <Link href="/" className="font-semibold tracking-tight whitespace-nowrap">
          {t.site.name}
        </Link>
        <div className="flex max-w-full items-center gap-1">
          <Suspense fallback={<NavLinks pathname={null} labels={t.nav} />}>
            <SiteNav labels={t.nav} />
          </Suspense>
          <LanguageSwitcher current={locale} label={t.language.switchTo} />
          <ThemeToggle labels={t.theme} />
        </div>
      </div>
    </header>
  );
}

export async function SiteFooter() {
  const t = getDictionary(await getLocale());
  return (
    <footer className="text-muted-foreground mt-16 border-t text-xs">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-2 px-4 py-6">
        <span>{t.site.footerTagline}</span>
        <span>{t.site.footerDisclaimer}</span>
      </div>
    </footer>
  );
}
