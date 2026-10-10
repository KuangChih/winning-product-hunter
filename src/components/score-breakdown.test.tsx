import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ScoreBreakdown as Breakdown } from "@/scoring/score";
import { ScoreBreakdown } from "./score-breakdown";

const breakdown = {
  subScores: {
    longevity: { value: 0.83, weight: 0.15, raw: 0.83, basis: "Stored English explanation." },
    margin: { value: null, weight: 0.15, raw: null, basis: "Needs a supplier cost." },
  },
  corroboration: 1.1,
  sources: ["meta_ads", "shopify"],
  saturation: { penalty: 0.18, activeAdvertisers: 1, sellingStores: 18, ageDays: 54 },
  capped: false,
} as unknown as Breakdown;

describe("ScoreBreakdown", () => {
  it("shows the explanation stored with the score in English", () => {
    render(<ScoreBreakdown breakdown={breakdown} locale="en" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Ad longevity");
    expect(rows[0]).toHaveTextContent("weight 15%");
    expect(within(rows[0]).getByText("83")).toBeInTheDocument();
    // Missing data is a dash (and "No data" for screen readers), never an estimated number.
    expect(within(rows[1]).getByText("—")).toBeInTheDocument();
    expect(within(rows[1]).getByText("No data")).toHaveClass("sr-only");
    // The explanation folds away in a native disclosure.
    expect(screen.getByText("Stored English explanation.").closest("details")).not.toBeNull();
    expect(screen.getByText("Stored English explanation.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "−18% (1 active advertisers, 18 stores selling similar products, 54 days old)",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("×1.10 (2 sources)")).toBeInTheDocument();
  });

  it("translates labels and explains the method in Traditional Chinese", () => {
    render(<ScoreBreakdown breakdown={breakdown} locale="zh-TW" />);
    expect(screen.getAllByText("計算方式")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("廣告持久度");
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("權重 15%");
    expect(screen.getByText("沒有資料")).toBeInTheDocument();
    expect(screen.queryByText("Stored English explanation.")).toBeNull();
    expect(screen.getByText(/投放最久的 3 則廣告/)).toBeInTheDocument();
    expect(
      screen.getByText("−18%（1 個投放中的廣告主、18 家店賣同類商品，已出現 54 天）"),
    ).toBeInTheDocument();
    expect(screen.getByText("未套用")).toBeInTheDocument();
  });

  it("fills stored explanation codes with the score's own numbers in each language", () => {
    const coded = {
      ...breakdown,
      subScores: {
        momentum: {
          value: null,
          weight: 0.15,
          raw: null,
          basis: "Needs 5+ days of daily ad history (have 1).",
          explain: { key: "momentumNeedsHistory", params: { need: 5, have: 1 } },
        },
      },
    } as unknown as Breakdown;
    const { unmount } = render(<ScoreBreakdown breakdown={coded} locale="zh-TW" />);
    expect(screen.getByText("需要至少 5 天的每日廣告紀錄（目前 1 天）。")).toBeInTheDocument();
    unmount();
    render(<ScoreBreakdown breakdown={coded} locale="en" />);
    expect(screen.getByText("Needs 5+ days of daily ad history (have 1).")).toBeInTheDocument();
  });
});
