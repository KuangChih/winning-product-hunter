// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { pipelineTickToken } from "@/lib/internal-auth";
import { kickTick, resolveSelfOrigin, TICK_PATH } from "./transport";

describe("self origin allowlist", () => {
  it("uses only the production domain on Vercel", () => {
    const prod = {
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "wph.example.com",
    };
    // The request's Host is ignored: the token never follows a spoofed Host.
    expect(resolveSelfOrigin("https://evil.example", prod)).toBe("https://wph.example.com");
    expect(resolveSelfOrigin(null, prod)).toBe("https://wph.example.com");
    expect(resolveSelfOrigin("https://x", { ...prod, VERCEL_ENV: "preview" })).toBeNull();
    expect(resolveSelfOrigin("https://x", { VERCEL: "1", VERCEL_ENV: "production" })).toBeNull();
    expect(
      resolveSelfOrigin(null, { ...prod, VERCEL_PROJECT_PRODUCTION_URL: "evil.example/x" }),
    ).toBeNull();
  });

  it("allows only loopback origins locally", () => {
    expect(resolveSelfOrigin("http://localhost:3000", {})).toBe("http://localhost:3000");
    expect(resolveSelfOrigin("http://127.0.0.1:3100", {})).toBe("http://127.0.0.1:3100");
    expect(resolveSelfOrigin("http://[::1]:3000", {})).toBe("http://[::1]:3000");
    expect(resolveSelfOrigin("http://evil.example:3000", {})).toBeNull();
    expect(resolveSelfOrigin("http://localhost.evil.example", {})).toBeNull();
    expect(resolveSelfOrigin("file:///etc", {})).toBeNull();
    expect(resolveSelfOrigin("not a url", {})).toBeNull();
    expect(resolveSelfOrigin(null, {})).toBeNull();
  });
});

describe("kickTick", () => {
  const env = { DATABASE_URL: "pglite:./x" };
  const kick = (fetchImpl: typeof fetch) =>
    kickTick({ origin: "http://localhost:3000", runId: 7, env, fetchImpl, timeoutMs: 50 });

  it("POSTs the run id with the derived token to the tick route", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    expect(await kick(fetchImpl)).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`http://localhost:3000${TICK_PATH}`);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    expect(JSON.parse(String(init?.body))).toEqual({ runId: 7 });
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${await pipelineTickToken(env)}`,
    );
  });

  it("maps responses to results", async () => {
    const status = (s: number) => kick(async () => new Response(null, { status: s }));
    expect(await status(200)).toMatchObject({ ok: false, retryable: false, error: /200/ });
    const ok200 = (body: string) => kick(async () => new Response(body, { status: 200 }));
    // The tick route's "run already finished" answer.
    expect(await ok200(JSON.stringify({ accepted: false, status: "succeeded" }))).toEqual({
      ok: true,
    });
    // A firewall page or another app answering 200 is not a hand-off.
    expect(await ok200("<html>challenge</html>")).toMatchObject({ ok: false, retryable: false });
    expect(await ok200(JSON.stringify({ accepted: true }))).toMatchObject({ ok: false });
    expect(await status(508)).toMatchObject({ ok: false, retryable: false, error: /508/ });
    expect(await status(401)).toMatchObject({ ok: false, retryable: false });
    expect(await status(403)).toMatchObject({ ok: false, retryable: false });
    expect(await status(307)).toMatchObject({ ok: false, retryable: false });
    expect(await status(502)).toMatchObject({ ok: false, retryable: true });
    expect(await kick(async () => Promise.reject(new TypeError("fetch failed")))).toMatchObject({
      ok: false,
      retryable: true,
      error: /fetch failed/,
    });
  });

  it("gives up on a next tick that does not answer", async () => {
    const hang: typeof fetch = (_u, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
      );
    expect(await kick(hang)).toMatchObject({ ok: false, retryable: true, error: /did not answer/ });
  });

  it("does not send anything without a secret", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const r = await kickTick({ origin: "http://localhost:3000", runId: 1, env: {}, fetchImpl });
    expect(r).toMatchObject({ ok: false, retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
