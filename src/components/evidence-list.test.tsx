import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EvidenceItem } from "@/data/product-detail";
import { EvidenceList } from "./evidence-list";

const NOW = new Date("2026-10-09T00:00:00Z");
const base: EvidenceItem = {
  id: "x",
  source: "meta_ads",
  provider: "fixture",
  kind: "ad",
  title: null,
  url: null,
  region: null,
  advertiserName: null,
  format: null,
  startedAt: null,
  endedAt: null,
  priceCents: null,
  currency: null,
  metrics: {},
  series: {},
};

describe("EvidenceList", () => {
  it("shows ad running days and status, the trend sparkline and supplier price", () => {
    render(
      <EvidenceList
        now={NOW}
        evidence={[
          {
            ...base,
            id: "a",
            advertiserName: "Paw Store 1",
            format: "video",
            startedAt: new Date("2026-09-21T00:00:00Z"),
            url: "https://www.facebook.com/ads/archive/render_ad/?id=1",
          },
          {
            ...base,
            id: "b",
            advertiserName: "Paw Store 2",
            startedAt: new Date("2026-08-01T00:00:00Z"),
            endedAt: new Date("2026-09-01T00:00:00Z"),
          },
          {
            ...base,
            id: "t",
            source: "google_trends",
            kind: "trend",
            title: "cleaner cup",
            region: "US",
            series: {
              search_interest: [
                { observedAt: new Date("2026-09-01"), value: 10 },
                { observedAt: new Date("2026-09-08"), value: 30 },
              ],
            },
          },
          {
            ...base,
            id: "l",
            source: "aliexpress",
            kind: "listing",
            priceCents: 380,
            currency: "USD",
            metrics: { orders_recent: 1300 },
          },
        ]}
      />,
    );

    expect(screen.getByText("Ads (2)")).toBeInTheDocument();
    expect(screen.getByText(/18 days · active/)).toBeInTheDocument();
    expect(screen.getByText(/31 days · stopped/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View ad" })).toHaveAttribute("target", "_blank");
    expect(
      screen.getByRole("img", { name: "Search interest for cleaner cup" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Price 3\.80 USD · 1,300 recent orders/)).toBeInTheDocument();
  });

  it("says when there is no evidence", () => {
    render(<EvidenceList now={NOW} evidence={[]} />);
    expect(screen.getByText("No evidence collected yet.")).toBeInTheDocument();
  });
});
