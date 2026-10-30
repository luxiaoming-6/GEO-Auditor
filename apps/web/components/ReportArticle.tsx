// Server-rendered article view of an archived audit report (content/reports).
// Pure server component: the whole article is static HTML that AI crawlers
// can read without executing JS — the point of the git-based report archive.
// Text maps intentionally mirror AuditApp's, keeping the server bundle free
// of client component imports.

import type {
  BotResult,
  CheckStatus,
  ProbeVerdict,
} from "@geo-auditor/audit-core";
import PremiumTeaser from "./PremiumTeaser";
import {
  formatCnDateTime,
  type StoredReportWithScore,
} from "../lib/reportsContent";

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

const LEVEL_TEXT = { low: "充足", medium: "偏少", high: "疑似空壳" } as const;

function StatusBadge({ status }: { status: CheckStatus }) {
  return <span className={`badge ${status}`}>{STATUS_TEXT[status]}</span>;
}

export default function ReportArticle({ stored }: { stored: StoredReportWithScore }) {
  const { domain, report, score } = stored;
  const validBlocks = Math.max(0, report.jsonLd.blockCount - report.jsonLd.invalidCount);

  return (
    <main className="article">
      <h1>{domain} 的 GEO 检测报告</h1>
      <p className="subtitle">
        检测时间：{formatCnDateTime(report.auditedAt)}（Asia/Shanghai）· 检测地址：
        {report.url}
      </p>

      <section className="card score-hero">
        <div className="score-total">
          {score.total}
          <span className="grade">{score.grade}</span>
        </div>
        <div>
          <p className="muted">满分 {score.max}（Web 版内容流失为估算口径）</p>
          <div className="breakdown">
            <span className="chip">
              robots.txt<b>{score.breakdown.robots}</b>
            </span>
            <span className="chip">
              llms.txt<b>{score.breakdown.llmsTxt}</b>
            </span>
            <span className="chip">
              JSON-LD<b>{score.breakdown.jsonLd}</b>
            </span>
            <span className="chip">
              内容流失<b>{score.breakdown.csr}</b>
            </span>
            <span className="chip">
              UA 探测<b>{score.breakdown.probe}</b>
            </span>
          </div>
        </div>
      </section>

      {score.suggestions.length > 0 && (
        <section className="card">
          <header>
            <h2>改进建议</h2>
          </header>
          <ul className="suggestions">
            {score.suggestions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <header>
          <h2>robots.txt AI 爬虫规则</h2>
          <StatusBadge status={report.robots.status} />
        </header>
        {report.robots.exists ? (
          <table>
            <thead>
              <tr>
                <th>爬虫</th>
                <th>类别</th>
                <th>判定</th>
                <th>规则</th>
              </tr>
            </thead>
            <tbody>
              {report.robots.bots.map((b) => (
                <tr key={b.token}>
                  <td>{b.token}</td>
                  <td className="muted">{CATEGORY_TEXT[b.category]}</td>
                  <td>{VERDICT_TEXT[b.verdict]}</td>
                  <td className="muted">
                    {b.rule
                      ? `${b.rule.type === "allow" ? "Allow" : "Disallow"}: ${b.rule.path}`
                      : (b.note ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">
            {report.robots.fetchError
              ? `robots.txt 读取失败：${report.robots.fetchError}`
              : "未读取到 robots.txt（可能不存在）"}
          </p>
        )}
      </section>

      <section className="card">
        <header>
          <h2>llms.txt</h2>
          <StatusBadge status={report.llmsTxt.status} />
        </header>
        <p>
          {report.llmsTxt.exists
            ? `已部署 llms.txt${report.llmsTxt.sizeBytes != null ? `（${report.llmsTxt.sizeBytes} 字节）` : ""}`
            : (report.llmsTxt.fetchError
                ? `llms.txt 读取失败：${report.llmsTxt.fetchError}`
                : "未部署 llms.txt")}
        </p>
        {report.llmsTxt.summary && <p className="muted">{report.llmsTxt.summary}</p>}
      </section>

      <section className="card">
        <header>
          <h2>JSON-LD 结构化数据</h2>
          <StatusBadge status={report.jsonLd.status} />
        </header>
        <p>
          {validBlocks > 0
            ? `检测到 ${report.jsonLd.blockCount} 个 JSON-LD 数据块${report.jsonLd.invalidCount > 0 ? `（其中 ${report.jsonLd.invalidCount} 个解析失败）` : ""}`
            : "未检测到 JSON-LD 结构化数据"}
        </p>
        {report.jsonLd.typeCounts.length > 0 && (
          <div className="type-tags">
            {report.jsonLd.typeCounts.map((t) => (
              <span key={t.type} className="chip">
                {t.type} × {t.count}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <header>
          <h2>AI 爬虫可达性（UA 探测）</h2>
          <StatusBadge status={report.probe.status} />
        </header>
        {report.probe.error ? (
          <p className="muted">探测失败：{report.probe.error}</p>
        ) : (
          <>
            <p className="muted">以 Chrome UA 为基线访问 {report.probe.targetUrl}</p>
            <table>
              <thead>
                <tr>
                  <th>爬虫</th>
                  <th>类别</th>
                  <th>结果</th>
                  <th>与基线差异</th>
                </tr>
              </thead>
              <tbody>
                {report.probe.results.map((r) => (
                  <tr key={r.token}>
                    <td>
                      {r.token}
                      <br />
                      <span className="muted">{r.vendor}</span>
                    </td>
                    <td className="muted">{CATEGORY_TEXT[r.category]}</td>
                    <td>
                      {PROBE_TEXT[r.verdict]}
                      {r.httpStatus ? ` · ${r.httpStatus}` : ""}
                    </td>
                    <td className="muted">{r.diff ?? r.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="card">
        <header>
          <h2>内容流失（CSR 盲区）</h2>
          <StatusBadge status={report.csr.status} />
        </header>
        {report.csr.estimate ? (
          <>
            <p className="muted">
              Web 版估算口径：统计服务端 HTML 中 AI 爬虫（不执行 JS）可见的正文量。
            </p>
            <p>
              AI 爬虫可见正文约 <b>{report.csr.estimate.visibleChars}</b> 字符（服务端 HTML 共{" "}
              <b>{report.csr.estimate.htmlChars}</b> 字符）· 内容量评估：
              <b>{LEVEL_TEXT[report.csr.estimate.level]}</b>
            </p>
            {report.csr.estimate.signals.length > 0 && (
              <ul className="signals">
                {report.csr.estimate.signals.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </>
        ) : report.csr.skipped ? (
          <p className="muted">
            Web 版不支持渲染检测（需真实浏览器环境），可安装浏览器扩展获取完整结果。
          </p>
        ) : (
          <p className="muted">
            服务端 {report.csr.serverChars} 字符 · 渲染后 {report.csr.renderedChars} 字符 · 重合率{" "}
            {(report.csr.overlapRate * 100).toFixed(0)}%
          </p>
        )}
      </section>

      <PremiumTeaser domain={domain} />

      <footer>
        报告为检测时刻的快照（{formatCnDateTime(report.auditedAt)} 生成），仅反映当次检测结果。
        可 <a href={`/report/${domain}`}>重新实时检测 {domain}</a>
        ，或在首页输入任意网址开始检测。
      </footer>
    </main>
  );
}
