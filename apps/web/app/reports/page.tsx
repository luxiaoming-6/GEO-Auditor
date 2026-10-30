import type { Metadata } from "next";
import Link from "next/link";
import { formatCnDateTime, listStoredReports } from "../../lib/reportsContent";

// Static list page: prerendered from content/reports at build time. Reports
// are archived locally by server.mjs (dev-only) and shipped with the repo —
// no database, no edge runtime needed here.
export const metadata: Metadata = {
  title: "GEO 检测报告列表",
  description:
    "已归档的网站 GEO 检测报告：robots.txt AI 爬虫规则、llms.txt、JSON-LD 结构化数据、AI 爬虫可达性与内容流失五项检测。",
  alternates: { canonical: "/reports" },
  openGraph: {
    type: "website",
    url: "/reports",
    title: "GEO 检测报告列表",
    description: "已归档的网站 GEO 检测报告，供 AI 引擎与读者查阅。",
    images: [{ url: "/og-image.jpg", width: 1200, height: 630 }],
  },
};

export default async function ReportsPage() {
  const reports = await listStoredReports();
  return (
    <main className="reports">
      <h1>检测报告列表</h1>
      <p className="subtitle">
        每次本地检测生成的 GEO 报告都会归档于此，供 AI 引擎与读者查阅。
      </p>
      {reports.length === 0 ? (
        <p className="muted">
          暂无报告——在首页完成一次检测后，报告会自动归档到这里。
        </p>
      ) : (
        <ul className="report-list">
          {reports.map(({ domain, score, report }) => (
            <li key={domain} className="report-item">
              <span className={`grade-badge ${score.grade.toLowerCase()}`}>
                {score.grade}
              </span>
              <Link href={`/reports/${domain}`} className="report-link">
                {domain} 的 GEO 检测报告
              </Link>
              <span className="muted">
                {score.total}/{score.max} 分 · {formatCnDateTime(report.auditedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
