import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarginEstimate } from "./margin-estimate";

describe("MarginEstimate", () => {
  it("shows retail, supplier cost and gross margin", () => {
    render(
      <MarginEstimate
        estimate={{
          retailUsdCents: 2500,
          retailOffers: 3,
          supplierUsdCents: 600,
          supplierListings: 2,
          grossProfitUsdCents: 1900,
          grossMargin: 0.76,
          missing: [],
        }}
      />,
    );
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText("$6.00")).toBeInTheDocument();
    expect(screen.getByText("76%")).toBeInTheDocument();
    expect(screen.getByText("$19.00 per unit")).toBeInTheDocument();
    expect(screen.getByText(/Before shipping/)).toBeInTheDocument();
  });

  it("says what is missing when the estimate is incomplete", () => {
    render(
      <MarginEstimate
        estimate={{
          retailUsdCents: 2500,
          retailOffers: 1,
          supplierUsdCents: null,
          supplierListings: 0,
          grossProfitUsdCents: null,
          grossMargin: null,
          missing: ["a supplier cost (CJ Dropshipping listing)"],
        }}
      />,
    );
    expect(screen.getByText("Median of 1 store offer")).toBeInTheDocument();
    expect(
      screen.getByText(/needs a supplier cost \(CJ Dropshipping listing\)/),
    ).toBeInTheDocument();
  });
});
