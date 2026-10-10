"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/i18n/dictionaries";
import { splitLocale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

export const NAV_LINKS = [
  { href: "/products", key: "products" },
  { href: "/ads", key: "ads" },
  { href: "/watchlist", key: "watchlist" },
  { href: "/sources", key: "sources" },
] as const;

export type NavLabels = Dictionary["nav"];

/** True when `pathname` (with or without a locale prefix) is the link's page or a sub-page. */
export function isActive(pathname: string, href: string) {
  const path = splitLocale(pathname).path;
  return path === href || path.startsWith(`${href}/`);
}

/** Links without an active state: the prerendered fallback before the pathname is known. */
export function NavLinks({ pathname, labels }: { pathname: string | null; labels: NavLabels }) {
  return (
    <nav
      aria-label={labels.label}
      className="-mx-2.5 max-w-full overflow-x-auto overflow-y-hidden sm:-mx-1"
    >
      <ul className="flex items-center gap-0.5 p-1 text-sm whitespace-nowrap sm:gap-1">
        {NAV_LINKS.map((link) => {
          const active = pathname !== null && isActive(pathname, link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md px-1.5 py-1.5 sm:px-3",
                  active
                    ? "bg-secondary font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {labels[link.key]}
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
