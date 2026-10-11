/**
 * Why a Meta Ad Library page could not be used, with a short privacy-safe diagnostic (ADR-006).
 * Pure module: the runner stores the formatted message, and the discovery page parses it back
 * to explain the case in its own language. Never holds page HTML, cookies or query strings.
 */

export type AdLibraryFailureKind =
  /** Meta's page data asks for a CAPTCHA (`xfb_ad_library_is_captcha_required`). */
  | "captcha"
  /** Redirected to a login or checkpoint page, or the page is a login form. */
  | "login_wall"
  | "http_403"
  | "http_429"
  /** The Ad Library page was served but without the embedded results JSON: not necessarily a block. */
  | "results_not_embedded"
  /** The results JSON was there but could not be read (Meta changed the page). */
  | "parse_error";

export const AD_LIBRARY_FAILURE_KINDS: readonly AdLibraryFailureKind[] = [
  "captcha",
  "login_wall",
  "http_403",
  "http_429",
  "results_not_embedded",
  "parse_error",
];

/** Meta refused us: stop and back off this egress (ADR-006). The other kinds only stop the run. */
const BLOCK_KINDS = new Set<AdLibraryFailureKind>([
  "captcha",
  "login_wall",
  "http_403",
  "http_429",
]);

export function isBlockKind(kind: AdLibraryFailureKind): boolean {
  return BLOCK_KINDS.has(kind);
}

export interface AdLibraryDiagnostic {
  status: number | null;
  /** Final URL after redirects, origin and path only (no query string). */
  finalUrl: string | null;
  redirected: boolean | null;
  /** Response body length in bytes (UTF-8). */
  bytes: number | null;
  /** The page's <title>, trimmed to 120 characters. */
  title: string | null;
  markers: {
    /** `xfb_ad_library_is_captcha_required` is true. */
    captcha: boolean;
    /** A login form (`id="login_form"`) is on the page. */
    loginForm: boolean;
    /** The page title is a login prompt ("Log in to Facebook", "Log into Facebook"). */
    loginTitle: boolean;
    /** The final URL is a /login page. */
    loginUrl: boolean;
    /** The final URL is a /checkpoint page. */
    checkpointUrl: boolean;
    /** `search_results_connection` (the embedded results) is on the page. */
    resultsJson: boolean;
    /** The Ad Library app shell (`ad_library_main` / `AdLibraryFoundationRootQuery`). */
    adLibraryApp: boolean;
  };
}

const MARKER_NAMES: Record<keyof AdLibraryDiagnostic["markers"], string> = {
  captcha: "captcha",
  loginForm: "login_form",
  loginTitle: "login_title",
  loginUrl: "login_url",
  checkpointUrl: "checkpoint_url",
  resultsJson: "results_json",
  adLibraryApp: "ad_library_app",
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  "#x27": "'",
  nbsp: " ",
};

function pageTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.slice(0, 200_000));
  if (!m) return null;
  const text = m[1]
    .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/["\\]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 120) : null;
}

/** Origin and path only: the query string may carry tokens or our search terms. */
function stripQuery(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

export interface ResponseFacts {
  status?: number | null;
  url?: string | null;
  redirected?: boolean | null;
}

export function diagnoseAdLibraryResponse(
  html: string,
  res: ResponseFacts = {},
): AdLibraryDiagnostic {
  const finalUrl = stripQuery(res.url);
  const path = finalUrl ? new URL(finalUrl).pathname : "";
  const title = pageTitle(html);
  return {
    status: res.status ?? null,
    finalUrl,
    redirected: res.redirected ?? null,
    bytes: new TextEncoder().encode(html).length,
    title,
    markers: {
      captcha: /"xfb_ad_library_is_captcha_required"\s*:\s*true/.test(html),
      loginForm: /id=["']login_form["']/.test(html),
      loginTitle: /^log ?in(to)?\b/i.test(title ?? ""),
      loginUrl: /^\/login(\/|\.php|$)/.test(path),
      checkpointUrl: /^\/checkpoint(\/|$)/.test(path),
      resultsJson: html.includes("search_results_connection"),
      adLibraryApp:
        html.includes("ad_library_main") || html.includes("AdLibraryFoundationRootQuery"),
    },
  };
}

/** The case a response that gave no results falls into (most specific first). */
export function classifyAdLibraryResponse(d: AdLibraryDiagnostic): AdLibraryFailureKind {
  if (d.markers.captcha) return "captcha";
  if (d.status === 429) return "http_429";
  if (d.status === 403) return "http_403";
  const m = d.markers;
  if (m.loginUrl || m.checkpointUrl || m.loginForm || m.loginTitle) return "login_wall";
  if (d.markers.resultsJson) return "parse_error";
  return "results_not_embedded";
}

const SUMMARY: Record<AdLibraryFailureKind, string> = {
  captcha: "Meta asks for a CAPTCHA",
  login_wall: "Meta asks to log in",
  http_403: "Meta answered HTTP 403",
  http_429: "Meta answered HTTP 429",
  results_not_embedded: "page has no embedded ad results",
  parse_error: "embedded ad results could not be read",
};

export function formatDiagnostic(d: AdLibraryDiagnostic): string {
  const markers = (Object.keys(MARKER_NAMES) as (keyof typeof MARKER_NAMES)[])
    .filter((k) => d.markers[k])
    .map((k) => MARKER_NAMES[k]);
  return [
    `status=${d.status ?? "?"}`,
    `final=${d.finalUrl ?? "?"}`,
    `redirected=${d.redirected === null ? "?" : d.redirected ? "yes" : "no"}`,
    `bytes=${d.bytes ?? "?"}`,
    `title="${d.title ?? ""}"`,
    `markers=${markers.join(",") || "none"}`,
  ].join("; ");
}

/** `Meta Ad Library [kind] summary (diagnostic)`: what ingestion_runs and the run state keep. */
export function formatFailure(kind: AdLibraryFailureKind, d: AdLibraryDiagnostic | null): string {
  const base = `Meta Ad Library [${kind}] ${SUMMARY[kind]}`;
  return d ? `${base} (${formatDiagnostic(d)})` : base;
}

/**
 * The failure kind in a stored error message, also for messages written before diagnostics
 * existed (the old "blocked the request: …" texts). Null: not an Ad Library page failure.
 */
export function adLibraryFailureKind(
  message: string | null | undefined,
): AdLibraryFailureKind | null {
  if (!message) return null;
  const tagged = /Meta Ad Library \[([a-z_0-9]+)\]/.exec(message);
  if (tagged && (AD_LIBRARY_FAILURE_KINDS as string[]).includes(tagged[1])) {
    return tagged[1] as AdLibraryFailureKind;
  }
  if (/Meta Ad Library blocked the request: CAPTCHA/i.test(message)) return "captcha";
  if (/Meta Ad Library blocked the request: login or checkpoint/i.test(message))
    return "login_wall";
  if (/Meta Ad Library blocked the request: no search results data/i.test(message)) {
    return "results_not_embedded";
  }
  const http = /^HTTP (403|429) from https:\/\/www\.facebook\.com\/ads\/library/.exec(message);
  if (http) return http[1] === "403" ? "http_403" : "http_429";
  return null;
}
