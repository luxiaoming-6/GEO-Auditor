// Thin wrapper over the Baidu Tongji event queue. Safe to call anywhere:
// no-ops on the server, before the script loads, or when blocked by
// Adblock-style extensions (window._hmt missing / push throwing).

export function trackEvent(
  category: string,
  action: string,
  label?: string,
  value?: number,
): void {
  if (typeof window === "undefined" || !window._hmt) return;
  try {
    window._hmt.push(["_trackEvent", category, action, label, value]);
  } catch {
    // Silently ignore — analytics must never break the UI.
  }
}
