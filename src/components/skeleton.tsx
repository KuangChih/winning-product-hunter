import { cn } from "@/lib/utils";

/** A gray placeholder block while content streams in. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("bg-muted animate-pulse rounded-md", className)} />;
}

/**
 * Suspense fallback for a list page: a toolbar line and a few rows. Screen readers hear the
 * loading label instead of the gray boxes.
 */
export function ListSkeleton({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">{label}</span>
      <div className="flex gap-3">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="space-y-2 rounded-lg border p-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-10 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Suspense fallback for a block of text or cards. */
export function BlockSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className={cn("space-y-2", className)}>
      <span className="sr-only">{label}</span>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
