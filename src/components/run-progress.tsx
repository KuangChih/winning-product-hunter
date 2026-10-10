import { Check, Circle, CircleMinus, CircleX, LoaderCircle } from "lucide-react";
import type { Dictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { classifyError } from "@/lib/discovery-client";
import { formatUtc } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RunProgress, StepProgress } from "@/pipeline/progress";

export type DiscoverLabels = Dictionary["discover"];

/**
 * A raw error from a source or the runner, explained in the page's language; the original
 * (English, technical) text is folded away as technical details.
 */
export function ErrorText({
  message,
  labels,
  className,
}: {
  message: string;
  labels: DiscoverLabels;
  className?: string;
}) {
  return (
    <div className={cn("text-red-700 dark:text-red-400", className)}>
      <p>{labels.errorKinds[classifyError(message)]}</p>
      <details className="text-muted-foreground">
        <summary className="cursor-pointer select-none">{labels.technicalDetails}</summary>
        <p lang="en" className="font-mono break-words">
          {message}
        </p>
      </details>
    </div>
  );
}

const STATUS_ICON = {
  pending: Circle,
  running: LoaderCircle,
  done: Check,
  failed: CircleX,
  skipped: CircleMinus,
} as const;

const STATUS_CLASS: Record<StepProgress["status"], string> = {
  pending: "text-muted-foreground",
  running: "text-foreground",
  done: "text-emerald-700 dark:text-emerald-400",
  failed: "text-red-700 dark:text-red-400",
  skipped: "text-muted-foreground",
};

const RUN_STATUS_CLASS: Record<RunProgress["status"], string> = {
  running: "bg-secondary text-secondary-foreground",
  succeeded: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-50",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-900/70 dark:text-amber-50",
  failed: "bg-red-100 text-red-900 dark:bg-red-900/70 dark:text-red-50",
};

/** The run's status as a small colored label. */
export function RunStatusBadge({
  status,
  labels,
}: {
  status: RunProgress["status"];
  labels: DiscoverLabels;
}) {
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        RUN_STATUS_CLASS[status],
      )}
    >
      {labels.runStatus[status]}
    </span>
  );
}

function StepRow({
  step,
  labels,
  locale,
}: {
  step: StepProgress;
  labels: DiscoverLabels;
  locale: Locale;
}) {
  const Icon = STATUS_ICON[step.status];
  const counts = step.total !== null && step.total > 0 ? `${step.done ?? 0}/${step.total}` : null;
  return (
    <li data-status={step.status} className="flex gap-3 py-2">
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          STATUS_CLASS[step.status],
          step.status === "running" && "animate-spin",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className={cn(step.status === "running" && "font-medium")}>
            {labels.steps[step.name]}
          </span>
          <span className={cn("text-xs tabular-nums", STATUS_CLASS[step.status])}>
            {labels.stepStatus[step.status]}
            {counts && ` · ${counts}`}
          </span>
        </div>
        {step.skipReason && (
          <p className="text-muted-foreground text-xs">{labels.skipReasons[step.skipReason]}</p>
        )}
        {/* Result summaries come from the runner in English; shown on English pages only. */}
        {step.detail && locale === "en" && step.status !== "skipped" && (
          <p className="text-muted-foreground text-xs break-words">{step.detail}</p>
        )}
        {step.error && <ErrorText message={step.error} labels={labels} className="text-xs" />}
      </div>
    </li>
  );
}

/** Steps of one run with their status, counts and reasons (no data fetching). */
export function RunProgressView({
  run,
  labels,
  locale,
}: {
  run: RunProgress;
  labels: DiscoverLabels;
  locale: Locale;
}) {
  const keywords = run.keywords?.length ? run.keywords.join(", ") : null;
  return (
    <div className="space-y-3">
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <RunStatusBadge status={run.status} labels={labels} />
        <span>{fill(labels.startedAt, { time: formatUtc(run.createdAt) })}</span>
        {run.finishedAt && (
          <span>{fill(labels.finishedAt, { time: formatUtc(run.finishedAt) })}</span>
        )}
      </div>
      {keywords && (
        <p className="text-muted-foreground text-sm break-words">
          {fill(run.customKeywords ? labels.customKeywordsUsed : labels.keywordsUsed, {
            list: keywords,
          })}
        </p>
      )}
      {run.steps.length > 0 && (
        <ol aria-label={labels.stepsLabel} className="divide-y rounded-lg border px-3 text-sm">
          {run.steps.map((step) => (
            <StepRow key={step.name} step={step} labels={labels} locale={locale} />
          ))}
        </ol>
      )}
      {run.error && <ErrorText message={run.error} labels={labels} className="text-sm" />}
    </div>
  );
}
