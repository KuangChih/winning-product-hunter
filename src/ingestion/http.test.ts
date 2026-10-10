import { describe, expect, it, vi } from "vitest";
import { createRateLimiter, defaultSleep, fetchWithRetry, HttpError } from "./http";

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

    expect(sleep.mock.calls[0][0]).toBe(7000);
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

describe("timeouts and aborts", () => {
  it("retries an attempt that times out, then gives up with the timeout", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const err = await fetchWithRetry(
      "https://x.test",
      {},
      { fetchImpl, sleep: async () => {}, retries: 1, timeoutMs: 20 },
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "TimeoutError" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the caller aborts, and aborts a pending backoff", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      controller.abort(new Error("time budget"));
      return respond(503);
    });
    const started = Date.now();
    await expect(
      fetchWithRetry(
        "https://x.test",
        { signal: controller.signal },
        { fetchImpl, baseDelayMs: 60_000, maxDelayMs: 60_000 },
      ),
    ).rejects.toThrow("time budget");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("defaultSleep rejects as soon as the signal aborts", async () => {
    const controller = new AbortController();
    const pending = defaultSleep(60_000, controller.signal);
    controller.abort(new Error("stop"));
    await expect(pending).rejects.toThrow("stop");
  });
});

describe("createRateLimiter across processes", () => {
  it("starts from a saved next-request time, clamped to one interval from now", async () => {
    const slept: number[] = [];
    const sleep = async (ms: number) => {
      slept.push(ms);
    };
    await createRateLimiter(5000, () => 1000, sleep, 3000)();
    // A saved time far in the future (another machine's clock) waits one interval at most.
    await createRateLimiter(5000, () => 1000, sleep, 999_999)();
    // A saved time in the past does not wait.
    await createRateLimiter(5000, () => 1000, sleep, 500)();
    expect(slept).toEqual([2000, 5000]);
  });

  it("rejects when its signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(createRateLimiter(5000)(controller.signal)).rejects.toThrow("stop");
  });
});
