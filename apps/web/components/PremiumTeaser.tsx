"use client";

import { useRef, useState } from "react";

// Paid-intent collection. Replace the placeholders below with real values.
const QQ_NUMBER = "1393560815";
// TODO: replace with the real group invite link before release.
const GROUP_URL = "#";

function trackPaidIntent(action: string, domain: string) {
  // Defensive: the Baidu script may be absent (analytics disabled or blocked).
  if (typeof window === "undefined" || typeof window._hmt === "undefined") return;
  try {
    window._hmt.push(["_trackEvent", "付费意愿", action, domain]);
  } catch {
    // Blocked by ad blockers — silently ignore.
  }
}

// Upsell card shown under the report results on /report/{domain}.
export default function PremiumTeaser({ domain }: { domain: string }) {
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2000);
  }

  async function handleWantFeature() {
    trackPaidIntent("点击_想要功能", domain);
    try {
      await navigator.clipboard.writeText(QQ_NUMBER);
      showToast("QQ号已复制，打开QQ搜索添加，备注'GEO监控'优先通过");
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — show the number.
      showToast(`剪贴板不可用，请手动复制QQ号：${QQ_NUMBER}`);
    }
  }

  function handleJoinGroup() {
    trackPaidIntent("点击_加群", domain);
    window.open(GROUP_URL, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="card premium-teaser">
      <header>
        <h2>🔒 想要更深入的分析？</h2>
      </header>
      <ul className="premium-features">
        <li>⭐ 持续监控 —— 每天自动重测，AI 引用变化即时通知</li>
        <li>⭐ AI 优化方案 —— 不止打分，给出逐条整改清单</li>
      </ul>
      <div className="premium-actions">
        <button
          type="button"
          className="premium-button primary"
          onClick={() => void handleWantFeature()}
        >
          💬 我想要这个功能
        </button>
        <button type="button" className="premium-button" onClick={handleJoinGroup}>
          👥 加入交流群
        </button>
      </div>
      {toast !== "" && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </section>
  );
}
