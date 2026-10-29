// Pure classification of UA probe responses (M3).
// No chrome APIs — unit-testable. Chinese strings here are UI copy shown
// directly in the popup, consistent with the other core modules.

import type { CheckStatus, ProbeResult, ProbeVerdict } from "./types";

// Body signatures of common challenge/interstitial pages (case-insensitive).
export const CHALLENGE_SIGNATURES = ["just a moment", "captcha", "challenge"] as const;

// Bodies shorter than this on a 2xx response look like a challenge/blank
// interstitial rather than the real page.
const CHALLENGE_MIN_BODY_CHARS = 200;

// Challenge interstitials (Cloudflare "Just a moment", custom WAF pages) are
// small. Weak signatures like "challenge"/"captcha" only count below this
// size: full page HTML routinely contains those words in scripts and copy,
// which would false-positive every probe (observed on yoast.com).
const INTERSTITIAL_MAX_CHARS = 10000;

// Distinctive titles of known challenge interstitials (case-insensitive).
const CHALLENGE_TITLES = ["just a moment", "attention required"] as const;

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

export function extractTitle(body: string): string {
  const match = TITLE_RE.exec(body);
  return match ? match[1].trim() : "";
}

export interface ProbeClassification {
  verdict: ProbeVerdict;
  note?: string;
}

export function classifyProbe(httpStatus: number, body: string): ProbeClassification {
  if (httpStatus === 403 || httpStatus === 429 || httpStatus === 503) {
    return { verdict: "blocked", note: `HTTP ${httpStatus}` };
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    const trimmed = body.trim();
    if (trimmed.length < CHALLENGE_MIN_BODY_CHARS) {
      return { verdict: "challenge", note: "正文过短（<200 字符），疑似挑战页" };
    }
    const title = extractTitle(body).toLowerCase();
    const titleHit = CHALLENGE_TITLES.find((s) => title.includes(s));
    if (titleHit) {
      return { verdict: "challenge", note: `页面标题为挑战页签名「${titleHit}」` };
    }
    if (trimmed.length < INTERSTITIAL_MAX_CHARS) {
      const lower = body.toLowerCase();
      const hit = CHALLENGE_SIGNATURES.find((s) => lower.includes(s));
      if (hit) {
        return { verdict: "challenge", note: `短正文中含挑战页签名「${hit}」` };
      }
    }
    return { verdict: "accessible" };
  }
  // Other statuses (404, 500...) are not WAF blocking per se; surface them
  // via the status column, verdict stays "accessible".
  if (httpStatus !== 200) {
    return { verdict: "accessible", note: `非常规状态码 HTTP ${httpStatus}` };
  }
  return { verdict: "accessible" };
}

export function describeDiff(
  baseline: { verdict: ProbeVerdict; httpStatus: number },
  result: { verdict: ProbeVerdict; httpStatus: number },
): string {
  if (baseline.verdict === "error") return "基线失败，无法对比";
  if (result.verdict === "error") return "请求失败";
  if (result.httpStatus !== baseline.httpStatus) {
    return `状态码 ${baseline.httpStatus} → ${result.httpStatus}`;
  }
  if (result.verdict !== baseline.verdict) return "状态码相同但判定不同";
  return "与基线一致";
}

// Module status: blocking a search bot means invisible in AI search (fail);
// blocking training/user bots is a deliberate choice many sites make (warn);
// transport errors alone are also warn (inconclusive, not site's fault).
export function aggregateProbeStatus(results: ProbeResult[]): CheckStatus {
  const affected = results.filter(
    (r) => r.verdict === "blocked" || r.verdict === "challenge",
  );
  if (affected.some((r) => r.category === "search")) return "fail";
  if (affected.length > 0 || results.some((r) => r.verdict === "error")) return "warn";
  return "pass";
}
