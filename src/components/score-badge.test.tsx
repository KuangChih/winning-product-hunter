import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreBadge, scoreLevel } from "./score-badge";

describe("ScoreBadge", () => {
  it("colors by the rounded score: 70+ high, 50–69 medium, else low", () => {
    expect(scoreLevel(70)).toBe("high");
    expect(scoreLevel(69.5)).toBe("high"); // shown as 70
    expect(scoreLevel(69.4)).toBe("medium");
    expect(scoreLevel(50)).toBe("medium");
    expect(scoreLevel(49.4)).toBe("low");
    expect(scoreLevel(0)).toBe("low");
  });

  it("shows the whole-number score", () => {
    render(<ScoreBadge score={73.4} />);
    expect(screen.getByText("73")).toHaveAttribute("data-level", "high");
  });
});
