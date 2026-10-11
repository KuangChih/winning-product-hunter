import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/i18n/dictionaries";
import { pipelineStatus, runProgress, step, STEPS } from "@/pipeline/testing/progress";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { DiscoveryPanel } from "./discovery-panel";

const en = getDictionary("en").discover;
const zh = getDictionary("zh-TW").discover;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function panel(status = pipelineStatus(), labels = en) {
  return render(
    <DiscoveryPanel
      initialStatus={status}
      labels={labels}
      locale={labels === en ? "en" : "zh-TW"}
      maxKeywords={10}
    />,
  );
}

describe("DiscoveryPanel", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    router.refresh.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("offers the start button with folded custom keywords when idle", () => {
    panel();
    expect(screen.getByRole("button", { name: "Start discovery" })).toBeEnabled();
    expect(screen.getByText("Custom keywords (optional)")).toBeInTheDocument();
    expect(screen.getByText(/Takes about 10–15 minutes/)).toBeInTheDocument();
    // Nothing is polled while no run is active.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts with custom keywords and shows the steps", async () => {
    const run = runProgress({
      customKeywords: true,
      keywords: ["neck fan", "pet brush"],
      steps: STEPS.map((n) => (n === "fx" ? step(n, { status: "running" }) : step(n))),
    });
    fetchMock.mockResolvedValueOnce(
      json({ ok: true, created: true, ignoredOptions: false, runId: 7, progress: { run } }, 201),
    );
    panel();
    fireEvent.change(screen.getByRole("textbox", { name: "Keywords", hidden: true }), {
      target: { value: "neck fan, pet brush" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start discovery" }));
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/pipeline/start");
    expect(JSON.parse(init!.body as string)).toEqual({ keywords: "neck fan, pet brush" });
    expect(screen.getByRole("heading", { name: "Discovery in progress" })).toBeInTheDocument();
    expect(screen.getByText("Your keywords: neck fan, pet brush")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start discovery" })).toBeNull();
  });

  it("refuses more than the allowed number of keywords before sending", () => {
    panel();
    fireEvent.change(screen.getByRole("textbox", { name: "Keywords", hidden: true }), {
      target: { value: "a,b,c,d,e,f,g,h,i,j,k" },
    });
    expect(screen.getByRole("button", { name: "Start discovery" })).toBeDisabled();
    expect(screen.getByText("At most 10 keywords.")).toBeInTheDocument();
  });

  it("shows why starting failed in the page's language", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "site_password_required" }, 403));
    panel(pipelineStatus(), zh);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "開始探索" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("還沒有設定密碼");
  });

  it("polls every 5 seconds while running, then stops and refreshes when the run finishes", async () => {
    vi.useFakeTimers();
    const running = runProgress({
      steps: STEPS.map((n) =>
        n === "discover" ? step(n, { status: "running", done: 12, total: 50 }) : step(n),
      ),
    });
    const finished = runProgress({
      status: "succeeded",
      finishedAt: "2026-10-11T06:44:00.000Z",
      currentStep: null,
      steps: STEPS.map((n) => step(n, { status: "done" })),
      summary: {
        ...running.summary,
        newProducts: 4,
        newAds: 30,
        adsFetched: 120,
        productsScored: 215,
      },
    });
    fetchMock
      .mockResolvedValueOnce(json(pipelineStatus({ run: running })))
      .mockResolvedValueOnce(json(pipelineStatus({ run: finished })));
    panel(pipelineStatus({ run: running }));
    expect(within(screen.getByRole("list", { name: "Steps" })).getByText("In progress · 12/50"));

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pipeline/status");
    expect(router.refresh).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("4 new products")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the new products" })).toHaveAttribute(
      "href",
      "/products?sort=newest",
    );
    expect(
      screen.getByText("120 ads checked · 30 new ads · 215 products scored"),
    ).toBeInTheDocument();

    // Final: no more polling.
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says honestly when Meta blocks the server and when today's searches are used up", () => {
    const { unmount } = panel(
      pipelineStatus({
        adLibrary: {
          pausedUntil: "2026-10-11T18:00:00.000Z",
          reason: "backoff",
          strikes: 1,
          blockReason:
            'Meta Ad Library [login_wall] Meta asks to log in (status=200; final=https://www.facebook.com/login/; redirected=yes; bytes=40213; title="Log into Facebook"; markers=login_form,login_url)',
          sweepsToday: 1,
          dailySweepCap: 3,
        },
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Meta is blocking this server" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/paused until 2026-10-11 18:00 UTC/)).toBeInTheDocument();
    // CJ keeps discovery going; no "run it on your own computer" advice.
    expect(
      screen.getByText(/searches CJ for products with real supplier sales/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/own computer/)).not.toBeInTheDocument();
    // The official API (UK/EU) is a separate service: it keeps running.
    expect(
      screen.getByText(/official Meta API \(UK\/EU\) is a separate service and keeps running/),
    ).toBeInTheDocument();
    // Which case it was, in plain words, with the diagnostic folded away.
    expect(
      screen.getByText(/Meta asked to log in \(it sent us to a login page\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("Technical details")).toBeInTheDocument();
    expect(screen.getByText(/final=https:\/\/www\.facebook\.com\/login\//)).toBeInTheDocument();
    // The button still works (it refreshes prices and scores).
    expect(screen.getByRole("button", { name: "Start discovery" })).toBeEnabled();
    unmount();

    panel(
      pipelineStatus({
        adLibrary: {
          pausedUntil: null,
          reason: "daily_cap",
          strikes: 0,
          blockReason: null,
          sweepsToday: 3,
          dailySweepCap: 3,
        },
        cjConfigured: false,
        metaApiConfigured: false,
      }),
      zh,
    );
    // Without a token the page says what the official API would add.
    expect(screen.getByText(/加入 META_ACCESS_TOKEN 後/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "今天的 Meta 搜尋次數已用完" })).toBeInTheDocument();
    expect(screen.getByText(/今天已經做了 3\/3 次/)).toBeInTheDocument();
    // Without a CJ key the page says what CJ would add instead of promising it.
    expect(screen.getByText(/加入 CJ_API_KEY/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "開始探索" })).toBeEnabled();
  });

  it("explains a disabled start and a missing daily schedule", () => {
    const { unmount } = panel(
      pipelineStatus({
        canStart: false,
        startBlockedReason: "site_password_required",
        cronConfigured: false,
      }),
    );
    expect(screen.queryByRole("button", { name: "Start discovery" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Discovery cannot start here" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no password yet \(SITE_PASSWORD\)/)).toBeInTheDocument();
    // Nothing can start here, so the daily schedule is beside the point.
    expect(screen.queryByRole("heading", { name: "Daily automatic discovery is off" })).toBeNull();
    unmount();

    const second = panel(pipelineStatus({ cronConfigured: false }));
    expect(
      screen.getByRole("heading", { name: "Daily automatic discovery is off" }),
    ).toBeInTheDocument();
    second.unmount();

    // Turned off entirely (e.g. e2e): say so, without the daily-schedule note.
    panel(
      pipelineStatus({
        canStart: false,
        startBlockedReason: "disabled",
        disabled: true,
        cronConfigured: false,
      }),
    );
    expect(screen.getByText("Discovery is turned off on this deployment.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Daily automatic discovery is off" })).toBeNull();
  });

  it("stops polling when the sign-in expired and links to the login page", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json({ error: "unauthorized" }, 401));
    panel(pipelineStatus({ run: runProgress() }), zh);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.getByRole("alert")).toHaveTextContent("登入已過期");
    expect(screen.getByRole("link", { name: "重新登入" })).toHaveAttribute(
      "href",
      "/login?next=%2Fdiscover",
    );
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("backs off after failures, never overlaps requests, and pauses in a hidden tab", async () => {
    vi.useFakeTimers();
    let answer: (r: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (answer = r)));
    const running = pipelineStatus({ run: runProgress() });
    panel(running);

    // A slow answer: no second request while the first is still open.
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A failure: the next try waits 10 s instead of 5 s.
    await act(async () => answer(new Response("", { status: 503 })));
    expect(screen.getByText("Could not refresh the progress. Retrying…")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => answer(json(running)));

    // Hidden tab: no polls; back in front: one right away.
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    hidden.mockRestore();
  });

  it("explains raw source errors in the page's language, with the original folded away", () => {
    const run = runProgress({
      status: "partial",
      finishedAt: "2026-10-11T06:44:00.000Z",
      currentStep: null,
      steps: STEPS.map((n) =>
        n === "collect"
          ? step(n, {
              status: "done",
              error: "1 of 20 products failed: Shopify Catalog error: Service error.",
            })
          : step(n, { status: "done" }),
      ),
    });
    panel(pipelineStatus({ run }), zh);
    expect(screen.getByText("對方網站暫時出了問題，下次會再試。")).toBeInTheDocument();
    expect(screen.getByText("技術細節")).toBeInTheDocument();
    // Still there for whoever wants it, but folded inside <details>.
    expect(screen.getByText(/Service error/).closest("details")).not.toBeNull();
  });
});
