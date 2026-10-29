// Pure Markdown report builder (M5).
// No chrome APIs — unit-testable. Output copy is Chinese, per project rules.

import type {
  AuditReport,
  BotResult,
  CheckStatus,
  ProbeVerdict,
  ScoreResult,
} from "@geo-auditor/audit-core";

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: "通过",
  warn: "警告",
  fail: "未通过",
};

const ROBOTS_VERDICT_LABEL: Record<BotResult["verdict"], string> = {
  allow: "允许",
  disallow: "禁止",
  "not-mentioned": "未提及（默认允许）",
  info: "说明",
};

const PROBE_VERDICT_LABEL: Record<ProbeVerdict, string> = {
  accessible: "可访问",
  blocked: "拦截",
  challenge: "疑似挑战页",
  error: "失败",
};

function formatBytes(n?: number): string {
  if (n === undefined) return "未知大小";
  return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

function buildRobotsSection(report: AuditReport): string {
  const check = report.robots;
  const lines: string[] = [`### robots.txt · AI 爬虫访问规则 —— ${STATUS_LABEL[check.status]}`, ""];
  if (!check.exists) {
    if (check.fetchError) lines.push(`无法获取 robots.txt：${check.fetchError}`);
    else if (check.httpStatus === 404 || check.httpStatus === 410)
      lines.push("未部署 robots.txt，默认允许所有爬虫抓取");
    else if (check.httpStatus === 200)
      lines.push("服务器对 /robots.txt 返回了 HTML 页面（疑似软 404）");
    else lines.push("未部署 robots.txt");
    lines.push("");
    return lines.join("\n");
  }
  lines.push(`已找到 robots.txt（${formatBytes(check.sizeBytes)}）· 评估路径：${check.evaluatedPath}`, "");
  for (const bot of check.bots) {
    const rule = bot.rule
      ? `（${bot.rule.type === "allow" ? "Allow" : "Disallow"}: ${bot.rule.path}，第 ${bot.rule.line} 行）`
      : "";
    lines.push(`- ${bot.token}：${ROBOTS_VERDICT_LABEL[bot.verdict]}${rule}`);
    if (bot.note) lines.push(`  - ${bot.note}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildLlmsSection(report: AuditReport): string {
  const check = report.llmsTxt;
  const lines: string[] = [`### llms.txt —— ${STATUS_LABEL[check.status]}`, ""];
  if (check.exists) {
    lines.push(`已部署 llms.txt（${formatBytes(check.sizeBytes)}）。内容摘要（前 500 字符）：`, "", "```", check.summary ?? "", "```", "");
  } else if (check.fetchError) {
    lines.push(`无法获取 llms.txt：${check.fetchError}`, "");
  } else {
    lines.push(check.note ?? "未部署", "");
  }
  return lines.join("\n");
}

function buildJsonLdSection(report: AuditReport): string {
  const check = report.jsonLd;
  const lines: string[] = [`### JSON-LD 结构化数据 —— ${STATUS_LABEL[check.status]}`, ""];
  if (check.error) {
    lines.push(check.error, "");
    return lines.join("\n");
  }
  if (check.blockCount === 0) {
    lines.push("未检测到 JSON-LD 结构化数据", "");
    return lines.join("\n");
  }
  const validCount = check.blockCount - check.invalidCount;
  lines.push(
    check.invalidCount > 0
      ? `共 ${check.blockCount} 个数据块，解析成功 ${validCount}，存在但格式非法 ${check.invalidCount}`
      : `共 ${check.blockCount} 个数据块，全部解析成功`,
    "",
  );
  for (const { type, count } of check.typeCounts) {
    lines.push(`- ${type} ×${count}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildProbeSection(report: AuditReport): string {
  const check = report.probe;
  const lines: string[] = [`### AI 爬虫 UA 可达性探测 —— ${STATUS_LABEL[check.status]}`, ""];
  if (check.error) {
    lines.push(`探测失败：${check.error}`, "");
    return lines.join("\n");
  }
  const b = check.baseline;
  lines.push(
    b.fetchError
      ? `基线（Chrome UA）请求失败：${b.fetchError}`
      : `基线（Chrome UA）：HTTP ${b.httpStatus} · ${PROBE_VERDICT_LABEL[b.verdict]}${b.redirected ? ` · 重定向 → ${b.finalUrl}` : ""}`,
    "",
    "| 爬虫 | 状态码 | 判定 | 与基线差异 |",
    "| --- | --- | --- | --- |",
  );
  for (const r of check.results) {
    const status = r.httpStatus > 0 ? String(r.httpStatus) : "—";
    const diff = r.diff ?? "";
    lines.push(`| ${r.token} | ${status}${r.redirected ? " ↪" : ""} | ${PROBE_VERDICT_LABEL[r.verdict]} | ${diff} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildCsrSection(report: AuditReport): string {
  const check = report.csr;
  const lines: string[] = [`### 内容流失 · CSR 盲区 —— ${STATUS_LABEL[check.status]}`, ""];
  if (check.error) {
    lines.push(check.error, "");
    return lines.join("\n");
  }
  if (check.heavyCsr) lines.push("**重度 CSR 依赖：AI 爬虫可能只看到空壳**", "");
  lines.push(
    `服务器正文 ${check.serverLines} 行（${formatBytes(check.serverChars)}）· 渲染后 ${check.renderedLines} 行（${formatBytes(check.renderedChars)}）`,
    `行级重叠率：${(check.overlapRate * 100).toFixed(0)}%（重叠 ${check.overlapLines} 行 ÷ 渲染 ${check.renderedLines} 行）`,
    "",
  );
  if (check.injectedSamples.length > 0) {
    lines.push("仅存在于渲染后的行（JS 注入内容样例，前 10 条）：", "");
    for (const line of check.injectedSamples) {
      lines.push(`- ${line.length > 120 ? `${line.slice(0, 120)}…` : line}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function buildMarkdownReport(report: AuditReport, score: ScoreResult): string {
  const lines: string[] = [
    `# GEO 审计报告 — ${hostOf(report.url)}`,
    "",
    `- 站点：${report.url}`,
    `- 检测时间：${new Date(report.auditedAt).toLocaleString("zh-CN")}`,
    `- 综合评分：**${score.total} / 100 · 等级 ${score.grade}**`,
    "",
    "## 评分明细",
    "",
    "| 检测项 | 得分 | 满分 |",
    "| --- | --- | --- |",
    `| robots.txt AI 爬虫友好度 | ${score.breakdown.robots} | 30 |`,
    `| llms.txt | ${score.breakdown.llmsTxt} | 10 |`,
    `| Schema JSON-LD | ${score.breakdown.jsonLd} | 20 |`,
    `| 无 CSR 内容流失 | ${score.breakdown.csr} | 25 |`,
    `| AI 爬虫可达性 | ${score.breakdown.probe} | 15 |`,
    "",
    "## 检测结果",
    "",
    buildRobotsSection(report),
    buildLlmsSection(report),
    buildJsonLdSection(report),
    buildProbeSection(report),
    buildCsrSection(report),
    "## 建议动作",
    "",
  ];

  if (score.suggestions.length === 0) {
    lines.push("无——未发现需要处理的问题。");
  } else {
    score.suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  lines.push("");
  return lines.join("\n");
}
