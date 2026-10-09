import { describe, expect, it, vi } from "vitest";
import { createRateLimiter, fetchWithRetry, HttpError } from "./http";

function respond(status: number, headers: Record<string, string> = {}) {
  return new Response(status === 200 ? "ok" : "err", { status, headers });
}

describe("fetchWithRetry", () => {
  it("retries 5xx with exponential backoff and returns the eventual success", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(503))
      .mockResolvedValueOnce(respond(502))
      .mockResolvedValueOnce(respond(200));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    const res = await fetchWithRetry("https://x.test", {}, { fetchImpl, sleep, baseDelayMs: 100 });

    expect(res.status).toBe(200);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  it("honors Retry-After on 429", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(429, { "retry-after": "7" }))
      .mockResolvedValueOnce(respond(200));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    await fetchWithRetry("https://x.test", {}, { fetchImpl, sleep });

    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("does not retry 4xx client errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(respond(403));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    await expect(fetchWithRetry("https://x.test", {}, { fetchImpl, sleep })).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured retries", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(respond(500));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    await expect(
      fetchWithRetry("https://x.test", {}, { fetchImpl, sleep, retries: 2 }),
    ).rejects.toMatchObject({ status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries network errors", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(respond(200));

    const res = await fetchWithRetry("https://x.test", {}, { fetchImpl, sleep: async () => {} });
    expect(res.ok).toBe(true);
  });
});

describe("createRateLimiter", () => {
  it("spaces consecutive calls by the interval", async () => {
    let clock = 1000;
    const slept: number[] = [];
    const wait = createRateLimiter(
      250,
      () => clock,
      async (ms) => {
        slept.push(ms);
      },
    );

    await wait();
    await wait();
    await wait();
    clock += 1000;
    await wait();

    expect(slept).toEqual([250, 500]);
  });
});
