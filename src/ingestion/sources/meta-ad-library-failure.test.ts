// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  adLibraryFailureKind,
  classifyAdLibraryResponse,
  diagnoseAdLibraryResponse,
  formatFailure,
  isBlockKind,
} from "./meta-ad-library-failure";
import {
  AdLibraryBlockedError,
  AdLibraryResponseError,
  createAdLibraryWebAdapter,
  parseAdLibraryHtml,
} from "./meta-ad-library-web";

const recorded = fs.readFileSync(
  path.resolve(__dirname, "__recordings__/meta-ad-library-search.html"),
  "utf8",
);

const LIBRARY = "https://www.facebook.com/ads/library/?q=neck+fan&country=US";

function failureOf(html: string, res = {}): AdLibraryResponseError {
  try {
    parseAdLibraryHtml(html, res);
  } catch (err) {
    if (err instanceof AdLibraryResponseError) return err;
    throw err;
  }
  throw new Error("expected a failure");
}

describe("Ad Library response diagnostics", () => {
  it("reads the recorded real page as results (no failure)", () => {
    expect(parseAdLibraryHtml(recorded, { status: 200, url: LIBRARY }).ads).toHaveLength(3);
  });

  it("CAPTCHA: Meta's captcha flag is set", () => {
    const html = recorded.replace(
      '"xfb_ad_library_is_captcha_required":false',
      '"xfb_ad_library_is_captcha_required":true',
    );
    const err = failureOf(html, { status: 200, url: LIBRARY, redirected: false });
    expect(err).toBeInstanceOf(AdLibraryBlockedError);
    expect(err.kind).toBe("captcha");
    expect(err.diagnostic?.markers).toMatchObject({ captcha: true, resultsJson: true });
  });

  it("login wall: redirected to /login (the query string is never kept)", () => {
    const err = failureOf(
      '<html><head><title>Log into Facebook</title></head><form id="login_form"></form></html>',
      {
        status: 200,
        url: "https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Fads%2Flibrary%2F%3Fq%3Dneck",
        redirected: true,
      },
    );
    expect(err).toBeInstanceOf(AdLibraryBlockedError);
    expect(err.kind).toBe("login_wall");
    expect(err.diagnostic).toMatchObject({
      status: 200,
      finalUrl: "https://www.facebook.com/login/",
      redirected: true,
      title: "Log into Facebook",
    });
    expect(err.message).toBe(
      'Meta Ad Library [login_wall] Meta asks to log in (status=200; final=https://www.facebook.com/login/; redirected=yes; bytes=87; title="Log into Facebook"; markers=login_form,login_title,login_url)',
    );
    expect(err.message).not.toMatch(/next=|neck/);
  });

  it("login wall: a /checkpoint page", () => {
    const err = failureOf("<html><title>Security check</title></html>", {
      status: 200,
      url: "https://www.facebook.com/checkpoint/block/?x=1",
      redirected: true,
    });
    expect(err.kind).toBe("login_wall");
    expect(err.diagnostic?.markers.checkpointUrl).toBe(true);
  });

  it("a normal page mentioning login or checkpoint somewhere is not a login wall", () => {
    // The real Ad Library page lists "/checkpoint/block/" and "login" in its route tables.
    const html =
      '<html><head><title>Ad Library</title><script>{"/checkpoint/block/":1,"login":1}</script></head>' +
      '<script type="application/json">{"ad_library_main":{"country_details":{}}}</script></html>';
    const err = failureOf(html, { status: 200, url: LIBRARY, redirected: false });
    expect(err).not.toBeInstanceOf(AdLibraryBlockedError);
    expect(err.kind).toBe("results_not_embedded");
    expect(err.diagnostic?.markers).toMatchObject({ adLibraryApp: true, resultsJson: false });
    expect(err.message).toMatch(/markers=ad_library_app\)$/);
  });

  it("HTTP 403 and 429 pages", () => {
    const forbidden = failureOf("<html><title>Error</title></html>", {
      status: 403,
      url: LIBRARY,
      redirected: false,
    });
    expect(forbidden).toBeInstanceOf(AdLibraryBlockedError);
    expect(forbidden.kind).toBe("http_403");
    // Even a 429 page that happens to embed results is never read as results.
    expect(failureOf(recorded, { status: 429, url: LIBRARY }).kind).toBe("http_429");
  });

  it("parse error: the results JSON is there but unreadable", () => {
    const err = failureOf(
      '<script type="application/json">{"search_results_connection": {broken</script>',
      { status: 200, url: LIBRARY },
    );
    expect(err).not.toBeInstanceOf(AdLibraryBlockedError);
    expect(err.kind).toBe("parse_error");
  });

  it("caps the title and keeps quotes out of the message", () => {
    const d = diagnoseAdLibraryResponse(`<title>  A "quoted"\n${"x".repeat(300)}</title>`);
    expect(d.title).toHaveLength(120);
    expect(d.title).toMatch(/^A 'quoted' x/);
    expect(classifyAdLibraryResponse(d)).toBe("results_not_embedded");
  });

  it("the adapter diagnoses 403 and redirects from the real response (no retry)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const res = new Response("<html><title>Forbidden</title></html>", { status: 403 });
      Object.defineProperty(res, "url", { value: "https://www.facebook.com/ads/library/?q=x" });
      return res;
    });
    const adapter = createAdLibraryWebAdapter({ countries: ["US"], retry: { fetchImpl } });
    const run = async () => {
      for await (const item of adapter.fetch({ queries: ["x"], limit: 10 })) void item;
    };
    await expect(run()).rejects.toThrow(
      /\[http_403\].*status=403; final=https:\/\/www\.facebook\.com\/ads\/library\/; redirected=no/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("adLibraryFailureKind (stored messages)", () => {
  it("reads the kind back from a formatted message", () => {
    expect(adLibraryFailureKind(formatFailure("results_not_embedded", null))).toBe(
      "results_not_embedded",
    );
    expect(adLibraryFailureKind("socket hang up")).toBeNull();
    expect(adLibraryFailureKind(null)).toBeNull();
  });

  it("understands messages stored before diagnostics existed", () => {
    expect(adLibraryFailureKind("Meta Ad Library blocked the request: CAPTCHA required")).toBe(
      "captcha",
    );
    expect(
      adLibraryFailureKind("Meta Ad Library blocked the request: login or checkpoint page"),
    ).toBe("login_wall");
    expect(
      adLibraryFailureKind("Meta Ad Library blocked the request: no search results data in page"),
    ).toBe("results_not_embedded");
    expect(adLibraryFailureKind("HTTP 429 from https://www.facebook.com/ads/library/?q=x")).toBe(
      "http_429",
    );
  });

  it("only CAPTCHA, login walls, 403 and 429 are blocks", () => {
    expect(
      ["captcha", "login_wall", "http_403", "http_429"].every((k) => isBlockKind(k as never)),
    ).toBe(true);
    expect(isBlockKind("results_not_embedded")).toBe(false);
    expect(isBlockKind("parse_error")).toBe(false);
  });
});
