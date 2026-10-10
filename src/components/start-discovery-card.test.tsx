import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/i18n/dictionaries";
import { pipelineStatus, runProgress, step, STEPS } from "@/pipeline/testing/progress";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { StartDiscoveryCard } from "./start-discovery-card";

const en = getDictionary("en");
const zh = getDictionary("zh-TW");

describe("StartDiscoveryCard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers to start discovery and opens the discovery page once it started", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { ok: true, created: true, ignoredOptions: false, progress: {} },
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <StartDiscoveryCard
        title={en.ranking.noneTitle}
        body={en.ranking.noneBody}
        status={pipelineStatus()}
        labels={en.discover}
      />,
    );
    expect(screen.getByRole("heading", { name: "No products yet" })).toBeInTheDocument();
    // Plain language for the owner: no commands or config files.
    expect(screen.queryByText(/npm run|\.env/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start discovery" }));
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pipeline/start");
    // Rotating keywords: an empty body.
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({});
    expect(router.push).toHaveBeenCalledWith("/discover");
    expect(router.refresh).toHaveBeenCalled();
    // Not stuck on "Starting…" when the user comes back to this page (kept alive by "back").
    expect(screen.getByRole("button", { name: "Start discovery" })).toBeEnabled();
  });

  it("links to the progress while a run is active", () => {
    const run = runProgress({
      currentStep: "collect",
      steps: STEPS.map((n) => (n === "collect" ? step(n, { status: "running" }) : step(n))),
    });
    render(
      <StartDiscoveryCard
        title={zh.ads.noneTitle}
        body={zh.ads.noneBody}
        status={pipelineStatus({ run })}
        labels={zh.discover}
      />,
    );
    expect(screen.getByText(/探索進行中 · 到 Shopify 查售價與競爭狀況/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看進度" })).toHaveAttribute("href", "/discover");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says why discovery cannot start here", () => {
    render(
      <StartDiscoveryCard
        title={en.ranking.noneTitle}
        body={en.ranking.noneBody}
        status={pipelineStatus({ canStart: false, startBlockedReason: "no_database" })}
        labels={en.discover}
        heading="h3"
      />,
    );
    expect(screen.getByRole("heading", { level: 3, name: "No products yet" })).toBeInTheDocument();
    expect(screen.getByText(/No database is connected yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the discovery page" })).toHaveAttribute(
      "href",
      "/discover",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
