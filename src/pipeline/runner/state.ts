import type { FetchedItem } from "@/ingestion/types";
import type {
  CjStepState,
  RunState,
  RunStatus,
  SkipReason,
  StagedItem,
  StepName,
  StepState,
  UnitName,
} from "./types";

export const STATE_VERSION = 1;

export const STEP_ORDER: StepName[] = [
  "fx",
  "discover",
  "advertisers",
  "cj",
  "collect",
  "stores",
  "dedupe",
  "match",
  "score",
];

/** The unit order on the success path. */
export const UNIT_ORDER: UnitName[] = [
  "start",
  "discover",
  "discover_finalize",
  "advertisers",
  "advertisers_finalize",
  "cj",
  "cj_details",
  "cj_finalize",
  "collect",
  "stores",
  "hash",
  "merge",
  "match",
  "score",
  "finish",
  "done",
];

export const STEP_OF_UNIT: Record<UnitName, StepName | null> = {
  start: "fx",
  discover: "discover",
  discover_finalize: "discover",
  advertisers: "advertisers",
  advertisers_finalize: "advertisers",
  cj: "cj",
  cj_details: "cj",
  cj_finalize: "cj",
  collect: "collect",
  stores: "stores",
  hash: "dedupe",
  merge: "dedupe",
  match: "match",
  score: "score",
  finish: null,
  done: null,
};

/**
 * Where a unit that threw goes next: a failed source never stops the rest (FX, CJ, collect,
 * dedupe, match and score always run after a Meta block or failure). A failed CJ request unit
 * still stores what it found (cj_finalize).
 */
export const FAIL_NEXT: Record<UnitName, UnitName> = {
  start: "discover",
  discover: "discover_finalize",
  discover_finalize: "advertisers",
  advertisers: "advertisers_finalize",
  advertisers_finalize: "cj",
  cj: "cj_finalize",
  cj_details: "cj_finalize",
  cj_finalize: "collect",
  collect: "stores",
  stores: "hash",
  hash: "merge",
  merge: "match",
  match: "score",
  score: "finish",
  finish: "done",
  done: "done",
};

/** Units that are wrapped-up work only (no network sources): a stalled run jumps here. */
export const WRAP_UP_FROM: UnitName = "merge";

/** Ad Library sweep units and the finalize unit that stores what they staged. */
const FINALIZE_OF: Partial<
  Record<UnitName, { progress: "keyword" | "advertiser"; finalize: UnitName }>
> = {
  discover: { progress: "keyword", finalize: "discover_finalize" },
  advertisers: { progress: "advertiser", finalize: "advertisers_finalize" },
};

const step = (): StepState => ({ status: "pending" });
const cjStep = (): CjStepState => ({
  status: "pending",
  requests: 0,
  pointsUsedToday: null,
  listed: 0,
  detailFailures: 0,
  stopped: null,
});

/** `now` is the planning time (fixed in tests); progress is timed from `createdAt`. */
export function initialState(now: Date, createdAt: Date = new Date()): RunState {
  return {
    v: STATE_VERSION,
    now: now.toISOString(),
    cursor: "start",
    progressAt: createdAt.toISOString(),
    plan: {
      adLibrary: null,
      keywords: null,
      keywordRequests: null,
      advertiserRequests: null,
      collect: null,
      stores: null,
      cj: null,
    },
    progress: {
      keyword: 0,
      advertiser: 0,
      collect: 0,
      stores: 0,
      hashAttempted: 0,
      cjList: 0,
      cjDetail: 0,
    },
    unit: null,
    rate: { adLibraryNextAt: null, shopifyNextAt: null, cjNextAt: null },
    cjCandidates: [],
    adLibrary: { requests: 0, blocked: null, stopped: null },
    steps: {
      fx: step(),
      discover: step(),
      advertisers: step(),
      cj: cjStep(),
      collect: { ...step(), items: 0, failedProducts: 0, errors: [] },
      stores: { ...step(), items: 0, failedProducts: 0, errors: [] },
      dedupe: { ...step(), hashed: 0, failed: 0, skipped: 0, merged: 0 },
      match: step(),
      score: step(),
    },
    results: {
      newProducts: 0,
      matchedProducts: 0,
      newAds: 0,
      adsFetched: 0,
      productsScored: 0,
      cjProducts: 0,
    },
  };
}

/**
 * Fills in what states saved before the CJ step existed lack (same version: they stay
 * resumable). A run that had already passed the CJ step's place records it as skipped.
 */
export function upgradeState(s: RunState): RunState {
  if (s.steps.cj) return s;
  const passed = UNIT_ORDER.indexOf(s.cursor) > UNIT_ORDER.indexOf("advertisers_finalize");
  return {
    ...s,
    plan: { ...s.plan, cj: passed ? [] : null },
    progress: { ...s.progress, cjList: 0, cjDetail: 0 },
    rate: { ...s.rate, cjNextAt: null },
    cjCandidates: [],
    steps: {
      ...s.steps,
      cj: passed ? { ...cjStep(), status: "skipped", skipReason: "incompatible_state" } : cjStep(),
    },
    results: { ...s.results, cjProducts: 0 },
  };
}

/** True when a saved state can be resumed by this code. */
export function isCompatibleState(state: unknown): state is RunState {
  const s = state as Partial<RunState> | null;
  return (
    !!s &&
    s.v === STATE_VERSION &&
    typeof s.cursor === "string" &&
    UNIT_ORDER.includes(s.cursor as UnitName) &&
    !!s.steps &&
    !!s.plan &&
    !!s.progress
  );
}

export function setStep<K extends StepName>(
  s: RunState,
  name: K,
  patch: Partial<RunState["steps"][K]>,
): RunState {
  return { ...s, steps: { ...s.steps, [name]: { ...s.steps[name], ...patch } } };
}

export function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}

/** A unit threw (not an abort): its step failed and the run moves on. */
export function failUnit(s: RunState, unit: UnitName, err: unknown): RunState {
  const name = STEP_OF_UNIT[unit];
  const next = name ? setStep(s, name, { status: "failed", error: errorMessage(err) }) : s;
  return { ...next, cursor: FAIL_NEXT[unit] };
}

/**
 * Skips everything before the wrap-up (merge → match → score → finish): steps not finished yet
 * are marked skipped with `reason`. Used when a run stalls or runs out of ticks.
 */
export function fastForward(s: RunState, reason: SkipReason): RunState {
  if (UNIT_ORDER.indexOf(s.cursor) >= UNIT_ORDER.indexOf(WRAP_UP_FROM)) return s;
  // Ads a sweep already fetched (each one a counted Meta request) are stored first: its
  // finalize unit runs, then goes straight to the wrap-up because later steps are skipped.
  const sweep = FINALIZE_OF[s.cursor];
  let next: RunState;
  let keep: StepName | null = null;
  if (
    s.cursor === "discover_finalize" ||
    s.cursor === "advertisers_finalize" ||
    s.cursor === "cj_finalize"
  ) {
    next = s;
    keep = STEP_OF_UNIT[s.cursor];
  } else if (
    (s.cursor === "cj" || s.cursor === "cj_details") &&
    (s.cjCandidates?.length ?? 0) > 0
  ) {
    // CJ products already fetched (counted requests) are stored first, as for Meta sweeps.
    next = { ...s, cursor: "cj_finalize", unit: null };
    keep = "cj";
  } else if (sweep && s.progress[sweep.progress] > 0) {
    next = { ...s, cursor: sweep.finalize, unit: null };
    keep = STEP_OF_UNIT[s.cursor];
  } else {
    next = { ...s, cursor: WRAP_UP_FROM, unit: null };
  }
  for (const name of ["fx", "discover", "advertisers", "cj", "collect", "stores"] as const) {
    if (name === keep) continue;
    const st = next.steps[name].status;
    if (st === "pending" || st === "running") {
      next = setStep(next, name, { status: "skipped", skipReason: reason });
    }
  }
  return next;
}

/** Skip reasons that mean the run did not do everything it was meant to. */
const PARTIAL_REASONS: SkipReason[] = [
  "backoff",
  "daily_cap",
  "blocked",
  "stalled",
  "tick_limit",
  "incompatible_state",
];

export function finalStatus(s: RunState): Exclude<RunStatus, "running"> {
  const partial = STEP_ORDER.some((name) => {
    const st = s.steps[name];
    return (
      st.status === "failed" ||
      (st.status === "skipped" && !!st.skipReason && PARTIAL_REASONS.includes(st.skipReason))
    );
  });
  return partial ? "partial" : "succeeded";
}

/** The step a cursor is on (null once finished). */
export function currentStep(s: RunState): StepName | null {
  return STEP_OF_UNIT[s.cursor];
}

// --- Staging (JSON round trip of fetched items) ---------------------------------------------

export function toStaged(item: FetchedItem): StagedItem {
  return JSON.parse(JSON.stringify(item)) as StagedItem;
}

const asDate = (v: unknown) => (typeof v === "string" ? new Date(v) : undefined);

export function fromStaged(s: StagedItem): FetchedItem {
  const item = { ...s } as unknown as FetchedItem & Record<string, unknown>;
  if (s.startedAt !== undefined) item.startedAt = asDate(s.startedAt);
  if (s.endedAt !== undefined) item.endedAt = s.endedAt === null ? null : asDate(s.endedAt);
  item.metrics = ((s.metrics as FetchedItem["metrics"] | undefined) ?? []).map((m) => ({
    ...m,
    ...(m.observedAt ? { observedAt: new Date(m.observedAt as unknown as string) } : {}),
  }));
  return item;
}
