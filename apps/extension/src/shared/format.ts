// Pure formatting helpers shared by popup, tests, and future surfaces.

export function relativeTimeZh(now: number, timestamp: number): string {
  const diff = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(timestamp).toLocaleDateString("zh-CN");
}

export interface SparkPoint {
  x: number;
  y: number;
}

// Evenly spaced points for a 0–100 score sparkline; y is inverted so 100 is
// on top. A single value is centered horizontally.
export function sparklinePoints(
  values: number[],
  width: number,
  height: number,
  pad: number,
): SparkPoint[] {
  if (values.length === 0) return [];
  const clamped = values.map((v) => Math.min(100, Math.max(0, v)));
  if (clamped.length === 1) {
    return [
      {
        x: width / 2,
        y: height - pad - (clamped[0] / 100) * (height - 2 * pad),
      },
    ];
  }
  const step = (width - 2 * pad) / (clamped.length - 1);
  return clamped.map((v, i) => ({
    x: pad + i * step,
    y: height - pad - (v / 100) * (height - 2 * pad),
  }));
}
