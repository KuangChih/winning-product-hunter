import { cn } from "@/lib/utils";

export type ScoreLevel = "high" | "medium" | "low";

/** ≥70 high (green), 50–69 medium (amber), below 50 low (neutral). */
export function scoreLevel(score: number): ScoreLevel {
  const rounded = Math.round(score);
  if (rounded >= 70) return "high";
  if (rounded >= 50) return "medium";
  return "low";
}

// Dark text on a light tint and light text on a dark tint: both well above 4.5:1.
const LEVEL_CLASS: Record<ScoreLevel, string> = {
  high: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-50",
  medium: "bg-amber-100 text-amber-900 dark:bg-amber-900/70 dark:text-amber-50",
  low: "bg-secondary text-secondary-foreground",
};

/** The Winning Score as a colored number. */
export function ScoreBadge({
  score,
  size = "md",
  className,
}: {
  score: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const level = scoreLevel(score);
  return (
    <span
      data-level={level}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-semibold tabular-nums",
        size === "sm" && "min-w-8 px-1.5 py-0.5 text-xs",
        size === "md" && "min-w-10 px-2 py-0.5 text-sm",
        size === "lg" && "min-w-14 px-2.5 py-1 text-2xl",
        LEVEL_CLASS[level],
        className,
      )}
    >
      {score.toFixed(0)}
    </span>
  );
}
