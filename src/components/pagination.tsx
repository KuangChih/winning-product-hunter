import Link from "next/link";
import { fill } from "@/i18n/format";

export interface PaginationLabels {
  pagination: string;
  previous: string;
  next: string;
  pageOf: string;
}

/** Previous / "Page x of y" / next. Renders nothing for a single page. */
export function Pagination({
  page,
  pageCount,
  hrefFor,
  labels,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  labels: PaginationLabels;
}) {
  if (pageCount <= 1) return null;
  const linkClass = "hover:bg-secondary rounded-md border px-3 py-1.5 underline-offset-4";
  return (
    <nav aria-label={labels.pagination} className="flex items-center justify-between gap-2 text-sm">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={linkClass}>
          {labels.previous}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        {fill(labels.pageOf, { page, count: pageCount })}
      </span>
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} className={linkClass}>
          {labels.next}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
