import Link from "next/link";
import { Suspense } from "react";
import { getDictionary } from "@/i18n/dictionaries";
import { getLocale } from "@/i18n/server";
import { LanguageSwitcher } from "./language-switcher";
import { NavLinks, SiteNav } from "./site-nav";
import { ThemeToggle } from "./theme-toggle";

/**
 * Compact sticky header. The current-page highlight depends on the URL, which is runtime data,
 * so the nav streams inside Suspense while the rest of the header stays in the prerendered
 * shell. On phones the nav is a tab bar fixed to the bottom of the screen (see `NavLinks`); the
 * header must not get a transform, filter or backdrop-filter, which would pin that bar to the
 * header instead of the screen.
 */
export async function SiteHeader() {
  const locale = await getLocale();
  const t = getDictionary(locale);
  return (
    <header className="bg-background sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
        <Link href="/" className="mr-auto truncate font-semibold tracking-tight">
          {t.site.name}
        </Link>
        {/*
          Before the nav in the document: on phones the nav is the bottom tab bar, so keyboard
          focus goes header buttons → tab bar → page instead of bottom → top → page. From md up
          the buttons are shown after the inline nav.
        */}
        <div className="flex shrink-0 items-center md:order-last">
          <LanguageSwitcher current={locale} label={t.language.switchTo} />
          <ThemeToggle labels={t.theme} />
        </div>
        <Suspense fallback={<NavLinks pathname={null} labels={t.nav} />}>
          <SiteNav labels={t.nav} />
        </Suspense>
      </div>
    </header>
  );
}

export async function SiteFooter() {
  const t = getDictionary(await getLocale());
  return (
    <footer className="text-muted-foreground mt-12 border-t text-xs">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-2 px-4 py-6">
        <span>{t.site.footerTagline}</span>
        <span>{t.site.footerDisclaimer}</span>
      </div>
    </footer>
  );
}
