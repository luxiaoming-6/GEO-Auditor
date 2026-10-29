// Pure scoring of an audit report (M5).
// No chrome APIs — unit-testable. Chinese strings are UI/export copy.
//
// Total 100 pts:
//   robots.txt 30  — each of the 5 scored bots blocked −6
//   llms.txt   10  — deployed or not
//   JSON-LD    20  — any valid block +10, key @type present +10
//   CSR        25  — overlap >0.8 full, 0.5–0.8 → 12, <0.5 → 0, heavy −5
//   Probe      15  — each blocked/challenged bot −5

import type { AuditReport } from "./types";

// Bots that cost points when disallowed. Google-Extended stays info-only;
// ChatGPT-User / Claude-SearchBot / CCBot / Applebot-Extended are not scored.
const SCORED_ROBOTS_BOTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ClaudeBot",
  "PerplexityBot",
  "Bytespider",
] as const;

const ROBOTS_MAX = 30;
const ROBOTS_DEDUCT_PER_BOT = 6;

// @types that earn the JSON-LD bonus.
const SCORE_KEY_TYPES = ["Organization", "WebSite", "FAQPage", "Product"] as const;

const LLMS_MAX = 10;
const CSR_MAX = 25;
const CSR_HEAVY_DEDUCT = 5;
const PROBE_MAX = 15;
const PROBE_DEDUCT_PER_BOT = 5;

export type Grade = "A" | "B" | "C" | "D";

export interface ScoreBreakdown {
  robots: number;
  llmsTxt: number;
  jsonLd: number;
  csr: number;
  probe: number;
}

export interface ScoreResult {
  total: number;
  grade: Grade;
  // Maximum achievable total. 100 for the extension; 75 when the CSR check
  // is skipped (web edition), so grades stay proportional.
  max: number;
  breakdown: ScoreBreakdown;
  // One actionable Chinese sentence per failed item, in report order.
  suggestions: string[];
}

export function gradeFor(total: number, max = 100): Grade {
  const ratio = total / max;
  if (ratio >= 0.85) return "A";
  if (ratio >= 0.7) return "B";
  if (ratio >= 0.5) return "C";
  return "D";
}

export function buildScore(report: AuditReport): ScoreResult {
  const suggestions: string[] = [];

  // ---------- robots.txt (30) ----------
  const robotsBlocked: string[] = [];
  if (report.robots.exists) {
    for (const bot of report.robots.bots) {
      if (
        (SCORED_ROBOTS_BOTS as readonly string[]).includes(bot.token) &&
        bot.verdict === "disallow"
      ) {
        robotsBlocked.push(bot.token);
      }
    }
  }
  const robots = Math.max(0, ROBOTS_MAX - robotsBlocked.length * ROBOTS_DEDUCT_PER_BOT);
  for (const token of robotsBlocked) {
    suggestions.push(
      `robots.txt 禁止了 ${token}：建议在 robots.txt 为 ${token} 添加 Allow 规则`,
    );
  }
  if (report.robots.fetchError) {
    suggestions.push("robots.txt 读取失败：建议稍后重新检测");
  }

  // ---------- llms.txt (10) ----------
  const llmsTxt = report.llmsTxt.exists ? LLMS_MAX : 0;
  if (!report.llmsTxt.exists) {
    if (report.llmsTxt.fetchError) {
      suggestions.push("llms.txt 读取失败：建议稍后重新检测");
    } else {
      suggestions.push(
        "未部署 llms.txt：建议在站点根路径部署 llms.txt，向 AI 引擎提供内容指引",
      );
    }
  }

  // ---------- JSON-LD (20) ----------
  const validBlocks = report.jsonLd.error
    ? 0
    : Math.max(0, report.jsonLd.blockCount - report.jsonLd.invalidCount);
  let jsonLd = 0;
  if (validBlocks > 0) {
    jsonLd += 10;
    const types = report.jsonLd.typeCounts.map((t) => t.type);
    if ((SCORE_KEY_TYPES as readonly string[]).some((k) => types.includes(k))) {
      jsonLd += 10;
    } else {
      suggestions.push(
        "已检测到 JSON-LD：建议补充 Organization/WebSite/FAQPage/Product 等关键 @type",
      );
    }
  } else if (report.jsonLd.error) {
    suggestions.push("JSON-LD 检测失败：建议刷新页面后重新检测");
  } else {
    suggestions.push(
      "未检测到 JSON-LD 结构化数据：建议添加至少包含 Organization 或 WebSite 的 JSON-LD",
    );
  }

  // ---------- CSR content-loss (25) ----------
  let csr: number;
  if (report.csr.skipped) {
    csr = 0;
    suggestions.push("内容流失检测在 Web 版不可用：建议安装浏览器扩展获取完整评分");
  } else if (report.csr.estimate) {
    // Web edition: estimated from server-visible text (what non-JS AI crawlers
    // see), tiers aligned with the extension's overlap bands.
    const { level } = report.csr.estimate;
    if (level === "low") {
      csr = CSR_MAX;
    } else if (level === "medium") {
      csr = 12;
      suggestions.push(
        "服务端可见正文偏少（估算）：部分内容可能仅存在于渲染后 DOM，建议将核心正文纳入服务端渲染",
      );
    } else {
      csr = 0;
      suggestions.push(
        "疑似 CSR 空壳（估算）：AI 爬虫几乎读不到正文，建议将核心内容改为服务端渲染（SSR/SSG）",
      );
    }
  } else if (report.csr.error) {
    csr = 0;
    suggestions.push("内容流失检测失败：建议刷新页面后重新检测");
  } else if (report.csr.overlapRate > 0.8) {
    csr = CSR_MAX;
  } else if (report.csr.overlapRate >= 0.5) {
    csr = 12;
  } else {
    csr = 0;
  }
  if (
    !report.csr.error &&
    !report.csr.skipped &&
    !report.csr.estimate &&
    report.csr.heavyCsr
  ) {
    csr = Math.max(0, csr - CSR_HEAVY_DEDUCT);
    suggestions.push(
      "重度 CSR 依赖：建议将核心内容改为服务端渲染（SSR/SSG），否则 AI 爬虫只能看到空壳",
    );
  } else if (
    !report.csr.error &&
    !report.csr.skipped &&
    !report.csr.estimate &&
    csr < CSR_MAX
  ) {
    suggestions.push(
      report.csr.overlapRate < 0.5
        ? "大量正文仅存在于渲染后 DOM：建议将关键正文纳入服务端渲染（SSR/SSG）"
        : "部分内容由 JS 注入：建议将核心正文纳入服务端渲染",
    );
  }

  // ---------- UA reachability (15) ----------
  const probeBlocked: string[] = [];
  const probeFailed: string[] = [];
  for (const r of report.probe.results) {
    if (r.verdict === "blocked" || r.verdict === "challenge") probeBlocked.push(r.token);
    else if (r.verdict === "error") probeFailed.push(r.token);
  }
  const probe = Math.max(0, PROBE_MAX - probeBlocked.length * PROBE_DEDUCT_PER_BOT);
  if (probeBlocked.length > 0) {
    suggestions.push(
      `以下 AI 爬虫被服务器拦截或要求挑战：${probeBlocked.join("、")}——如非有意限制，建议检查 WAF/反爬规则对其放行`,
    );
  }
  if (probeFailed.length > 0) {
    suggestions.push(`以下爬虫探测请求失败：${probeFailed.join("、")}，建议重新检测`);
  }
  if (report.probe.error) {
    suggestions.push("UA 可达性探测失败：建议重新检测");
  }

  const breakdown: ScoreBreakdown = { robots, llmsTxt, jsonLd, csr, probe };
  const total = robots + llmsTxt + jsonLd + csr + probe;
  // Skipped CSR (web edition) reduces the achievable maximum accordingly.
  const max = report.csr.skipped ? 100 - CSR_MAX : 100;
  return { total, grade: gradeFor(total, max), max, breakdown, suggestions };
}
