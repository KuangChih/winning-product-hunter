/**
 * Progress JSON for the discovery page (pure: the route or page loads the inputs, see
 * `loadProgressInput`). Only facts from the run's saved state; nothing is estimated.
 */
import { DAILY_SWEEP_CAP } from "./runner/options";
import { STEP_ORDER, currentStep, isCompatibleState } from "./runner/state";
import type { PipelineRunRow } from "./runner/store";
import type {
  RunStatus,
  RunState,
  SkipReason,
  StepName,
  StepStatus,
  Trigger,
} from "./runner/types";
import { isStalled } from "./runner/watchdog";

export interface StepProgress {
  name: StepName;
  status: StepStatus;
  detail: string | null;
  error: string | null;
  skipReason: SkipReason | null;
  done: number | null;
  total: number | null;
}

export interface RunSummary {
  newProducts: number;
  newAds: number;
  adsFetched: number;
  matchedProducts: number;
  productsScored: number;
  adLibraryRequests: number;
}

export interface RunProgress {
  id: number;
  trigger: Trigger;
  status: RunStatus;
  env: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  ticks: number;
  currentStep: StepName | null;
  steps: StepProgress[];
  /** Running but nobody is driving it (a tick should be started). */
  stalled: boolean;
  /** Meta blocked a request in this run. */
  blocked: { at: string; reason: string } | null;
  /** Meta served a page without usable ad data in this run (not a block); Meta stopped. */
  stopped: { at: string; reason: string } | null;
  /** Which of the day's Meta sweeps this run is (null: it did not sweep). */
  sweep: number | null;
  /** Custom keywords, or the rotation's keywords once planned. */
  keywords: string[] | null;
  customKeywords: boolean;
  lastKickError: string | null;
  error: string | null;
  summary: RunSummary;
}

export interface PipelineProgress {
  /** The latest run (running or finished). */
  run: RunProgress | null;
  /** The last finished run, for "last update" and its counts. */
  lastRun: RunProgress | null;
  adLibrary: {
    /** Meta is paused for this server until then (back-off after a block). */
    pausedUntil: string | null;
    reason: null | "backoff" | "daily_cap";
    /** Blocks in a row (the back-off doubles each time). */
    strikes: number;
    /** What the last block was (stored error text with its diagnostic), while paused. */
    blockReason: string | null;
    sweepsToday: number;
    dailySweepCap: number;
  };
}

export interface ProgressInput {
  latest: PipelineRunRow | null;
  lastFinished: PipelineRunRow | null;
  backoff: { until: Date; strikes: number; reason?: string | null } | null;
  sweepsToday: number;
  now: number;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function stepProgress(state: RunState): StepProgress[] {
  // Runs saved before a step existed (e.g. CJ) simply do not list it.
  return STEP_ORDER.filter((name) => !!state.steps[name]).map((name) => {
    const st = state.steps[name];
    return {
      name,
      status: st.status,
      detail: st.detail ?? null,
      error: st.error ?? null,
      skipReason: st.skipReason ?? null,
      done: st.done ?? null,
      total: st.total ?? null,
    };
  });
}

export function toRunProgress(run: PipelineRunRow, now: number): RunProgress {
  const state = isCompatibleState(run.state) ? run.state : null;
  return {
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    env: run.env,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    finishedAt: iso(run.finishedAt),
    ticks: run.ticks,
    currentStep: state && run.status === "running" ? currentStep(state) : null,
    steps: state ? stepProgress(state) : [],
    stalled: isStalled(run, now),
    blocked: state?.adLibrary.blocked ?? null,
    stopped: state?.adLibrary.stopped ?? null,
    sweep: state?.plan.adLibrary?.sweep ?? null,
    keywords: run.options.keywords ?? state?.plan.keywords ?? null,
    customKeywords: !!run.options.keywords,
    lastKickError: run.lastKickError,
    error: run.error,
    summary: {
      newProducts: state?.results.newProducts ?? 0,
      newAds: state?.results.newAds ?? 0,
      adsFetched: state?.results.adsFetched ?? 0,
      matchedProducts: state?.results.matchedProducts ?? 0,
      productsScored: state?.results.productsScored ?? 0,
      adLibraryRequests: run.adLibraryRequests,
    },
  };
}

export function toProgress(input: ProgressInput): PipelineProgress {
  const paused = input.backoff && input.backoff.until.getTime() > input.now ? input.backoff : null;
  return {
    run: input.latest ? toRunProgress(input.latest, input.now) : null,
    lastRun: input.lastFinished ? toRunProgress(input.lastFinished, input.now) : null,
    adLibrary: {
      pausedUntil: paused ? paused.until.toISOString() : null,
      reason: paused ? "backoff" : input.sweepsToday >= DAILY_SWEEP_CAP ? "daily_cap" : null,
      strikes: input.backoff?.strikes ?? 0,
      blockReason: paused?.reason ?? null,
      sweepsToday: input.sweepsToday,
      dailySweepCap: DAILY_SWEEP_CAP,
    },
  };
}
