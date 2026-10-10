import { SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { fill } from "@/i18n/format";

/**
 * The less used filters of a form, folded away so the results come first on a phone. Closed by
 * default: applied filters show as chips (`FilterChips`) instead.
 */
export function FilterDisclosure({
  label,
  activeLabel,
  activeCount,
  applyLabel,
  children,
}: {
  /** "Filters" */
  label: string;
  /** "Filters ({n})" */
  activeLabel: string;
  activeCount: number;
  /** A submit button at the end of the panel, so a phone user need not scroll back up. */
  applyLabel?: string;
  children: ReactNode;
}) {
  return (
    <details className="group w-full">
      <summary className="hover:bg-secondary inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border px-3 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal aria-hidden className="size-4" />
        {activeCount > 0 ? fill(activeLabel, { n: activeCount }) : label}
      </summary>
      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border p-3">
        {children}
        {applyLabel && (
          <div className="w-full">
            <button
              type="submit"
              className="bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium"
            >
              {applyLabel}
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

export interface FilterChip {
  /** e.g. "Market: United States" */
  label: string;
  /** The current URL without this filter. */
  removeHref: string;
}

/** Applied filters as chips; each one links to the same view without that filter. */
export function FilterChips({
  chips,
  clearHref,
  labels,
}: {
  chips: FilterChip[];
  clearHref: string;
  labels: { activeFilters: string; removeFilter: string; clearAll: string };
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <ul aria-label={labels.activeFilters} className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.label}>
            <Link
              href={chip.removeHref}
              aria-label={fill(labels.removeFilter, { filter: chip.label })}
              className="bg-secondary hover:bg-muted inline-flex items-center gap-1 rounded-full border py-0.5 pr-1.5 pl-2.5 text-xs"
            >
              {chip.label}
              <X aria-hidden className="size-3.5" />
            </Link>
          </li>
        ))}
      </ul>
      {chips.length > 1 && (
        <Link
          href={clearHref}
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
        >
          {labels.clearAll}
        </Link>
      )}
    </div>
  );
}
