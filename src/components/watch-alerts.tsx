import Link from "next/link";
import type { ReactNode } from "react";
import { scoreChange, type WatchedProduct } from "@/data/watchlist";
import { fill } from "@/i18n/format";
import { cn } from "@/lib/utils";

/** A score change as "+6" (green), "−8" (red), "0", or "—" when unknown. */
export function ScoreChange({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const rounded = Math.round(value);
  return (
    <span
      className={cn(
        "tabular-nums",
        rounded > 0 && "text-emerald-600 dark:text-emerald-400",
        rounded < 0 && "text-red-600 dark:text-red-400",
      )}
    >
      {rounded > 0 ? `+${rounded}` : rounded === 0 ? "0" : `−${Math.abs(rounded)}`}
    </span>
  );
}

/** "moved {change} to {score}…" with the colored change element in place of `{change}`. */
function AlertText({
  template,
  change,
  score,
}: {
  template: string;
  change: ReactNode;
  score: string;
}) {
  const [before, after = ""] = fill(template, { score }).split("{change}");
  return (
    <>
      {before}
      {change}
      {after}
    </>
  );
}

/** Watched products whose score moved a lot in the last update (see `scoreAlerts`). */
export function WatchAlerts({
  alerts,
  labels,
  headingLevel = "h2",
}: {
  alerts: WatchedProduct[];
  labels: { alertsHeading: string; alertMoved: string };
  headingLevel?: "h2" | "h3";
}) {
  if (alerts.length === 0) return null;
  const Heading = headingLevel;
  return (
    <section
      aria-labelledby="alerts-heading"
      className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
    >
      <Heading id="alerts-heading" className="font-semibold">
        {labels.alertsHeading}
      </Heading>
      <ul className="mt-2 space-y-1 text-sm">
        {alerts.map((w) => (
          <li key={w.productId}>
            <Link href={`/products/${w.slug}`} className="underline underline-offset-4">
              {w.title}
            </Link>{" "}
            <AlertText
              template={labels.alertMoved}
              change={<ScoreChange value={scoreChange(w.score, w.previousScore)} />}
              score={w.score!.toFixed(0)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
