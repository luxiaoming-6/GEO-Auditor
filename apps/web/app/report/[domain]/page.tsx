import type { Metadata } from "next";
import AuditApp from "../../AuditApp";
import { reportUrl } from "../../../lib/siteUrl";

// Required by @cloudflare/next-on-pages: every dynamic route must run on the
// edge runtime. This page is a thin shell (client component + metadata), so
// edge rendering is safe.
export const runtime = "edge";

// Shareable report page: /report/{domain}. Opens with a fresh auto-started
// audit for the domain — there are no stored snapshots, so the URL only
// carries the domain (see reportUrl() in lib/siteUrl.ts).

interface PageProps {
  params: Promise<{ domain: string }>;
}

async function decodeDomain(raw: string): Promise<string> {
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const domain = await decodeDomain((await params).domain);
  const url = reportUrl(domain);
  const title = `${domain} 的 GEO 友好度检测报告`;
  const description = `查看 ${domain} 对 AI 搜索引擎（GEO）的友好度：robots.txt AI 爬虫规则、llms.txt、JSON-LD 结构化数据、内容流失、AI 爬虫 UA 可达性。`;
  return {
    alternates: { canonical: url },
    openGraph: { type: "website", url, title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function ReportPage({ params }: PageProps) {
  const domain = await decodeDomain((await params).domain);
  return <AuditApp initialDomain={domain} autoStart />;
}
