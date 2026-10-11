import { describe, expect, it } from "vitest";
import type { CjListProduct } from "@/ingestion/sources/cj";
import { addCandidates, candidateDetail, CJ_RULES, cjProductKey, isCjPromising } from "./cj";

const NOW = new Date("2026-10-11T00:00:00Z");
const DAY = 86_400_000;
const p = (id: string, listedNum: number, extra: Partial<CjListProduct> = {}): CjListProduct => ({
  id,
  nameEn: `Product ${id}`,
  sellPrice: "2.47 -- 3.10",
  saleStatus: "3",
  listedNum,
  ...extra,
});

describe("CJ discovery rules", () => {
  it("adds the most-listed qualifying products of a list, within its take and window", () => {
    const first = addCandidates(
      [],
      [p("A", 300), p("B", 10), p("C", 900), p("D", 500, { saleStatus: "2" }), p("F", 100)],
      "trending",
      { take: 2, max: 10 },
    );
    // B is listed by too few CJ users, D is not on sale; C and A are the two most listed.
    expect(first.map((c) => c.id)).toEqual(["C", "A"]);
    expect(first[1]).toMatchObject({ priceCents: 310, foundBy: ["trending"], detail: null });
    // A keyword finding A again only notes it; only its first `window` results count.
    const second = addCandidates(first, [p("A", 300), p("E", 2000), p("G", 5000)], "cat toy", {
      take: 3,
      window: 2,
      max: 3,
    });
    expect(second.map((c) => [c.id, c.foundBy])).toEqual([
      ["C", ["trending"]],
      ["A", ["trending", "cat toy"]],
      ["E", ["cat toy"]],
    ]);
    // The run's detail budget caps the total.
    expect(addCandidates(second, [p("H", 999)], "x", { take: 3, max: 3 })).toHaveLength(3);
    expect(CJ_RULES.minListedForDetail).toBeGreaterThan(10);
    expect(cjProductKey("A")).toBe("cj:A");
  });

  it("tracks only products with enough CJ orders and a recent paid order", () => {
    const [c] = addCandidates([], [p("A", 300)], "trending", { take: 1, max: 10 });
    const detail = (over: Record<string, unknown>) =>
      candidateDetail({
        id: "A",
        listed: 300,
        soldOut: null,
        orderCount: 0,
        latestPaymentDate: null,
        ...over,
      });
    const recent = NOW.getTime() - 3 * DAY;
    expect(isCjPromising(c, NOW)).toBe(false); // no detail: no sales evidence
    expect(
      isCjPromising(
        { ...c, detail: detail({ orderCount: CJ_RULES.minOrders, latestPaymentDate: recent }) },
        NOW,
      ),
    ).toBe(true);
    expect(
      isCjPromising(
        { ...c, detail: detail({ orderCount: CJ_RULES.minOrders - 1, latestPaymentDate: recent }) },
        NOW,
      ),
    ).toBe(false);
    const stale = NOW.getTime() - (CJ_RULES.maxDaysSinceLastOrder + 1) * DAY;
    expect(
      isCjPromising({ ...c, detail: detail({ orderCount: 5000, latestPaymentDate: stale }) }, NOW),
    ).toBe(false);
    // The documented 90-day count wins when CJ fills it.
    expect(
      isCjPromising(
        { ...c, detail: detail({ soldOut: 10, orderCount: 5000, latestPaymentDate: recent }) },
        NOW,
      ),
    ).toBe(false);
    expect(detail({ createdate: "1588790768000" }).createdAt).toBe(1588790768000);
  });
});
