import { ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { RankedProduct } from "@/data/products";
import type { Dictionary } from "@/i18n/dictionaries";
import { formatUtc } from "@/lib/format";
import type { PipelineStatus } from "@/pipeline/web";

export const HOME_LINK_CLASS =
  "text-foreground inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline";

/** Last update, product count, and a running discovery (or a way to start one). */
export function StatusStrip({
  ranked,
  status,
  dict,
}: {
  ranked: RankedProduct[];
  status: PipelineStatus;
  dict: Dictionary;
}) {
  const { home: t, discover } = dict;
  const run = status.run?.status === "running" ? status.run : null;
  const step = run?.steps.find((s) => s.name === run.currentStep);
  return (
    <section
      aria-label={t.statusLabel}
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border px-4 py-3 text-sm"
    >
      <dl className="flex flex-wrap gap-x-6 gap-y-1">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t.lastUpdate}</dt>
          {/* Every product is scored in one batch, so the first one's time is the update time. */}
          <dd className="tabular-nums">{formatUtc(ranked[0]?.computedAt)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t.productCount}</dt>
          <dd className="tabular-nums">{ranked.length.toLocaleString("en-US")}</dd>
        </div>
      </dl>
      <div className="sm:ml-auto">
        {run ? (
          <Link href="/discover" className={HOME_LINK_CLASS}>
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            {discover.inProgress}
            {step && ` · ${discover.steps[step.name]}`}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        ) : (
          <Link href="/discover" className={HOME_LINK_CLASS}>
            {t.discoverMore}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        )}
      </div>
    </section>
  );
}
