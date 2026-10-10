import { describe, expect, it } from "vitest";
import { formatAgo, formatUtc } from "./format";

const NOW = new Date("2026-10-11T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe("formatAgo", () => {
  it("says today, days, months and years in each language", () => {
    expect(formatAgo(ago(0.2), NOW, "en")).toBe("today");
    expect(formatAgo(ago(1), NOW, "en")).toBe("yesterday");
    expect(formatAgo(ago(3), NOW, "en")).toBe("3 days ago");
    expect(formatAgo(ago(65), NOW, "en")).toBe("2 months ago");
    expect(formatAgo(ago(800), NOW, "en")).toBe("2 years ago");
    expect(formatAgo(ago(0), NOW, "zh-TW")).toBe("今天");
    expect(formatAgo(ago(3), NOW, "zh-TW")).toBe("3 天前");
  });

  it("never says a time in the future", () => {
    expect(formatAgo(new Date(NOW.getTime() + 3_600_000), NOW, "en")).toBe("today");
  });
});

describe("formatUtc", () => {
  it("formats in UTC and shows a dash when missing", () => {
    expect(formatUtc(new Date("2026-10-10T12:09:08Z"))).toBe("2026-10-10 12:09 UTC");
    expect(formatUtc(null)).toBe("—");
  });
});
