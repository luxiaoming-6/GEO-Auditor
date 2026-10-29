import { describe, expect, it } from "vitest";
import { relativeTimeZh, sparklinePoints } from "../src/shared/format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTimeZh", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");

  it.each([
    [0, "刚刚"],
    [30_000, "刚刚"],
    [5 * MINUTE, "5 分钟前"],
    [3 * HOUR, "3 小时前"],
    [2 * DAY, "2 天前"],
    [29 * DAY, "29 天前"],
  ])("formats %i ms ago", (diff, expected) => {
    expect(relativeTimeZh(now, now - diff)).toBe(expected);
  });

  it("falls back to a date string beyond 30 days", () => {
    expect(relativeTimeZh(now, now - 40 * DAY)).toBe(
      new Date(now - 40 * DAY).toLocaleDateString("zh-CN"),
    );
  });

  it("clamps future timestamps to 刚刚", () => {
    expect(relativeTimeZh(now, now + 10 * MINUTE)).toBe("刚刚");
  });
});

describe("sparklinePoints", () => {
  const W = 288;
  const H = 80;
  const PAD = 10;

  it("returns no points for empty input", () => {
    expect(sparklinePoints([], W, H, PAD)).toEqual([]);
  });

  it("centers a single value horizontally", () => {
    const [p] = sparklinePoints([50], W, H, PAD);
    expect(p.x).toBe(W / 2);
    expect(p.y).toBe(H - PAD - 0.5 * (H - 2 * PAD));
  });

  it("spreads values evenly with 100 on top and 0 at the bottom", () => {
    const pts = sparklinePoints([0, 100], W, H, PAD);
    expect(pts[0]).toEqual({ x: PAD, y: H - PAD });
    expect(pts[1]).toEqual({ x: W - PAD, y: PAD });
  });

  it("clamps out-of-range scores", () => {
    const pts = sparklinePoints([-20, 150], W, H, PAD);
    expect(pts[0].y).toBe(H - PAD);
    expect(pts[1].y).toBe(PAD);
  });
});
