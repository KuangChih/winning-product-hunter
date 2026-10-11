import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n/dictionaries";
import { runProgress, step, STEPS } from "@/pipeline/testing/progress";
import { RunProgressView } from "./run-progress";

const en = getDictionary("en").discover;
const zh = getDictionary("zh-TW").discover;

const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("RunProgressView", () => {
  it("shows a running run with done/total and plain-language step names", () => {
    const run = runProgress({
      steps: STEPS.map((n) =>
        n === "fx"
          ? step(n, { status: "done", detail: "31 rates for 2026-10-10" })
          : n === "discover"
            ? step(n, { status: "running", done: 12, total: 50 })
            : step(n),
      ),
    });
    render(<RunProgressView run={run} labels={en} locale="en" />);

    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(steps).toHaveLength(8);
    expect(rowOf("Search Meta ads")).toHaveAttribute("data-status", "running");
    expect(within(rowOf("Search Meta ads")).getByText("In progress · 12/50")).toBeInTheDocument();
    expect(within(rowOf("Update exchange rates")).getByText("Done")).toBeInTheDocument();
    // The runner's English summary is shown on English pages.
    expect(screen.getByText("31 rates for 2026-10-10")).toBeInTheDocument();
    expect(within(rowOf("Score products")).getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Started 2026-10-11 06:30 UTC")).toBeInTheDocument();
    expect(screen.getByText("Keywords: neck fan, pet brush")).toBeInTheDocument();
  });

  it("explains skipped and failed steps in Traditional Chinese", () => {
    const run = runProgress({
      status: "partial",
      finishedAt: "2026-10-11T06:45:00.000Z",
      currentStep: null,
      customKeywords: true,
      keywords: ["posture corrector"],
      steps: STEPS.map((n) =>
        n === "discover"
          ? step(n, { status: "skipped", skipReason: "backoff", detail: "back-off until x" })
          : n === "collect"
            ? step(n, { status: "failed", error: "HTTP 503", done: 3, total: 20 })
            : step(n, { status: "done", detail: "English only" }),
      ),
    });
    render(<RunProgressView run={run} labels={zh} locale="zh-TW" />);

    expect(within(rowOf("搜尋 Meta 廣告")).getByText("已跳過")).toBeInTheDocument();
    expect(
      within(rowOf("搜尋 Meta 廣告")).getByText("Meta 暫時擋下這台伺服器"),
    ).toBeInTheDocument();
    expect(
      within(rowOf("到 Shopify 查售價與競爭狀況")).getByText("失敗 · 3/20"),
    ).toBeInTheDocument();
    // Raw errors stay visible (honest), English summaries are not shown on Chinese pages.
    expect(screen.getByText("HTTP 503")).toBeInTheDocument();
    expect(screen.queryByText("English only")).toBeNull();
    expect(screen.getByText("部分完成")).toBeInTheDocument();
    expect(screen.getByText("2026-10-11 06:45 UTC 完成")).toBeInTheDocument();
    expect(screen.getByText("你的關鍵字：posture corrector")).toBeInTheDocument();
  });

  it("says which Meta case happened (page without ad data is not called a block)", () => {
    const error =
      'Meta Ad Library [results_not_embedded] page has no embedded ad results (status=200; final=https://www.facebook.com/ads/library/; redirected=no; bytes=655040; title="Ad Library"; markers=ad_library_app)';
    const run = runProgress({
      status: "partial",
      currentStep: null,
      steps: STEPS.map((n) =>
        n === "discover"
          ? step(n, { status: "failed", error })
          : n === "advertisers"
            ? step(n, { status: "skipped", skipReason: "meta_unusable" })
            : step(n, { status: "done" }),
      ),
    });
    const { unmount } = render(<RunProgressView run={run} labels={zh} locale="zh-TW" />);
    const row = rowOf("搜尋 Meta 廣告");
    expect(within(row).getByText(/^頁面沒有內嵌廣告資料。這不一定是被擋/)).toBeInTheDocument();
    expect(within(row).queryByText(/被擋）/)).toBeNull();
    expect(within(row).getByText("技術細節")).toBeInTheDocument();
    expect(within(row).getByText(error)).toBeInTheDocument();
    expect(
      within(rowOf("查看廣告主的最新廣告")).getByText(
        "這次執行時 Meta 的頁面沒有可用的廣告資料，已停止 Meta 搜尋",
      ),
    ).toBeInTheDocument();
    unmount();

    render(
      <RunProgressView
        run={runProgress({
          steps: STEPS.map((n) =>
            n === "discover"
              ? step(n, {
                  status: "failed",
                  error: "Meta Ad Library [captcha] Meta asks for a CAPTCHA (status=200)",
                })
              : step(n),
          ),
        })}
        labels={en}
        locale="en"
      />,
    );
    expect(screen.getByText(/^Meta asked for a CAPTCHA/)).toBeInTheDocument();
  });
});
