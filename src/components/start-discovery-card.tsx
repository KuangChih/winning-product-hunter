import { ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { fill } from "@/i18n/format";
import type { PipelineStatus } from "@/pipeline/web";
import { EmptyState } from "./notice";
import type { DiscoverLabels } from "./run-progress";
import { StartDiscoveryButton } from "./start-discovery-button";

const linkClass = "text-foreground inline-flex items-center gap-1 underline underline-offset-4";

/**
 * Empty state of the product, ad and home pages: there is nothing to show until discovery has
 * run. Offers the start button, or a link to the progress while a run is active, or says why
 * discovery cannot start on this deployment.
 */
export function StartDiscoveryCard({
  title,
  body,
  status,
  labels,
  heading,
}: {
  title: string;
  body: string;
  status: PipelineStatus;
  labels: DiscoverLabels;
  heading?: "h2" | "h3";
}) {
  const run = status.run;
  if (run?.status === "running") {
    const step = run.steps.find((s) => s.name === run.currentStep);
    return (
      <EmptyState
        title={title}
        heading={heading}
        action={
          <div className="space-y-1">
            <p className="text-foreground flex items-center gap-2 font-medium">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              {labels.inProgress}
              {step && ` · ${labels.steps[step.name]}`}
            </p>
            <Link href="/discover" className={linkClass}>
              {labels.viewProgress}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        }
      >
        <p>{body}</p>
      </EmptyState>
    );
  }
  if (!status.canStart) {
    return (
      <EmptyState
        title={title}
        heading={heading}
        action={
          <Link href="/discover" className={linkClass}>
            {labels.openDiscover}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        }
      >
        <p>{body}</p>
        {status.startBlockedReason && <p>{labels.blocked[status.startBlockedReason]}</p>}
      </EmptyState>
    );
  }
  return (
    <EmptyState title={title} heading={heading} action={<StartDiscoveryButton labels={labels} />}>
      <p>{body}</p>
      <p>{labels.duration}</p>
      {status.adLibrary?.reason === "daily_cap" && (
        <p>
          {fill(labels.dailyCapBody, {
            used: status.adLibrary.sweepsToday,
            cap: status.adLibrary.dailySweepCap,
          })}
        </p>
      )}
    </EmptyState>
  );
}
