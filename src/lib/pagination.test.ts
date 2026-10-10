import { describe, expect, it } from "vitest";
import { paginate, parsePage } from "./pagination";

const items = Array.from({ length: 65 }, (_, i) => i + 1);

describe("paginate", () => {
  it("slices a page and reports the real total", () => {
    expect(paginate(items, 1, 30)).toMatchObject({
      total: 65,
      page: 1,
      pageCount: 3,
      from: 1,
      to: 30,
    });
    const last = paginate(items, 3, 30);
    expect(last).toMatchObject({ page: 3, from: 61, to: 65 });
    expect(last.items).toEqual([61, 62, 63, 64, 65]);
  });

  it("clamps pages past the end to the last page and bad input to page 1", () => {
    expect(paginate(items, 99, 30).page).toBe(3);
    expect(paginate(items, 0, 30).page).toBe(1);
    expect(paginate(items, Number.NaN, 30).page).toBe(1);
  });

  it("has one empty page for an empty list", () => {
    expect(paginate([], 2, 30)).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageCount: 1,
      from: 0,
      to: 0,
    });
  });

  it("fills exact multiples without an extra page", () => {
    expect(paginate(items.slice(0, 60), 2, 30)).toMatchObject({ pageCount: 2, from: 31, to: 60 });
  });
});

describe("parsePage", () => {
  it("accepts whole numbers from 1 and falls back to page 1", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(["2", "5"])).toBe(2);
    for (const bad of [undefined, "", "0", "-1", "1.5", "abc"]) expect(parsePage(bad)).toBe(1);
  });
});
