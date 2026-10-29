// UA reachability probes via DNR session rules (M3).
//
// fetch() cannot set User-Agent (browsers ignore the header), so each probe
// installs a temporary chrome.declarativeNetRequest session rule that rewrites
// the UA of our own xmlhttprequests, fetches, then removes the rule in
// `finally` (a leaked rule would keep rewriting the UA of the user's normal
// browsing). Rule ids come from an auto-increment counter to avoid conflicts.
//
// The rule's regexFilter is anchored to scheme+host of the target URL, so
// same-origin redirects keep matching (a redirect drops query params and
// changes the path). Cross-origin redirects lose the bot UA — the recorded
// finalUrl makes that visible.

import {
  aggregateProbeStatus,
  classifyProbe,
  describeDiff,
  AI_BOTS,
} from "@geo-auditor/audit-core";
import type { ProbeBaseline, ProbeCheck, ProbeResult } from "@geo-auditor/audit-core";
import type { ProbeProgressMessage } from "../shared/protocol";

const PROBE_FETCH_TIMEOUT_MS = 8000;
const DELAY_MIN_MS = 800;
const DELAY_MAX_MS = 1500;

// Probe rule ids live in [PROBE_RULE_BASE, PROBE_RULE_LIMIT). Session rules
// survive service-worker termination, so a crash mid-probe would leak a bot-UA
// rule; the sweep below removes leftovers on every run and at SW startup.
const PROBE_RULE_BASE = 900000;
const PROBE_RULE_LIMIT = 1000000;
let nextRuleId = PROBE_RULE_BASE;

export async function cleanupStaleProbeRules(): Promise<void> {
  const stale = (await chrome.declarativeNetRequest.getSessionRules())
    .map((rule) => rule.id)
    .filter((id) => id >= PROBE_RULE_BASE && id < PROBE_RULE_LIMIT);
  if (stale.length > 0) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stale });
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const jitter = (): Promise<void> =>
  sleep(DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));

function errorText(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return "请求超时";
  }
  return err instanceof Error ? err.message : String(err);
}

function pushProgress(token: string, index: number, total: number): void {
  const message: ProbeProgressMessage = { type: "PROBE_PROGRESS", token, index, total };
  // The popup may be closed; ignore delivery errors.
  chrome.runtime.sendMessage(message).catch(() => {});
}

interface ProbeAttempt {
  httpStatus: number;
  finalUrl: string;
  redirected: boolean;
  body: string;
}

function originRegexFilter(url: string): string {
  const host = new URL(url).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^https?:\\/\\/${host}\\/`;
}

async function fetchAsProbe(url: string): Promise<ProbeAttempt> {
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(PROBE_FETCH_TIMEOUT_MS),
  });
  const body = await res.text();
  const finalUrl = res.url || url;
  // Root URLs get a trailing slash appended by normalization; ignore that.
  const redirected = finalUrl.replace(/\/$/, "") !== url.replace(/\/$/, "");
  return { httpStatus: res.status, finalUrl, redirected, body };
}

// Adds a session rule setting `ua` for our own xmlhttprequests to `url`'s
// origin, fetches, and always removes the rule. The rule update is awaited
// before fetching: session rules only affect requests made after they take
// effect.
export async function testWithUA(url: string, ua: string): Promise<ProbeAttempt> {
  const ruleId = nextRuleId++;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id: ruleId,
        priority: 1,
        action: {
          type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [
            {
              header: "User-Agent",
              operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
              value: ua,
            },
          ],
        },
        condition: {
          regexFilter: originRegexFilter(url),
          resourceTypes: ["xmlhttprequest" as chrome.declarativeNetRequest.ResourceType],
        },
      },
    ],
    // Pre-remove the same id defensively in case a previous run crashed.
    removeRuleIds: [ruleId],
  });
  try {
    return await fetchAsProbe(url);
  } finally {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
  }
}

// Chrome-UA baseline (no rule needed — the SW's own UA already is Chrome's).
async function fetchBaseline(url: string): Promise<ProbeBaseline> {
  try {
    const attempt = await fetchAsProbe(url);
    const { verdict } = classifyProbe(attempt.httpStatus, attempt.body);
    return {
      httpStatus: attempt.httpStatus,
      finalUrl: attempt.finalUrl,
      redirected: attempt.redirected,
      bodySnippet: attempt.body.slice(0, 200),
      verdict,
    };
  } catch (err) {
    return {
      httpStatus: 0,
      finalUrl: url,
      redirected: false,
      bodySnippet: "",
      verdict: "error",
      fetchError: errorText(err),
    };
  }
}

// Serial probe run: baseline first, then one request per bot with a random
// 800–1500ms gap, to stay under rate-limit radar.
export async function runProbeCheck(targetUrl: string): Promise<ProbeCheck> {
  await cleanupStaleProbeRules();

  const baseline = await fetchBaseline(targetUrl);
  await jitter();

  const bots = AI_BOTS.filter((b) => b.ua);
  const results: ProbeResult[] = [];

  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    pushProgress(bot.token, i + 1, bots.length);
    try {
      const attempt = await testWithUA(targetUrl, bot.ua as string);
      const { verdict, note } = classifyProbe(attempt.httpStatus, attempt.body);
      results.push({
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
      });
    } catch (err) {
      const fetchError = errorText(err);
      results.push({
        token: bot.token,
        vendor: bot.vendor,
        category: bot.category,
        httpStatus: 0,
        finalUrl: targetUrl,
        redirected: false,
        bodySnippet: "",
        verdict: "error",
        fetchError,
        diff: "请求失败",
      });
    }
    if (i < bots.length - 1) await jitter();
  }

  return { status: aggregateProbeStatus(results), targetUrl, baseline, results };
}
