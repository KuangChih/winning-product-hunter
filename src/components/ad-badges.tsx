import { fill } from "@/i18n/format";
import { type AdTiming, adRunDays, isAdActive } from "@/lib/ad-facts";
import { cn } from "@/lib/utils";

const chip = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";

/**
 * How long an ad has run ("45 days") and whether it still runs. Long-running ads are the main
 * profitability signal, so the day count is the first thing on an ad card.
 */
export function AdRunBadges({
  ad,
  now,
  labels,
}: {
  ad: AdTiming;
  now: Date;
  labels: { days: string; active: string; stopped: string };
}) {
  const days = adRunDays(ad, now);
  const active = isAdActive(ad, now);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {days !== null && (
        <span className={cn(chip, "bg-secondary tabular-nums")}>
          {fill(labels.days, { n: days })}
        </span>
      )}
      <span
        className={cn(
          chip,
          active
            ? "border-emerald-600/40 text-emerald-800 dark:border-emerald-400/40 dark:text-emerald-300"
            : "text-muted-foreground",
        )}
      >
        {active ? labels.active : labels.stopped}
      </span>
    </span>
  );
}
