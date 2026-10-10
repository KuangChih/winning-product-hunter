"use client";

import { Flame, Megaphone, Radar, Star, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/i18n/dictionaries";
import { splitLocale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

export const NAV_LINKS: ReadonlyArray<{
  href: string;
  key: "products" | "ads" | "watchlist" | "discover";
  icon: LucideIcon;
}> = [
  { href: "/products", key: "products", icon: Flame },
  { href: "/ads", key: "ads", icon: Megaphone },
  { href: "/watchlist", key: "watchlist", icon: Star },
  { href: "/discover", key: "discover", icon: Radar },
];

export type NavLabels = Dictionary["nav"];

/** True when `pathname` (with or without a locale prefix) is the link's page or a sub-page. */
export function isActive(pathname: string, href: string) {
  const path = splitLocale(pathname).path;
  return path === href || path.startsWith(`${href}/`);
}

/**
 * The one main navigation: inline in the header from `md` up, a tab bar fixed to the bottom of
 * the screen on phones (the layout pads the page so the bar never covers content). Rendered
 * without an active state as the prerendered fallback, before the pathname is known.
 */
export function NavLinks({ pathname, labels }: { pathname: string | null; labels: NavLabels }) {
  return (
    <nav
      aria-label={labels.label}
      className="bg-background fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:static md:border-t-0 md:bg-transparent md:pb-0"
    >
      <ul className="grid grid-cols-4 md:flex md:items-center md:gap-1">
        {NAV_LINKS.map(({ href, key, icon: Icon }) => {
          const active = pathname !== null && isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 px-1 pt-2 pb-1.5 text-[11px] leading-tight whitespace-nowrap",
                  "md:flex-row md:gap-1.5 md:rounded-md md:px-3 md:py-1.5 md:text-sm",
                  // Phones: a bar on the top edge of the active tab; md up: a filled pill.
                  active
                    ? "text-foreground md:bg-secondary font-medium before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:rounded-full before:bg-current md:before:hidden"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-5 md:size-4" strokeWidth={active ? 2.5 : 2} />
                {labels[key]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Navigation with the current section highlighted (needs the pathname, so it streams). */
export function SiteNav({ labels }: { labels: NavLabels }) {
  const pathname = usePathname() ?? "/";
  // The login page is outside the site; links would only bounce back to it.
  if (splitLocale(pathname).path === "/login") return null;
  return <NavLinks pathname={pathname} labels={labels} />;
}
