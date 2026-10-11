/** Progress JSON builders for component tests (the shapes of `GET /api/pipeline/status`). */
import type { RunProgress, StepProgress } from "../progress";
import type { StepName } from "../runner/types";
import type { PipelineStatus } from "../web";

export const STEPS: StepName[] = [
  "fx",
  "discover",
  "advertisers",
  "collect",
  "stores",
  "dedupe",
  "match",
  "score",
];

export function step(name: StepName, over: Partial<StepProgress> = {}): StepProgress {
  return {
    name,
    status: "pending",
    detail: null,
    error: null,
    skipReason: null,
    done: null,
    total: null,
    ...over,
  };
}

export function runProgress(over: Partial<RunProgress> = {}): RunProgress {
  return {
    id: 7,
    trigger: "web",
    status: "running",
    env: "local",
    createdAt: "2026-10-11T06:30:00.000Z",
    updatedAt: "2026-10-11T06:35:00.000Z",
    finishedAt: null,
    ticks: 2,
    currentStep: "discover",
    steps: STEPS.map((n) => step(n)),
    stalled: false,
    blocked: null,
    stopped: null,
    sweep: 1,
    keywords: ["neck fan", "pet brush"],
    customKeywords: false,
    lastKickError: null,
    error: null,
    summary: {
      newProducts: 0,
      newAds: 0,
      adsFetched: 0,
      matchedProducts: 0,
      productsScored: 0,
      adLibraryRequests: 12,
    },
    ...over,
  };
}

export function pipelineStatus(over: Partial<PipelineStatus> = {}): PipelineStatus {
  return {
    run: null,
    lastRun: null,
    adLibrary: {
      pausedUntil: null,
      reason: null,
      strikes: 0,
      blockReason: null,
      sweepsToday: 0,
      dailySweepCap: 3,
    },
    configured: true,
    setup: null,
    disabled: false,
    cronConfigured: true,
    canStart: true,
    startBlockedReason: null,
    ...over,
  };
}
