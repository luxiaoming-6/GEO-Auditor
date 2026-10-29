// GEO Auditor popup (vanilla DOM, no framework).
// Renders the audit report: one collapsible module per check with a
// pass/warn/fail status light.

import { GEO_KEY_TYPES } from "@geo-auditor/audit-core";
import { buildMarkdownReport } from "../core/markdown";
import { buildScore, gradeFor, type Grade } from "@geo-auditor/audit-core";
import { readHistory } from "../background/history";
import { relativeTimeZh, sparklinePoints } from "../shared/format";
import type {
  AuditResponse,
  ProbeProgressMessage,
  RetryCheckMessage,
  RetryCheckResponse,
  RetryableCheck,
} from "../shared/protocol";
import type {
  AuditReport,
  BotResult,
  CheckStatus,
  CsrCheck,
  HistoryEntry,
  JsonLdCheck,
  LlmsTxtCheck,
  ProbeCheck,
  ProbeVerdict,
  RobotsCheck,
} from "@geo-auditor/audit-core";

const domainEl = document.querySelector<HTMLSpanElement>("#domain");
const historyEl = document.querySelector<HTMLDivElement>("#history");
const startBtn = document.querySelector<HTMLButtonElement>("#start");
const exportBtn = document.querySelector<HTMLButtonElement>("#export");
const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const reportEl = document.querySelector<HTMLDivElement>("#report");

// Report currently displayed, kept for the Markdown export.
let currentReport: AuditReport | null = null;

const AUDITABLE_PROTOCOLS = new Set(["http:", "https:"]);
// Static checks (~3s) + 10 serial probes with 800–1500ms jitter each.
const AUDIT_TIMEOUT_MS = 120000;

function describeTarget(
  raw: string,
): { label: string; auditable: boolean } {
  try {
    const url = new URL(raw);
    // chrome://, edge://, about:, file:// etc. have no audit target.
    if (!AUDITABLE_PROTOCOLS.has(url.protocol)) {
      return { label: "不支持检测的页面（仅支持 http/https）", auditable: false };
    }
    return { label: url.host, auditable: true };
  } catch {
    return { label: raw || "无法读取页面地址", auditable: false };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

// ---------- rendering helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatBytes(n?: number): string {
  if (n === undefined) return "未知大小";
  return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: "通过",
  warn: "警告",
  fail: "未通过",
};

const VERDICT_LABEL: Record<BotResult["verdict"], string> = {
  allow: "允许",
  disallow: "禁止",
  "not-mentioned": "未提及（默认允许）",
  info: "说明",
};

const VERDICT_CLASS: Record<BotResult["verdict"], string> = {
  allow: "badge-allow",
  disallow: "badge-disallow",
  "not-mentioned": "badge-muted",
  info: "badge-info",
};

function moduleSection(
  title: string,
  status: CheckStatus,
  open: boolean,
): { details: HTMLDetailsElement; body: HTMLDivElement } {
  const details = el("details", "module");
  details.open = open;
  const summary = el("summary", "module-summary");
  summary.append(
    el("span", `dot dot-${status}`),
    el("span", "module-title", title),
    el("span", "module-status", STATUS_LABEL[status]),
  );
  const body = el("div", "module-body");
  details.append(summary, body);
  return { details, body };
}

// ---------- per-module renderers ----------

function robotsMissingNote(check: RobotsCheck): string {
  if (check.fetchError) return `无法获取 robots.txt：${check.fetchError}`;
  if (check.httpStatus === 200) {
    return "服务器对 /robots.txt 返回了 HTML 页面（疑似软 404）";
  }
  if (check.httpStatus === 404 || check.httpStatus === 410) {
    return "未部署 robots.txt，默认允许所有爬虫抓取";
  }
  if (check.httpStatus !== undefined) {
    return `获取失败（HTTP ${check.httpStatus}）`;
  }
  return "未部署 robots.txt";
}

function renderRobots(body: HTMLDivElement, check: RobotsCheck): void {
  if (!check.exists) {
    body.append(el("p", "muted", robotsMissingNote(check)));
    return;
  }
  body.append(
    el(
      "p",
      "muted",
      `已找到 robots.txt（${formatBytes(check.sizeBytes)}）· 评估路径：${check.evaluatedPath}`,
    ),
  );
  const list = el("ul", "bot-list");
  for (const bot of check.bots) {
    const li = el("li", "bot-row");
    const line = el("div", "bot-line");
    line.append(
      el("span", "bot-name", bot.token),
      el("span", `badge ${VERDICT_CLASS[bot.verdict]}`, VERDICT_LABEL[bot.verdict]),
    );
    if (bot.rule) {
      line.append(
        el(
          "span",
          "bot-rule",
          `${bot.rule.type === "allow" ? "Allow" : "Disallow"}: ${bot.rule.path}（第 ${bot.rule.line} 行）`,
        ),
      );
    }
    li.append(line);
    if (bot.note) li.append(el("div", "bot-note", bot.note));
    list.append(li);
  }
  body.append(list);
}

function renderLlmsTxt(body: HTMLDivElement, check: LlmsTxtCheck): void {
  if (check.exists) {
    body.append(
      el(
        "p",
        "muted",
        `已部署 llms.txt（${formatBytes(check.sizeBytes)}）· 内容摘要（前 500 字符）：`,
      ),
    );
    body.append(el("pre", "llms-pre", check.summary ?? ""));
    return;
  }
  const note = check.fetchError
    ? `无法获取 llms.txt：${check.fetchError}`
    : (check.note ?? "未部署");
  body.append(el("p", "muted", note));
}

function renderJsonLd(body: HTMLDivElement, check: JsonLdCheck): void {
  if (check.error) {
    body.append(el("p", "muted", check.error), retryButton("jsonld"));
    return;
  }
  if (check.blockCount === 0) {
    body.append(el("p", "muted", "未检测到 JSON-LD 结构化数据"));
    return;
  }
  const validCount = check.blockCount - check.invalidCount;
  const parts =
    check.invalidCount > 0
      ? `共 ${check.blockCount} 个数据块，解析成功 ${validCount}，存在但格式非法 ${check.invalidCount}`
      : `共 ${check.blockCount} 个数据块，全部解析成功`;
  body.append(el("p", "muted", parts));

  if (check.typeCounts.length === 0) {
    body.append(el("p", "muted", "数据块解析成功，但未包含 @type"));
    return;
  }
  const list = el("ul", "type-list");
  for (const { type, count } of check.typeCounts) {
    const li = el("li", "type-row");
    li.append(
      el("span", `badge ${GEO_KEY_TYPES.has(type) ? "badge-key" : "badge-muted"}`, type),
      el("span", "type-count", `× ${count}`),
    );
    list.append(li);
  }
  body.append(list);
}

function renderReport(report: AuditReport): void {
  if (!reportEl) return;
  reportEl.replaceChildren();
  currentReport = report;
  if (exportBtn) exportBtn.hidden = false;

  reportEl.append(renderScore(report));

  const robots = moduleSection("robots.txt · AI 爬虫访问规则", report.robots.status, true);
  renderRobots(robots.body, report.robots);

  const llms = moduleSection("llms.txt", report.llmsTxt.status, false);
  renderLlmsTxt(llms.body, report.llmsTxt);

  const jsonLd = moduleSection("JSON-LD 结构化数据", report.jsonLd.status, false);
  renderJsonLd(jsonLd.body, report.jsonLd);

  const probe = moduleSection("AI 爬虫 UA 可达性探测", report.probe.status, true);
  renderProbe(probe.body, report.probe);

  const csr = moduleSection("内容流失 · CSR 盲区", report.csr.status, false);
  renderCsr(csr.body, report.csr);

  reportEl.append(robots.details, llms.details, jsonLd.details, probe.details, csr.details);
}

function statusCounts(report: AuditReport): Record<CheckStatus, number> {
  const counts: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0 };
  for (const status of [
    report.robots.status,
    report.llmsTxt.status,
    report.jsonLd.status,
    report.probe.status,
    report.csr.status,
  ]) {
    counts[status] += 1;
  }
  return counts;
}

// ---------- M3: UA probe renderer ----------

const PROBE_VERDICT_LABEL: Record<ProbeVerdict, string> = {
  accessible: "可访问",
  blocked: "拦截",
  challenge: "疑似挑战页",
  error: "失败",
};

const PROBE_VERDICT_CLASS: Record<ProbeVerdict, string> = {
  accessible: "badge-allow",
  blocked: "badge-disallow",
  challenge: "badge-warn",
  error: "badge-muted",
};

function renderProbe(body: HTMLDivElement, check: ProbeCheck): void {
  if (check.error) {
    body.append(el("p", "muted", `探测失败：${check.error}`));
    return;
  }
  const b = check.baseline;
  body.append(
    el(
      "p",
      "muted",
      b.fetchError
        ? `基线（Chrome UA）请求失败：${b.fetchError}`
        : `基线（Chrome UA）：HTTP ${b.httpStatus} · ${PROBE_VERDICT_LABEL[b.verdict]}${
            b.redirected ? ` · 重定向 → ${b.finalUrl}` : ""
          }`,
    ),
  );

  const table = el("table", "probe-table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const heading of ["爬虫", "状态码", "判定", "与基线差异"]) {
    headRow.append(el("th", undefined, heading));
  }
  thead.append(headRow);

  const tbody = el("tbody");
  for (const r of check.results) {
    const tr = el("tr");
    const nameTd = el("td", undefined, r.token);
    if (r.note) nameTd.append(el("div", "bot-note", r.note));
    const statusTd = el("td", undefined, r.httpStatus > 0 ? String(r.httpStatus) : "—");
    if (r.redirected) {
      statusTd.title = `重定向至 ${r.finalUrl}`;
      statusTd.append(el("span", "redirect-mark", " ↪"));
    }
    const verdictTd = el("td");
    verdictTd.append(
      el("span", `badge ${PROBE_VERDICT_CLASS[r.verdict]}`, PROBE_VERDICT_LABEL[r.verdict]),
    );
    tr.append(nameTd, statusTd, verdictTd, el("td", "diff-cell", r.diff ?? ""));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  body.append(table);
}

// ---------- M4: CSR content-loss renderer ----------

function renderCsr(body: HTMLDivElement, check: CsrCheck): void {
  if (check.error) {
    body.append(el("p", "muted", check.error));
    return;
  }
  if (check.heavyCsr) {
    body.append(el("p", "csr-heavy", "重度 CSR 依赖：AI 爬虫可能只看到空壳"));
  }
  body.append(
    el(
      "p",
      "muted",
      `服务器正文 ${check.serverLines} 行（${formatBytes(check.serverChars)}）· 渲染后 ${check.renderedLines} 行（${formatBytes(check.renderedChars)}）`,
    ),
    el(
      "p",
      "muted",
      `行级重叠率：${(check.overlapRate * 100).toFixed(0)}%（重叠 ${check.overlapLines} 行 ÷ 渲染 ${check.renderedLines} 行）`,
    ),
  );
  if (check.injectedSamples.length > 0) {
    body.append(el("p", "muted", "仅存在于渲染后的行（JS 注入内容样例）："));
    const list = el("ul", "bot-list");
    for (const line of check.injectedSamples) {
      const text = line.length > 120 ? `${line.slice(0, 120)}…` : line;
      list.append(el("li", "bot-row bot-note", text));
    }
    body.append(list);
  }
}

// ---------- M5: score ring + suggestions ----------

const SVG_NS = "http://www.w3.org/2000/svg";
const GRADE_COLOR: Record<Grade, string> = {
  A: "#22c55e",
  B: "#eab308",
  C: "#f97316",
  D: "#ef4444",
};
const RING_RADIUS = 30;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function svgCircle(className: string): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "36");
  circle.setAttribute("cy", "36");
  circle.setAttribute("r", String(RING_RADIUS));
  circle.setAttribute("class", className);
  return circle;
}

function renderScore(report: AuditReport): HTMLDivElement {
  const score = buildScore(report);
  const box = el("div", "score-box");

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 72 72");
  svg.setAttribute("width", "64");
  svg.setAttribute("height", "64");
  svg.setAttribute("class", "score-ring");
  const fg = svgCircle("ring-fg");
  fg.setAttribute("stroke-dasharray", RING_CIRCUMFERENCE.toFixed(1));
  fg.setAttribute(
    "stroke-dashoffset",
    (RING_CIRCUMFERENCE * (1 - score.total / 100)).toFixed(1),
  );
  fg.style.stroke = GRADE_COLOR[score.grade];
  svg.append(svgCircle("ring-bg"), fg);

  const text = el("div", "score-text");
  const total = el("div", "score-total", String(score.total));
  total.append(el("span", "score-max", " / 100"));
  text.append(
    total,
    el("div", `score-grade grade-${score.grade.toLowerCase()}`, `等级 ${score.grade}`),
  );
  box.append(svg, text);

  if (score.suggestions.length > 0) {
    box.append(el("div", "suggestion-title", "建议动作"));
    const list = el("ul", "suggestion-list");
    for (const s of score.suggestions) list.append(el("li", undefined, s));
    box.append(list);
  }
  return box;
}

// ---------- v1.1: single-check retry ----------

function retryButton(check: RetryableCheck): HTMLButtonElement {
  const btn = el("button", "retry-btn", "重试此次检测");
  btn.addEventListener("click", () => void retryCheck(check));
  return btn;
}

async function retryCheck(check: RetryableCheck): Promise<void> {
  if (!statusEl) return;
  statusEl.classList.remove("status-fail");
  statusEl.textContent =
    check === "jsonld" ? "正在重试 JSON-LD 检测…" : "正在重试内容流失检测…";
  try {
    const res = (await withTimeout(
      chrome.runtime.sendMessage({
        type: "RETRY_CHECK",
        check,
      } satisfies RetryCheckMessage),
      30000,
      "重试超时，请重试",
    )) as RetryCheckResponse | undefined;
    if (!res?.ok || !res.report) throw new Error(res?.error ?? "未收到后台响应");
    renderReport(res.report);
    const counts = statusCounts(res.report);
    statusEl.textContent = `重试完成：${counts.pass} 项通过 · ${counts.warn} 项警告 · ${counts.fail} 项未通过`;
    if (currentReport) void renderHistory(safeHost(currentReport.url));
  } catch (err) {
    statusEl.textContent = `重试失败：${err instanceof Error ? err.message : String(err)}`;
    statusEl.classList.add("status-fail");
  }
}

// ---------- v1.1: score history ----------

function renderSparkline(entries: HistoryEntry[]): SVGSVGElement {
  const W = 288;
  const H = 80;
  const PAD = 10;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  svg.setAttribute("class", "history-spark");

  // Grade threshold guides at 85 / 70 / 50.
  for (const threshold of [85, 70, 50]) {
    const y = H - PAD - (threshold / 100) * (H - 2 * PAD);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(PAD));
    line.setAttribute("x2", String(W - PAD));
    line.setAttribute("y1", y.toFixed(1));
    line.setAttribute("y2", y.toFixed(1));
    line.setAttribute("class", "spark-guide");
    svg.append(line);
  }

  const chronological = [...entries].reverse(); // oldest → newest
  const pts = sparklinePoints(
    chronological.map((e) => e.total),
    W,
    H,
    PAD,
  );

  if (pts.length >= 2) {
    const poly = document.createElementNS(SVG_NS, "polyline");
    poly.setAttribute(
      "points",
      pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    );
    poly.setAttribute("class", "spark-line");
    svg.append(poly);
  }
  pts.forEach((p, i) => {
    const entry = chronological[i];
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", p.x.toFixed(1));
    dot.setAttribute("cy", p.y.toFixed(1));
    dot.setAttribute("r", "3");
    dot.setAttribute("class", "spark-dot");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${new Date(entry.auditedAt).toLocaleString("zh-CN")} · ${entry.total} 分`;
    dot.append(title);
    svg.append(dot);
  });
  return svg;
}

async function renderHistory(host: string): Promise<void> {
  if (!historyEl || !host) return;
  let entries: HistoryEntry[];
  try {
    entries = (await readHistory()).filter((e) => e.host === host);
  } catch {
    return; // storage.local unavailable — skip the feature silently
  }
  if (entries.length === 0) {
    historyEl.replaceChildren();
    return;
  }

  const latest = entries[0]; // newest first
  const box = el("div", "history-box");
  box.append(
    el(
      "p",
      "history-summary",
      `上次检测：${relativeTimeZh(Date.now(), latest.auditedAt)} · ${latest.total} 分 · 等级 ${gradeFor(latest.total)}（共 ${entries.length} 次）`,
    ),
  );
  const details = el("details", "history-details");
  details.append(el("summary", undefined, "分数变化曲线"), renderSparkline(entries));
  box.append(details);
  historyEl.replaceChildren(box);
}

// ---------- flow ----------

async function exportReport(): Promise<void> {
  if (!currentReport || !exportBtn) return;
  const md = buildMarkdownReport(currentReport, buildScore(currentReport));

  // Download as a .md file (no extra permission needed for anchor download).
  const host = safeHost(currentReport.url).replace(/[^a-z0-9.-]/gi, "") || "site";
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = `geo-auditor-${host}-${new Date().toISOString().slice(0, 10)}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

  // Also copy to the clipboard (works in the popup with a user gesture).
  let copied = true;
  try {
    await navigator.clipboard.writeText(md);
  } catch {
    copied = false;
  }

  exportBtn.textContent = copied ? "已导出并复制 ✓" : "已下载 .md ✓";
  setTimeout(() => {
    exportBtn.textContent = "导出报告";
  }, 1500);
}

async function runAudit(): Promise<void> {
  if (!startBtn || !statusEl) return;
  startBtn.disabled = true;
  startBtn.textContent = "检测中…";
  statusEl.textContent = "正在检测 robots.txt / llms.txt / JSON-LD…";
  statusEl.classList.remove("status-fail");

  try {
    const response = (await withTimeout(
      chrome.runtime.sendMessage({ type: "AUDIT_START" }),
      AUDIT_TIMEOUT_MS,
      "检测超时，请重试",
    )) as AuditResponse | undefined;
    if (!response) {
      // Happens when the service worker is stale (extension not reloaded
      // after a rebuild) and has no AUDIT_START listener yet.
      throw new Error(
        "未收到后台响应：请到 chrome://extensions 点击刷新（↻）重载扩展，并刷新目标页面后重试",
      );
    }
    if (!response.ok) throw new Error(response.error);

    renderReport(response.report);
    const counts = statusCounts(response.report);
    statusEl.textContent = `检测完成：${counts.pass} 项通过 · ${counts.warn} 项警告 · ${counts.fail} 项未通过`;
    void renderHistory(safeHost(response.report.url));
  } catch (err) {
    statusEl.textContent = `检测失败：${err instanceof Error ? err.message : String(err)}`;
    statusEl.classList.add("status-fail");
    reportEl?.replaceChildren();
    currentReport = null;
    if (exportBtn) exportBtn.hidden = true;
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "重新检测";
  }
}

async function init(): Promise<void> {
  // activeTab grants temporary access to the active tab once the popup opens,
  // so tab.url is readable without the "tabs" permission.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { label, auditable } = describeTarget(tab?.url ?? "");

  if (domainEl) domainEl.textContent = label;
  if (startBtn) startBtn.disabled = !auditable;
  startBtn?.addEventListener("click", () => void runAudit());
  exportBtn?.addEventListener("click", () => void exportReport());
  if (auditable && tab?.url) void renderHistory(safeHost(tab.url));

  // Live progress for the serial M3 probe phase (fire-and-forget messages).
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as ProbeProgressMessage | undefined;
    if (msg?.type === "PROBE_PROGRESS" && statusEl) {
      statusEl.textContent = `UA 探测中（${msg.index}/${msg.total}）：${msg.token}…`;
    }
  });

  // Restore the cached report for the same site from storage.session.
  // Reports missing newer sections are from an older version — ignore them.
  try {
    const { lastReport } = (await chrome.storage.session.get("lastReport")) as {
      lastReport?: AuditReport;
    };
    if (lastReport?.probe && lastReport?.csr && tab?.url) {
      const sameHost =
        safeHost(lastReport.url) === safeHost(tab.url);
      if (sameHost) {
        renderReport(lastReport);
        statusEl?.append(
          document.createTextNode("已载入上次检测结果，可重新检测"),
        );
      }
    }
  } catch {
    // storage.session unavailable (very old Chrome) - ignore.
  }
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return "";
  }
}

void init();
