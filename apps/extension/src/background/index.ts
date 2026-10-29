// GEO Auditor service worker (MV3).
// Orchestrates the audit: static checks (M2: robots.txt, llms.txt, JSON-LD)
// followed by the serial UA probe phase (M3).

import {
  buildLlmsTxtCheck,
  parseJsonLdBlocks,
  buildCsrCheck,
  buildRobotsCheck,
  type LlmsFetchOutcome,
  type RobotsFetchOutcome,
} from "@geo-auditor/audit-core";
import { cleanupStaleProbeRules, runProbeCheck } from "./probe";
import { recordHistory } from "./history";
import { collectorMain } from "../content/collectorMain";
import type {
  AuditResponse,
  ExtractJsonLdMessage,
  ExtractJsonLdResponse,
  ExtractRenderedTextMessage,
  ExtractRenderedTextResponse,
  ParseServerHtmlMessage,
  ParseServerHtmlResponse,
  RetryCheckMessage,
  RetryCheckResponse,
} from "../shared/protocol";
import type {
  AuditReport,
  CsrCheck,
  JsonLdCheck,
  LlmsTxtCheck,
  ProbeCheck,
  RobotsCheck,
} from "@geo-auditor/audit-core";

const FETCH_TIMEOUT_MS = 8000;

function errorText(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return "请求超时";
  }
  return err instanceof Error ? err.message : String(err);
}

async function fetchWithTimeout(url: string): Promise<{
  httpStatus: number;
  contentType: string;
  body: string;
}> {
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return {
    httpStatus: res.status,
    contentType: res.headers.get("content-type") ?? "",
    body: await res.text(),
  };
}

async function fetchRobotsCheck(url: URL): Promise<RobotsCheck> {
  let outcome: RobotsFetchOutcome;
  try {
    const { httpStatus, contentType, body } = await fetchWithTimeout(
      `${url.origin}/robots.txt`,
    );
    outcome = { httpStatus, contentType, body };
  } catch (err) {
    outcome = { fetchError: errorText(err) };
  }
  return buildRobotsCheck(outcome, url.pathname || "/");
}

async function fetchLlmsTxtCheck(url: URL): Promise<LlmsTxtCheck> {
  let outcome: LlmsFetchOutcome;
  try {
    const { httpStatus, contentType, body } = await fetchWithTimeout(
      `${url.origin}/llms.txt`,
    );
    outcome = { httpStatus, contentType, body };
  } catch (err) {
    outcome = { fetchError: errorText(err) };
  }
  return buildLlmsTxtCheck(outcome);
}

// Messaging to the page collector, with on-demand injection fallback:
// "Receiving end does not exist" means the tab has no live collector (page
// loaded before the last extension reload — common on big sites). Inject the
// self-contained collector via chrome.scripting (function serialization, so
// crxjs content-hashed asset names are irrelevant) and retry once.
async function sendToCollector<TResponse>(
  tabId: number,
  message: unknown,
): Promise<TResponse> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as TResponse;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: collectorMain,
    });
    return (await chrome.tabs.sendMessage(tabId, message)) as TResponse;
  }
}

async function extractJsonLd(tabId: number): Promise<JsonLdCheck> {
  const message: ExtractJsonLdMessage = { type: "EXTRACT_JSONLD" };
  try {
    const response = await sendToCollector<ExtractJsonLdResponse>(tabId, message);
    if (!response?.ok) throw new Error("页面未返回数据");
    return parseJsonLdBlocks(response.rawBlocks);
  } catch (err) {
    return {
      status: "fail",
      blockCount: 0,
      invalidCount: 0,
      typeCounts: [],
      error: `无法连接页面脚本（${errorText(err)}）。若刚重新加载过扩展，请刷新页面后重试`,
    };
  }
}

// M4 CSR content-loss: SW fetches the raw server HTML with the browser's own
// UA (no DNR rules are active during the static phase), then delegates both
// text reductions to the content script and compares.
async function extractRenderedText(tabId: number): Promise<string> {
  const message: ExtractRenderedTextMessage = { type: "EXTRACT_RENDERED_TEXT" };
  const response = await sendToCollector<ExtractRenderedTextResponse>(tabId, message);
  if (!response?.ok) throw new Error("页面未返回渲染文本");
  return response.renderedText;
}

async function parseServerHtml(tabId: number, html: string): Promise<string> {
  const message: ParseServerHtmlMessage = { type: "PARSE_SERVER_HTML", html };
  const response = await sendToCollector<ParseServerHtmlResponse>(tabId, message);
  if (!response?.ok) throw new Error("页面未返回解析结果");
  return response.serverText;
}

function csrError(message: string): CsrCheck {
  return {
    status: "fail",
    serverChars: 0,
    renderedChars: 0,
    serverLines: 0,
    renderedLines: 0,
    overlapLines: 0,
    overlapRate: 0,
    heavyCsr: false,
    injectedSamples: [],
    error: message,
  };
}

async function csrCheck(tabId: number, pageUrl: string): Promise<CsrCheck> {
  try {
    const [rendered, serverHtml] = await Promise.all([
      extractRenderedText(tabId),
      fetchWithTimeout(pageUrl),
    ]);
    const serverText = await parseServerHtml(tabId, serverHtml.body);
    return buildCsrCheck(serverText, rendered);
  } catch (err) {
    return csrError(
      `内容流失检测失败（${errorText(err)}）。若刚重新加载过扩展，请刷新页面后重试`,
    );
  }
}

async function probeCheck(url: URL): Promise<ProbeCheck> {
  try {
    return await runProbeCheck(url.href);
  } catch (err) {
    const message = errorText(err);
    return {
      status: "warn",
      targetUrl: url.href,
      baseline: {
        httpStatus: 0,
        finalUrl: url.href,
        redirected: false,
        bodySnippet: "",
        verdict: "error",
        fetchError: message,
      },
      results: [],
      error: message,
    };
  }
}

async function runAudit(): Promise<AuditReport> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab.id) throw new Error("无法读取当前标签页");

  const url = new URL(tab.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("仅支持 http/https 页面");
  }

  const [robots, llmsTxt, jsonLd, csr] = await Promise.all([
    fetchRobotsCheck(url),
    fetchLlmsTxtCheck(url),
    extractJsonLd(tab.id),
    csrCheck(tab.id, tab.url),
  ]);
  // Probes run strictly after the static checks finish: while a probe rule is
  // live it rewrites the UA of every SW xmlhttprequest to the target origin,
  // so it must not overlap the robots/llms/HTML fetches.
  const probe = await probeCheck(url);
  return { url: tab.url, origin: url.origin, auditedAt: Date.now(), robots, llmsTxt, jsonLd, probe, csr };
}

// Sweep probe rules if the SW died mid-probe in a previous run.
void cleanupStaleProbeRules();

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    const type = (message as { type?: string } | undefined)?.type;

    if (type === "AUDIT_START") {
      runAudit()
        .then(async (report) => {
          try {
            await chrome.storage.session.set({ lastReport: report });
            // Score history for the popup curve; failures here never fail the audit.
            await recordHistory(report);
          } catch {
            // Caching is best-effort; never fail the audit because of it.
          }
          sendResponse({ ok: true, report } satisfies AuditResponse);
        })
        .catch((err) => {
          sendResponse({ ok: false, error: errorText(err) } satisfies AuditResponse);
        });
      return true; // keep the message channel open for the async response
    }

    if (type === "RETRY_CHECK") {
      const { check } = message as RetryCheckMessage;
      void (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.url || !tab.id) throw new Error("无法读取当前标签页");
          const url = new URL(tab.url);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            throw new Error("仅支持 http/https 页面");
          }
          const { lastReport } = (await chrome.storage.session.get("lastReport")) as {
            lastReport?: AuditReport;
          };
          if (!lastReport || lastReport.url !== tab.url) {
            throw new Error("没有与当前页面匹配的检测结果，请先完整检测一次");
          }
          const section =
            check === "jsonld" ? await extractJsonLd(tab.id) : await csrCheck(tab.id, tab.url);
          const updated: AuditReport = { ...lastReport, [check]: section };
          try {
            await chrome.storage.session.set({ lastReport: updated });
            // Upsert by (host, auditedAt): refreshes the same curve point.
            await recordHistory(updated);
          } catch {
            // Best-effort persistence.
          }
          sendResponse({ ok: true, report: updated } satisfies RetryCheckResponse);
        } catch (err) {
          sendResponse({ ok: false, error: errorText(err) } satisfies RetryCheckResponse);
        }
      })();
      return true;
    }

    return false;
  },
);
