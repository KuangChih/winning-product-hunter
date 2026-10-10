/** Products per page on the ranking page. */
export const PRODUCT_PAGE_SIZE = 30;

export interface Paged<T> {
  items: T[];
  /** All matching items, across every page. */
  total: number;
  /** 1-based; clamped to the last page. */
  page: number;
  /** At least 1, so "page 1 of 1" holds for an empty list. */
  pageCount: number;
  /** 1-based position of the first item on this page (0 when there are none). */
  from: number;
  /** 1-based position of the last item on this page (0 when there are none). */
  to: number;
}

/** One page of a list. Pages past the end show the last page instead of an empty one. */
export function paginate<T>(items: T[], page: number, pageSize: number): Paged<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    items: slice,
    total,
    page: current,
    pageCount,
    from: slice.length ? start + 1 : 0,
    to: start + slice.length,
  };
}

/** A 1-based page number from a URL parameter; anything else is page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
