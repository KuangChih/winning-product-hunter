import Link from "next/link";
import { Suspense } from "react";
import { NavLinks, SiteNav } from "./site-nav";
import { ThemeToggle } from "./theme-toggle";

/**
 * Site header. The current-page highlight depends on the URL, which is runtime data, so the
 * nav streams inside Suspense while the rest of the header stays in the prerendered shell.
 */
export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
        <Link href="/" className="font-semibold tracking-tight whitespace-nowrap">
          Winning Product Hunter
        </Link>
        <div className="flex max-w-full items-center gap-1">
          <Suspense fallback={<NavLinks pathname={null} />}>
            <SiteNav />
          </Suspense>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="text-muted-foreground mt-16 border-t text-xs">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-2 px-4 py-6">
        <span>Winning Product Hunter · evidence-based product research</span>
        <span>Signals are estimates from public data, not sales figures.</span>
      </div>
    </footer>
  );
}
