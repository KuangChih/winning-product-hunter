"use client";

import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import {
  countKeywords,
  fetchStatus,
  hasLongKeyword,
  POLL_INTERVAL_MS,
  pollDelay,
  startDiscovery,
  startErrorMessage,
} from "@/lib/discovery-client";
import { MAX_KEYWORD_LENGTH } from "@/pipeline/runner/options";
import { formatUtc } from "@/lib/format";
import type { RunProgress } from "@/pipeline/progress";
import type { PipelineStatus } from "@/pipeline/web";
import { Notice } from "./notice";
import { RunProgressView, type DiscoverLabels } from "./run-progress";
import { buttonVariants } from "./ui/button";
import { fieldClass } from "./ui/field";

/**
 * Honest state of discovery on this deployment: why it cannot start, Meta blocking this server,
 * today's Meta searches used up.
 */
export function DiscoveryNotices({
  status,
  labels,
}: {
  status: PipelineStatus;
  labels: DiscoverLabels;
}) {
  const notices = [];
  if (status.startBlockedReason) {
    notices.push(
      <Notice key="blocked" tone="warning" heading="h3" title={labels.cannotStartTitle}>
        <p>{labels.blocked[status.startBlockedReason]}</p>
      </Notice>,
    );
  }
  const ad = status.adLibrary;
  if (ad?.reason === "backoff" && ad.pausedUntil) {
    notices.push(
      <Notice key="backoff" tone="warning" heading="h3" title={labels.blockedTitle}>
        <p>{fill(labels.blockedBody, { time: formatUtc(ad.pausedUntil) })}</p>
      </Notice>,
    );
  } else if (ad?.reason === "daily_cap") {
    notices.push(
      <Notice key="cap" heading="h3" title={labels.dailyCapTitle}>
        <p>{fill(labels.dailyCapBody, { used: ad.sweepsToday, cap: ad.dailySweepCap })}</p>
      </Notice>,
    );
  }
  if (notices.length === 0) return null;
  return <div className="space-y-3">{notices}</div>;
}

/** The daily automatic run is not set up (only worth saying where discovery can start). */
export function CronNotice({ status, labels }: { status: PipelineStatus; labels: DiscoverLabels }) {
  if (status.cronConfigured || !status.canStart) return null;
  return (
    <Notice heading="h3" title={labels.cronOffTitle}>
      <p>{labels.cronOffBody}</p>
    </Notice>
  );
}

/** What a finished run produced, with a link to the new products. */
export function RunOutcome({ run, labels }: { run: RunProgress; labels: DiscoverLabels }) {
  if (run.status === "running") return null;
  const s = run.summary;
  if (run.status === "failed") {
    return (
      // The error itself is shown with the steps below (RunProgressView).
      <Notice tone="error" heading="h3" title={labels.failedTitle} />
    );
  }
  return (
    <Notice heading="h3" title={labels.finishedTitle}>
      {s.newProducts > 0 ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-foreground font-medium">
            {fill(labels.newProducts, { n: s.newProducts })}
          </span>
          <Link
            href="/products?sort=newest"
            className="text-foreground inline-flex items-center gap-1 underline underline-offset-4"
          >
            {labels.viewNewProducts}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </p>
      ) : (
        <p>{labels.noNewProducts}</p>
      )}
      <p>
        {fill(labels.summary, {
          ads: s.adsFetched,
          newAds: s.newAds,
          scored: s.productsScored,
        })}
      </p>
    </Notice>
  );
}

/**
 * The discovery page's live part: the start button with optional keywords, and the latest
 * run's progress. Polls the status every few seconds only while a run is active, and refreshes
 * the server-rendered parts (history, source health) when it finishes.
 */
export function DiscoveryPanel({
  initialStatus,
  labels,
  locale,
  maxKeywords,
}: {
  initialStatus: PipelineStatus;
  labels: DiscoverLabels;
  locale: Locale;
  maxKeywords: number;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const run = status.run;
  const running = run?.status === "running";

  // Poll while a run is active: one request at a time (the next is scheduled when the last one
  // answers), paused while the tab is hidden and caught up as soon as it is visible again,
  // slower after failures, and stopped for good when the sign-in expired.
  useEffect(() => {
    if (!running || signedOut) return;
    let cancelled = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(poll, ms);
    };
    async function poll() {
      timer = undefined;
      if (cancelled || inFlight || document.hidden) return; // resumed by `onVisible`
      inFlight = true;
      const result = await fetchStatus();
      inFlight = false;
      if (cancelled) return;
      if (result.kind === "unauthorized") {
        setSignedOut(true);
        return;
      }
      if (result.kind === "error") {
        failures += 1;
        setPollFailed(true);
        schedule(pollDelay(failures));
        return;
      }
      failures = 0;
      setPollFailed(false);
      setStatus(result.status);
      schedule(POLL_INTERVAL_MS);
    }
    const onVisible = () => {
      if (document.hidden || inFlight) return;
      clearTimeout(timer);
      void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule(POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [running, signedOut]);

  // A run just finished: re-render the server parts (history, source health, counts).
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) router.refresh();
    wasRunning.current = running;
  }, [running, router]);

  const tooMany = countKeywords(keywords) > maxKeywords;
  const tooLong = hasLongKeyword(keywords);
  const invalid = tooMany || tooLong;

  async function onStart(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const result = await startDiscovery(keywords);
    setBusy(false);
    if (!result.ok) {
      setError(startErrorMessage(result, labels));
      return;
    }
    setStatus((s) => ({ ...s, ...result.progress }));
    if (result.ignoredOptions) setNote(labels.ignoredKeywords);
    else setKeywords("");
  }

  const canPress = status.canStart && !running && !busy;
  return (
    <div className="space-y-6">
      <DiscoveryNotices status={status} labels={labels} />

      {!running && status.canStart && (
        <form onSubmit={onStart} className="space-y-3 rounded-lg border p-4">
          <details className="text-sm">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none">
              {labels.keywordsToggle}
            </summary>
            <label className="mt-3 flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">{labels.keywordsLabel}</span>
              <input
                type="text"
                name="keywords"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder={labels.keywordsPlaceholder}
                aria-describedby="keywords-help"
                aria-invalid={invalid || undefined}
                autoComplete="off"
                className={`${fieldClass} w-full`}
              />
            </label>
            <p
              id="keywords-help"
              className={
                invalid
                  ? "mt-1 text-xs text-red-700 dark:text-red-400"
                  : "text-muted-foreground mt-1 text-xs"
              }
            >
              {tooMany
                ? fill(labels.tooManyKeywords, { max: maxKeywords })
                : tooLong
                  ? fill(labels.keywordTooLong, { length: MAX_KEYWORD_LENGTH })
                  : fill(labels.keywordsHelp, { max: maxKeywords })}
            </p>
          </details>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="submit"
              disabled={!canPress || invalid}
              className={buttonVariants({ size: "lg", className: "h-10 px-4" })}
            >
              <Play aria-hidden />
              {busy ? labels.starting : labels.start}
            </button>
            <p className="text-muted-foreground text-sm">{labels.duration}</p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </form>
      )}

      {note && (
        <p role="status" className="text-sm">
          {note}
        </p>
      )}

      {run && (
        <section aria-labelledby="run-heading" className="space-y-3">
          <h2 id="run-heading" className="text-lg font-semibold">
            {running ? labels.inProgress : labels.lastRunTitle}
          </h2>
          {running && <p className="text-muted-foreground text-sm">{labels.duration}</p>}
          {running && run.stalled && <p className="text-sm">{labels.stalled}</p>}
          {running && run.lastKickError && !run.stalled && (
            <p className="text-sm">{labels.handoffError}</p>
          )}
          {signedOut ? (
            <p role="alert" className="text-sm">
              {labels.signedOut}{" "}
              <Link
                href="/login?next=%2Fdiscover"
                className="font-medium underline underline-offset-4"
              >
                {labels.signIn}
              </Link>
            </p>
          ) : (
            pollFailed && (
              <p role="status" className="text-muted-foreground text-sm">
                {labels.pollError}
              </p>
            )
          )}
          {!running && <RunOutcome run={run} labels={labels} />}
          <RunProgressView run={run} labels={labels} locale={locale} />
        </section>
      )}

      <CronNotice status={status} labels={labels} />
    </div>
  );
}
