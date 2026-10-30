"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildScore,
  type AuditReport,
  type BotResult,
  type CheckStatus,
  type ProbeVerdict,
} from "@geo-auditor/audit-core";
import { reportUrl } from "../lib/siteUrl";
import { trackEvent } from "../lib/analytics";
import PremiumTeaser from "../components/PremiumTeaser";

const STATUS_TEXT: Record<CheckStatus, string> = {
  pass: "通过",
  warn: "警告",
  fail: "未通过",
};

const VERDICT_TEXT: Record<BotResult["verdict"], string> = {
  allow: "放行",
  disallow: "禁止",
  "not-mentioned": "未提及",
  info: "说明",
};

const PROBE_TEXT: Record<ProbeVerdict, string> = {
  accessible: "可访问",
  blocked: "被拦截",
  challenge: "挑战页",
  error: "请求失败",
};

const CATEGORY_TEXT: Record<BotResult["category"], string> = {
  search: "搜索",
  training: "训练",
  user: "用户",
  other: "其他",
};

function StatusBadge({ status }: { status: CheckStatus }) {
  return <span className={`badge ${status}`}>{STATUS_TEXT[status]}</span>;
}

function Card({
  title,
  status,
  children,
}: {
  title: string;
  status: CheckStatus;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <header>
        <h2>{title}</h2>
        <StatusBadge status={status} />
      </header>
      {children}
    </section>
  );
}

// Shared audit UI. Used by the home page (manual input) and the shareable
// report page /report/{domain} (initialDomain + autoStart).
export default function AuditApp({
  initialDomain,
  autoStart = false,
  showPremium = false,
}: {
  initialDomain?: string;
  autoStart?: boolean;
  showPremium?: boolean;
}) {
  const [input, setInput] = useState(initialDomain ? `https://${initialDomain}` : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<AuditReport | null>(null);
  const [shareTip, setShareTip] = useState("");
  const autoStarted = useRef(false);

  async function startAudit(rawUrl: string) {
    setLoading(true);
    setError("");
    setReport(null);
    setShareTip("");
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: rawUrl }),
      });
      const data = (await res.json()) as
        | { ok: true; report: AuditReport }
        | { ok: false; error: string };
      if (!data.ok) {
        setError(data.error);
      } else {
        setReport(data.report);
      }
    } catch {
      setError("请求失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  // Report links open with the domain pre-filled and the audit auto-started.
  // The ref guard keeps React strict-mode double mounting from running twice.
  useEffect(() => {
    if (!autoStart || !initialDomain || autoStarted.current) return;
    autoStarted.current = true;
    void startAudit(`https://${initialDomain}`);
  }, [autoStart, initialDomain]);

  async function handleAudit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    await startAudit(input);
  }

  async function handleShare() {
    if (!report) return;
    const domain = new URL(report.url).hostname;
    const link = reportUrl(domain);
    const text = `GEO Auditor 检测报告：${report.url} 得分 ${score?.total}/100（等级 ${score?.grade}）`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "GEO Auditor 检测报告", text, url: link });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${link}`);
      trackEvent("share", "copy", domain);
      setShareTip("分享链接已复制");
      setTimeout(() => setShareTip(""), 2000);
    } catch {
      // User cancelled the share sheet — nothing to show.
    }
  }

  const score = report ? buildScore(report) : null;

  return (
    <main>
      <h1>GEO Auditor</h1>
      <p className="subtitle">
        输入网址，检测网站对 AI 搜索引擎的友好度：robots.txt AI 爬虫规则 · llms.txt ·
        JSON-LD 结构化数据 · AI 爬虫 UA 可达性
      </p>

      <form className="audit-form" onSubmit={handleAudit}>
        <input
          type="text"
          placeholder="https://example.com"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button type="submit" disabled={loading || input.trim() === ""}>
          {loading ? "检测中…" : "开始检测"}
        </button>
      </form>
      <p className="hint">
        检测约需 10–30 秒（含 9 个 AI 爬虫 UA 探测）；内容流失为估算检测：基于 AI
        爬虫可见正文量（爬虫不执行 JS），完整渲染对比请使用浏览器扩展版。
      </p>

      {error !== "" && <div className="error-card">{error}</div>}
      {loading && <div className="loading">正在检测，请稍候…</div>}

      {report && score && (
        <>
          <div className="score-hero">
            <div className="score-total">
              {score.total}
              <span className="grade">{score.grade}</span>
            </div>
            <div className="breakdown">
              <span className="chip">robots.txt<b>{score.breakdown.robots}/30</b></span>
              <span className="chip">llms.txt<b>{score.breakdown.llmsTxt}/10</b></span>
              <span className="chip">JSON-LD<b>{score.breakdown.jsonLd}/20</b></span>
              <span className="chip">内容流失<b>{report.csr.skipped ? "不可用" : `${score.breakdown.csr}/25`}</b></span>
              <span className="chip">UA 可达性<b>{score.breakdown.probe}/15</b></span>
            </div>
          </div>

          <div className="share-row">
            <button type="button" className="share-button" onClick={handleShare}>
              分享此报告
            </button>
            {shareTip !== "" && <span className="muted">{shareTip}</span>}
          </div>

          {score.suggestions.length > 0 && (
            <section className="card">
              <header>
                <h2>改进建议</h2>
              </header>
              <ul className="suggestions">
                {score.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </section>
          )}

          <Card title="robots.txt AI 爬虫规则" status={report.robots.status}>
            {!report.robots.exists ? (
              <p className="muted">
                未检测到 robots.txt
                {report.robots.fetchError ? `（${report.robots.fetchError}）` : ""}
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>爬虫</th>
                    <th>类别</th>
                    <th>判定</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {report.robots.bots.map((bot) => (
                    <tr key={bot.token}>
                      <td>{bot.token}</td>
                      <td className="muted">{CATEGORY_TEXT[bot.category]}</td>
                      <td>{VERDICT_TEXT[bot.verdict]}</td>
                      <td className="muted">
                        {bot.note ??
                          (bot.rule ? `${bot.rule.type === "allow" ? "Allow" : "Disallow"}: ${bot.rule.path}` : "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="llms.txt" status={report.llmsTxt.status}>
            {report.llmsTxt.exists ? (
              <>
                <p className="muted">
                  已部署（HTTP {report.llmsTxt.httpStatus} · {report.llmsTxt.sizeBytes} 字节）
                </p>
                {report.llmsTxt.summary && <p>{report.llmsTxt.summary}</p>}
              </>
            ) : (
              <p className="muted">
                未部署
                {report.llmsTxt.fetchError ? `（${report.llmsTxt.fetchError}）` : "：建议在站点根路径部署 llms.txt"}
              </p>
            )}
          </Card>

          <Card title="JSON-LD 结构化数据" status={report.jsonLd.status}>
            <p className="muted">
              共 {report.jsonLd.blockCount} 个代码块，其中 {report.jsonLd.invalidCount} 个无效
            </p>
            {report.jsonLd.typeCounts.length > 0 && (
              <div className="type-tags">
                {report.jsonLd.typeCounts.map((t) => (
                  <span key={t.type} className="chip">
                    {t.type}<b>×{t.count}</b>
                  </span>
                ))}
              </div>
            )}
          </Card>

          <Card title="AI 爬虫 UA 可达性" status={report.probe.status}>
            <p className="muted">
              基线（Chrome UA）：HTTP {report.probe.baseline.httpStatus} ·{" "}
              {PROBE_TEXT[report.probe.baseline.verdict]}
            </p>
            <table>
              <thead>
                <tr>
                  <th>爬虫</th>
                  <th>类别</th>
                  <th>状态</th>
                  <th>判定</th>
                  <th>与基线对比</th>
                </tr>
              </thead>
              <tbody>
                {report.probe.results.map((r) => (
                  <tr key={r.token}>
                    <td>{r.token}</td>
                    <td className="muted">{CATEGORY_TEXT[r.category]}</td>
                    <td className="muted">
                      {r.httpStatus > 0 ? `HTTP ${r.httpStatus}` : r.fetchError ?? "请求失败"}
                    </td>
                    <td>{PROBE_TEXT[r.verdict]}</td>
                    <td className="muted">{r.diff ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="内容流失（CSR 盲区）" status={report.csr.status}>
            {report.csr.skipped || !report.csr.estimate ? (
              <p className="muted">{report.csr.error}</p>
            ) : (
              <>
                <p className="muted">
                  估算 · AI 爬虫可见正文约 {report.csr.estimate.visibleChars} 字符
                  （爬虫不执行 JS，无法真实渲染对比，完整对比请用浏览器扩展）
                </p>
                <p>
                  {report.csr.estimate.level === "low"
                    ? "服务端正文充足，AI 爬虫可直接读取。"
                    : report.csr.estimate.level === "medium"
                      ? "服务端可见正文偏少，部分内容可能由 JS 注入。"
                      : "疑似 CSR 空壳：AI 爬虫几乎读不到正文。"}
                </p>
                {report.csr.estimate.signals.length > 0 && (
                  <ul className="suggestions">
                    {report.csr.estimate.signals.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Card>

          {showPremium && (
            <PremiumTeaser domain={new URL(report.url).hostname} />
          )}

          <footer>
            检测时间 {new Date(report.auditedAt).toLocaleString("zh-CN")} · Web 版满分{" "}
            {score.max}
            {report.csr.skipped ? "（页面读取失败，内容流失未计分）" : ""}
          </footer>
        </>
      )}
    </main>
  );
}
