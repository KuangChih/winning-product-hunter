import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type NoticeTone = "neutral" | "warning" | "error";

const TONE_CLASS: Record<NoticeTone, string> = {
  neutral: "bg-muted/30",
  warning: "border-amber-500/50 bg-amber-500/5",
  error: "border-red-500/50 bg-red-500/5",
};

/**
 * A boxed message: setup problems, empty results, honest limits. `heading` is the heading level
 * of the title (h2 by default; h3 inside a section).
 */
export function Notice({
  title,
  children,
  tone = "neutral",
  heading = "h2",
  className,
}: {
  title: string;
  children?: ReactNode;
  tone?: NoticeTone;
  heading?: "h2" | "h3";
  className?: string;
}) {
  const Heading = heading;
  return (
    <div className={cn("rounded-lg border p-4 sm:p-6", TONE_CLASS[tone], className)}>
      <Heading className="font-semibold">{title}</Heading>
      {children && (
        <div
          className={cn(
            "mt-2 space-y-2 text-sm",
            tone === "neutral" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** An empty list or page: what is missing, and optionally what to do about it. */
export function EmptyState({
  title,
  children,
  action,
  heading,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  heading?: "h2" | "h3";
}) {
  return (
    <Notice title={title} heading={heading}>
      {children}
      {action && <div className="pt-2">{action}</div>}
    </Notice>
  );
}
