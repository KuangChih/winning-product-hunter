import { describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/i18n/dictionaries";
import { parseKeywords } from "@/pipeline/runner";
import {
  classifyError,
  countKeywords,
  fetchStatus,
  hasLongKeyword,
  pollDelay,
  startDiscovery,
  startErrorMessage,
} from "./discovery-client";

const en = getDictionary("en").discover;
const zh = getDictionary("zh-TW").discover;

describe("discovery client", () => {
  it("sends keywords only when the field has some", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ ok: true, created: false, ignoredOptions: true, progress: {} }),
      );
    expect(await startDiscovery("  ", fetchMock)).toMatchObject({ ok: true, ignoredOptions: true });
    expect(fetchMock.mock.calls[0][1]!.body).toBe("{}");
    await startDiscovery("a, b", fetchMock);
    expect(fetchMock.mock.calls[1][1]!.body).toBe('{"keywords":"a, b"}');
  });

  it("turns route errors into the page's words", async () => {
    const failing = (body: unknown, status: number) =>
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
    const res = await startDiscovery("", failing({ error: "disabled" }, 403));
    expect(res).toEqual({ ok: false, status: 403, error: "disabled", message: undefined });
    expect(startErrorMessage(res as Extract<typeof res, { ok: false }>, zh)).toBe(
      "這個部署已關閉探索功能。",
    );

    const invalid = await startDiscovery(
      "x",
      failing({ error: "invalid_options", message: "At most 10 keywords" }, 400),
    );
    // The server's English reason is not shown; the rules are, in the page's language.
    expect(startErrorMessage(invalid as Extract<typeof invalid, { ok: false }>, zh)).toBe(
      "請檢查關鍵字：最多 10 個，每個最多 60 個字元。",
    );

    // The proxy's 401 (signed out) and a dead network.
    const signedOut = await startDiscovery("", failing({ error: "unauthorized" }, 401));
    expect(startErrorMessage(signedOut as Extract<typeof signedOut, { ok: false }>, en)).toMatch(
      /sign-in has expired/,
    );
    const offline = await startDiscovery("", vi.fn<typeof fetch>().mockRejectedValue(new Error()));
    expect(startErrorMessage(offline as Extract<typeof offline, { ok: false }>, en)).toMatch(
      /Could not reach the server/,
    );
    const html = await startDiscovery(
      "",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>", { status: 502 })),
    );
    expect(startErrorMessage(html as Extract<typeof html, { ok: false }>, en)).toBe(
      "Something went wrong (502). Try again in a moment.",
    );
  });

  it("tells a lost sign-in apart from errors worth retrying", async () => {
    const answer = (status: number, body: unknown = {}) =>
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
    expect(await fetchStatus(answer(401, { error: "unauthorized" }))).toEqual({
      kind: "unauthorized",
    });
    expect(await fetchStatus(answer(500))).toEqual({ kind: "error" });
    expect(await fetchStatus(vi.fn<typeof fetch>().mockRejectedValue(new Error()))).toEqual({
      kind: "error",
    });
    expect(await fetchStatus(answer(200, { canStart: true }))).toEqual({
      kind: "ok",
      status: { canStart: true },
    });
  });

  it("waits longer after each failure in a row, up to a minute", () => {
    expect([0, 1, 2, 3, 4, 10].map(pollDelay)).toEqual([
      5_000, 10_000, 20_000, 40_000, 60_000, 60_000,
    ]);
  });

  it("counts keywords like the server: commas of both widths, 、 and new lines", () => {
    expect(countKeywords("")).toBe(0);
    expect(countKeywords(" a , A,, b\nc ")).toBe(3);
    const text = "頸部按摩器，寵物梳、led mask";
    expect(countKeywords(text)).toBe(3);
    expect(countKeywords(text)).toBe(parseKeywords(text)!.length);
    expect(hasLongKeyword("a, " + "x".repeat(61))).toBe(true);
    expect(hasLongKeyword("x".repeat(60))).toBe(false);
  });

  it("sorts raw source errors into kinds the page can explain", () => {
    expect(
      classifyError(
        "1 of 20 products failed: Shopify Catalog error: Service error. Please try again later.",
      ),
    ).toBe("service");
    expect(classifyError("Ad Library blocked the request (login required)")).toBe("blocked");
    expect(classifyError("HTTP 429 Too Many Requests")).toBe("rate_limited");
    expect(classifyError("The operation was aborted due to timeout")).toBe("timeout");
    expect(classifyError("fetch failed: getaddrinfo ENOTFOUND www.facebook.com")).toBe("network");
    expect(classifyError("Unexpected token < in JSON")).toBe("other");
  });
});
