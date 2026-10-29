// Web edition audit orchestration (edge runtime).
// Reuses audit-core's pure check builders. Differences vs the extension:
//   - JSON-LD blocks are extracted from server HTML via regex (no DOMParser),
//     matching the extension's <script type="application/ld+json"> selector.
//   - The UA probe sets the User-Agent header directly: unlike browsers, the
//     Workers/Node fetch runtimes allow it. Bots run in parallel (server-side
//     tool, the extension's serial+jitter anti-rate-limit pacing is not needed).
//   - CSR content-loss uses a no-renderer estimate: the visible text volume of
//     the server HTML (what non-JS AI crawlers see), reusing the page fetch.

import {
  AI_BOTS,
  aggregateProbeStatus,
  buildCsrEstimate,
  buildLlmsTxtCheck,
  buildRobotsCheck,
  classifyProbe,
  describeDiff,
  parseJsonLdBlocks,
  type AuditReport,
  type CsrCheck,
  type JsonLdCheck,
  type LlmsFetchOutcome,
  type ProbeBaseline,
  type ProbeCheck,
  type ProbeResult,
  type RobotsFetchOutcome,
} from "@geo-auditor/audit-core";

export const FETCH_TIMEOUT_MS = 10_000;

// Server fetches have no browser UA; a Chrome UA is the fair baseline the bot
// probes are compared against.
const BASELINE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface FetchResult {
  httpStatus: number;
  contentType: string;
  finalUrl: string;
  redirected: boolean;
  body: string;
}

function errorText(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return "请求超时";
  }
  return err instanceof Error ? err.message : String(err);
}

async function fetchWithTimeout(url: string, ua: string): Promise<FetchResult> {
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": ua },
  });
  const finalUrl = res.url || url;
  const redirected = finalUrl.replace(/\/$/, "") !== url.replace(/\/$/, "");
  return {
    httpStatus: res.status,
    contentType: res.headers.get("content-type") ?? "",
    finalUrl,
    redirected,
    body: await res.text(),
  };
}

async function fetchRobotsCheck(url: URL) {
  let outcome: RobotsFetchOutcome;
  try {
    const { httpStatus, contentType, body } = await fetchWithTimeout(
      `${url.origin}/robots.txt`,
      BASELINE_UA,
    );
    outcome = { httpStatus, contentType, body };
  } catch (err) {
    outcome = { fetchError: errorText(err) };
  }
  return buildRobotsCheck(outcome, url.pathname || "/");
}

async function fetchLlmsTxtCheck(url: URL) {
  let outcome: LlmsFetchOutcome;
  try {
    const { httpStatus, contentType, body } = await fetchWithTimeout(
      `${url.origin}/llms.txt`,
      BASELINE_UA,
    );
    outcome = { httpStatus, contentType, body };
  } catch (err) {
    outcome = { fetchError: errorText(err) };
  }
  return buildLlmsTxtCheck(outcome);
}

// Same selector semantics as the extension collector's
// `script[type="application/ld+json"]`, tolerant of quote style and spacing.
const JSONLD_SCRIPT_RE =
  /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

function extractJsonLdBlocks(html: string): string[] {
  return [...html.matchAll(JSONLD_SCRIPT_RE)]
    .map((m) => m[1].trim())
    .filter((raw) => raw !== "");
}

async function probeCheck(
  target: string,
  page: { httpStatus: number; finalUrl: string; redirected: boolean; body: string } | { fetchError: string },
): Promise<ProbeCheck> {
  let baseline: ProbeBaseline;
  if ("fetchError" in page) {
    baseline = {
      httpStatus: 0,
      finalUrl: target,
      redirected: false,
      bodySnippet: "",
      verdict: "error",
      fetchError: page.fetchError,
    };
  } else {
    const { verdict } = classifyProbe(page.httpStatus, page.body);
    baseline = {
      httpStatus: page.httpStatus,
      finalUrl: page.finalUrl,
      redirected: page.redirected,
      bodySnippet: page.body.slice(0, 200),
      verdict,
    };
  }

  const bots = AI_BOTS.filter((b) => b.ua);
  const results: ProbeResult[] = await Promise.all(
    bots.map(async (bot): Promise<ProbeResult> => {
      try {
        const attempt = await fetchWithTimeout(target, bot.ua as string);
        const { verdict, note } = classifyProbe(attempt.httpStatus, attempt.body);
        return {
          token: bot.token,
          vendor: bot.vendor,
          category: bot.category,
          httpStatus: attempt.httpStatus,
          finalUrl: attempt.finalUrl,
          redirected: attempt.redirected,
          bodySnippet: attempt.body.slice(0, 200),
          verdict,
          note,
          diff: describeDiff(baseline, { verdict, httpStatus: attempt.httpStatus }),
        };
      } catch (err) {
        return {
          token: bot.token,
          vendor: bot.vendor,
          category: bot.category,
          httpStatus: 0,
          finalUrl: target,
          redirected: false,
          bodySnippet: "",
          verdict: "error",
          fetchError: errorText(err),
          diff: "请求失败",
        };
      }
    }),
  );

  return { status: aggregateProbeStatus(results), targetUrl: target, baseline, results };
}

export async function runWebAudit(url: URL): Promise<AuditReport> {
  // One page fetch serves both the JSON-LD extraction and the probe baseline.
  const pagePromise = fetchWithTimeout(url.href, BASELINE_UA).catch(
    (err): { fetchError: string } => ({ fetchError: errorText(err) }),
  );

  const [robots, llmsTxt] = await Promise.all([
    fetchRobotsCheck(url),
    fetchLlmsTxtCheck(url),
  ]);

  const page = await pagePromise;
  let jsonLd: JsonLdCheck;
  if ("fetchError" in page) {
    jsonLd = {
      status: "fail",
      blockCount: 0,
      invalidCount: 0,
      typeCounts: [],
      error: `页面读取失败（${page.fetchError}）`,
    };
  } else {
    jsonLd = parseJsonLdBlocks(extractJsonLdBlocks(page.body));
  }

  const probe = await probeCheck(url.href, page);

  // Page fetch failed → nothing to estimate from; otherwise estimate from the
  // server HTML already fetched for JSON-LD/baseline.
  const csr: CsrCheck =
    "fetchError" in page
      ? {
          status: "warn",
          serverChars: 0,
          renderedChars: 0,
          serverLines: 0,
          renderedLines: 0,
          overlapLines: 0,
          overlapRate: 0,
          heavyCsr: false,
          injectedSamples: [],
          skipped: true,
          error: "页面读取失败，内容流失无法估算：建议使用浏览器扩展检测",
        }
      : buildCsrEstimate(page.body);

  return { url: url.href, origin: url.origin, auditedAt: Date.now(), robots, llmsTxt, jsonLd, probe, csr };
}
