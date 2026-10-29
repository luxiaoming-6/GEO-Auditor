// Pure CSR content-loss comparison (M4).
// No chrome APIs — unit-testable. Chinese strings are UI copy.
//
// The service worker fetches the raw server HTML (normal browser UA) and the
// content script reduces both sides to text: server side via DOMParser (with
// script/style/noscript/svg/template removed), rendered side via
// document.body.innerText. This module compares the two line sequences.

import { diffArrays } from "diff";
import type { CheckStatus, CsrCheck, CsrEstimate } from "./types";

// SPA verdict thresholds (chars of text).
const HEAVY_CSR_SERVER_CHARS = 200;
const HEAVY_CSR_RENDERED_CHARS = 1000;

// How many "rendered-only" lines to surface as JS-injection samples.
const SAMPLE_LIMIT = 10;

export function normalizeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function buildCsrCheck(serverText: string, renderedText: string): CsrCheck {
  const serverLines = normalizeLines(serverText);
  const renderedLines = normalizeLines(renderedText);

  const parts = diffArrays(serverLines, renderedLines);
  let overlapLines = 0;
  const injectedSamples: string[] = [];
  for (const part of parts) {
    if (part.added) {
      for (const line of part.value) {
        if (injectedSamples.length < SAMPLE_LIMIT) injectedSamples.push(line);
      }
    } else if (!part.removed) {
      overlapLines += part.count ?? 0;
    }
  }

  const overlapRate = renderedLines.length === 0 ? 1 : overlapLines / renderedLines.length;

  const heavyCsr =
    serverText.trim().length < HEAVY_CSR_SERVER_CHARS &&
    renderedText.trim().length > HEAVY_CSR_RENDERED_CHARS;

  // Rating: >0.8 pass, 0.5–0.8 warn, <0.5 fail.
  const status: CheckStatus =
    overlapRate > 0.8 ? "pass" : overlapRate >= 0.5 ? "warn" : "fail";

  return {
    status,
    serverChars: serverText.length,
    renderedChars: renderedText.length,
    serverLines: serverLines.length,
    renderedLines: renderedLines.length,
    overlapLines,
    overlapRate,
    heavyCsr,
    injectedSamples,
  };
}

// ---------- Web edition: no-renderer estimate ----------
//
// The edge runtime has no DOMParser and no JS execution for the target page,
// so the web edition cannot reproduce the rendered-DOM comparison above.
// Instead it scores what non-JS AI crawlers actually see: the visible text of
// the server HTML. Regex-based extraction (same strip list as the extension's
// DOMParser path) — inherently approximate, the UI labels it as an estimate.

const HEAD_RE = /<head\b[^>]*>[\s\S]*?<\/head\s*>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const STRIP_BLOCK_RE = /<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BODY_RE = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i;
const TAG_RE = /<[^>]+>/g;
const ENTITY_RE = /&(amp|lt|gt|quot|#39|apos|nbsp);/gi;
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

export function extractServerVisibleText(html: string): string {
  let s = html.replace(HEAD_RE, " ").replace(COMMENT_RE, " ");
  s = s.replace(STRIP_BLOCK_RE, " ");
  const body = BODY_RE.exec(s);
  if (body) s = body[1];
  s = s.replace(TAG_RE, " ");
  s = s.replace(ENTITY_RE, (m) => ENTITIES[m.slice(1).toLowerCase()] ?? " ");
  return s.replace(/\s+/g, " ").trim();
}

// Estimate thresholds mirror the extension's tiers: <200 chars is an empty
// shell, >=1000 chars means crawlers see substantial content.
const ESTIMATE_SHELL_CHARS = HEAVY_CSR_SERVER_CHARS;
const ESTIMATE_RICH_CHARS = HEAVY_CSR_RENDERED_CHARS;

// Script markup larger than this share of the HTML suggests a JS-heavy page.
const SCRIPT_SHARE_THRESHOLD = 0.5;

export function buildCsrEstimate(html: string): CsrCheck {
  const signals: string[] = [];
  const visibleText = extractServerVisibleText(html);
  const visibleChars = visibleText.length;

  if (/enable\s+javascript|请启用\s*javascript|开启\s*javascript/i.test(html)) {
    signals.push("页面提示需启用 JavaScript");
  }
  if (/<(?:div|main|section)[^>]+id=["'](root|app|__next|__nuxt|q-app)["'][^>]*>\s*<\/(?:div|main|section)>/i.test(html)) {
    signals.push("存在 SPA 挂载点空容器");
  }
  let scriptChars = 0;
  for (const m of html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)) {
    scriptChars += m[0].length;
  }
  if (html.length > 0 && scriptChars / html.length > SCRIPT_SHARE_THRESHOLD) {
    signals.push(`脚本内容占 HTML ${Math.round((scriptChars / html.length) * 100)}%`);
  }

  const level: CsrEstimate["level"] =
    visibleChars >= ESTIMATE_RICH_CHARS
      ? "low"
      : visibleChars >= ESTIMATE_SHELL_CHARS
        ? "medium"
        : signals.length > 0
          ? "high"
          : "medium";

  return {
    status: level === "low" ? "pass" : level === "medium" ? "warn" : "fail",
    serverChars: visibleChars,
    renderedChars: 0,
    serverLines: 0,
    renderedLines: 0,
    overlapLines: 0,
    overlapRate: 0,
    heavyCsr: level === "high",
    injectedSamples: [],
    estimate: { visibleChars, htmlChars: html.length, signals, level },
  };
}
