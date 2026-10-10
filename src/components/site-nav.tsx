"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const NAV_LINKS = [
  { href: "/products", label: "Winning products" },
  { href: "/ads", label: "Ads" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/sources", label: "Data sources" },
] as const;

/** True when `pathname` is the link's page or one of its sub-pages. */
export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Links without an active state: the prerendered fallback before the pathname is known. */
export function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main" className="-mx-1.5 max-w-full overflow-x-auto sm:mx-0">
      <ul className="flex items-center gap-0.5 text-sm whitespace-nowrap sm:gap-1">
        {NAV_LINKS.map((link) => {
          const active = pathname !== null && isActive(pathname, link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-1.5 py-1.5 sm:px-3",
                  active
                    ? "bg-secondary font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Navigation with the current section highlighted (needs the pathname, so it streams). */
export function SiteNav() {
  const pathname = usePathname() ?? "/";
  // The login page is outside the site; links would only bounce back to it.
  if (pathname === "/login") return null;
  return <NavLinks pathname={pathname} />;
}
