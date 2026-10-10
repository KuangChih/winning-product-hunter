/**
 * Browser side of the discovery routes (ADR-013): start a run, read its progress, and turn the
 * routes' error codes into the page's own words. No server imports (used by client components).
 */
import type { Dictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/format";
import type { PipelineProgress } from "@/pipeline/progress";
import {
  KEYWORD_SEPARATOR,
  MAX_CUSTOM_KEYWORDS,
  MAX_KEYWORD_LENGTH,
} from "@/pipeline/runner/options";
import type { PipelineStatus, StartBlockedReason } from "@/pipeline/web";

export const START_URL = "/api/pipeline/start";
export const STATUS_URL = "/api/pipeline/status";
/** How often the page asks for progress while a run is active. */
export const POLL_INTERVAL_MS = 5_000;
/** Longest wait between polls after repeated failures. */
export const MAX_POLL_INTERVAL_MS = 60_000;

/** Wait before the next poll: doubles with each failure in a row, up to a minute. */
export function pollDelay(failuresInRow: number): number {
  return Math.min(POLL_INTERVAL_MS * 2 ** Math.max(0, failuresInRow), MAX_POLL_INTERVAL_MS);
}

export type StartResult =
  | { ok: true; created: boolean; ignoredOptions: boolean; progress: PipelineProgress }
  | { ok: false; status: number; error: string; message?: string };

const BLOCKED: StartBlockedReason[] = [
  "no_database",
  "migrations",
  "disabled",
  "preview",
  "site_password_required",
];

/** Starts discovery (or joins the active run). `keywords`: the raw text of the optional field. */
export async function startDiscovery(
  keywords: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StartResult> {
  let res: Response;
  try {
    res = await fetchImpl(START_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(keywords.trim() ? { keywords } : {}),
    });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body || body.ok !== true) {
    return {
      ok: false,
      status: res.status,
      error: typeof body?.error === "string" ? body.error : "unknown",
      message: typeof body?.message === "string" ? body.message : undefined,
    };
  }
  return {
    ok: true,
    created: body.created === true,
    ignoredOptions: body.ignoredOptions === true,
    progress: body.progress as PipelineProgress,
  };
}

export type StatusResult =
  | { kind: "ok"; status: PipelineStatus }
  /** The sign-in expired (401): polling cannot recover until the user signs in again. */
  | { kind: "unauthorized" }
  /** Network or server trouble: worth retrying later. */
  | { kind: "error" };

/** The latest status, or why it could not be read (the page keeps showing the last one). */
export async function fetchStatus(fetchImpl: typeof fetch = fetch): Promise<StatusResult> {
  try {
    const res = await fetchImpl(STATUS_URL, { cache: "no-store" });
    if (res.status === 401) return { kind: "unauthorized" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", status: (await res.json()) as PipelineStatus };
  } catch {
    return { kind: "error" };
  }
}

/** What to tell the user when starting failed. */
export function startErrorMessage(
  result: Extract<StartResult, { ok: false }>,
  labels: Dictionary["discover"],
): string {
  const { error } = result;
  if ((BLOCKED as string[]).includes(error)) return labels.blocked[error as StartBlockedReason];
  if (error === "unauthorized") return labels.errors.unauthorized;
  if (error === "forbidden_origin") return labels.errors.forbidden_origin;
  if (error === "network") return labels.errors.network;
  if (error === "invalid_options") {
    // The server's reason is English; say the rules in the page's language instead.
    return fill(labels.errors.invalid_options, {
      max: MAX_CUSTOM_KEYWORDS,
      length: MAX_KEYWORD_LENGTH,
    });
  }
  return fill(labels.errors.unknown, { status: result.status });
}

/** The keywords in the field, split like the server does (blanks and repeats ignored). */
export function splitKeywords(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(KEYWORD_SEPARATOR)
    .map((k) => k.replace(/\s+/g, " ").trim())
    .filter((k) => {
      const key = k.toLowerCase();
      if (!k || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Number of keywords in the field. */
export function countKeywords(text: string): number {
  return splitKeywords(text).length;
}

/** True when a keyword is longer than the server accepts. */
export function hasLongKeyword(text: string): boolean {
  return splitKeywords(text).some((k) => k.length > MAX_KEYWORD_LENGTH);
}

export type ErrorKind = "blocked" | "rate_limited" | "timeout" | "network" | "service" | "other";

/**
 * Sorts a raw error from a source or the runner (English, technical) into a kind the page can
 * explain in its own language. The raw text stays available as technical details.
 */
export function classifyError(message: string): ErrorKind {
  const m = message.toLowerCase();
  if (/\b429\b|too many requests|rate.?limit/.test(m)) return "rate_limited";
  // The Ad Library adapter's block reasons (AdLibraryBlockedError) included.
  if (/block|captcha|checkpoint|\blog ?in\b|no search results data|forbidden|\b403\b/.test(m)) {
    return "blocked";
  }
  if (/timed? ?out|timeout|abort/.test(m)) return "timeout";
  if (/fetch failed|network|econn|enotfound|eai_again|socket|dns/.test(m)) return "network";
  if (/service error|unavailable|bad gateway|\b50[0234]\b|server error|try again later/.test(m)) {
    return "service";
  }
  return "other";
}
