import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convertCents, FxError, parseEcbDaily } from "./fx";

const xml = fs.readFileSync(
  path.resolve(__dirname, "../ingestion/sources/__recordings__/ecb-eurofxref-daily.xml"),
  "utf8",
);

describe("parseEcbDaily (recorded ECB response)", () => {
  it("reads the date and every target-market currency", () => {
    const rates = parseEcbDaily(xml);
    expect(rates.date).toBe("2026-10-09");
    for (const c of ["EUR", "USD", "CAD", "GBP", "AUD", "NZD", "SEK", "NOK"]) {
      expect(rates.perEur[c], c).toBeGreaterThan(0);
    }
    expect(rates.perEur.USD).toBe(1.1206);
  });

  it("rejects responses without rates", () => {
    expect(() => parseEcbDaily("<xml/>")).toThrow(FxError);
  });
});

describe("convertCents", () => {
  const rates = { date: "2026-10-09", perEur: { EUR: 1, USD: 1.1206, GBP: 0.84763 } };

  it("converts through EUR", () => {
    expect(convertCents(3000, "GBP", "USD", rates)).toBe(3966);
    expect(convertCents(1120, "USD", "EUR", rates)).toBe(999);
    expect(convertCents(500, "USD", "USD", rates)).toBe(500);
  });

  it("returns null for unknown currencies", () => {
    expect(convertCents(100, "XYZ", "USD", rates)).toBeNull();
  });
});
