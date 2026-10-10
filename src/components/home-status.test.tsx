import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RankedProduct } from "@/data/products";
import { getDictionary } from "@/i18n/dictionaries";
import { pipelineStatus, runProgress, step, STEPS } from "@/pipeline/testing/progress";
import { StatusStrip } from "./home-status";

const ranked = [
  { id: "1", computedAt: new Date("2026-10-10T12:09:08Z") },
  { id: "2", computedAt: new Date("2026-10-10T12:09:08Z") },
] as RankedProduct[];

describe("StatusStrip", () => {
  it("shows the last update, the product count and a way to discover more", () => {
    render(<StatusStrip ranked={ranked} status={pipelineStatus()} dict={getDictionary("en")} />);
    expect(screen.getByRole("region", { name: "Data status" })).toBeInTheDocument();
    expect(screen.getByText("Last update").nextSibling).toHaveTextContent("2026-10-10 12:09 UTC");
    expect(screen.getByText("Ranked products").nextSibling).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: "Discover new products" })).toHaveAttribute(
      "href",
      "/discover",
    );
  });

  it("links to the progress of a running discovery", () => {
    const run = runProgress({
      currentStep: "collect",
      steps: STEPS.map((n) => (n === "collect" ? step(n, { status: "running" }) : step(n))),
    });
    render(
      <StatusStrip
        ranked={ranked}
        status={pipelineStatus({ run })}
        dict={getDictionary("zh-TW")}
      />,
    );
    expect(
      screen.getByRole("link", { name: /探索進行中 · 到 Shopify 查售價與競爭狀況/ }),
    ).toHaveAttribute("href", "/discover");
    expect(screen.getByText("上次更新")).toBeInTheDocument();
  });
});
