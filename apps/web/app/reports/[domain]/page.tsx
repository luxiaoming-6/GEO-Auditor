import type { Metadata } from "next";
import ReportArticle from "../../../components/ReportArticle";
import {
  getStoredReport,
  listStoredReports,
} from "../../../lib/reportsContent";
import { SITE_URL } from "../../../lib/siteUrl";

// Static report article: /reports/{domain}. Fully prerendered from
// content/reports at build time — no edge runtime here (fs must stay
// build-time only), and unknown domains 404 instead of falling back to
// dynamic rendering.
export const dynamicParams = false;

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

export async function generateStaticParams(): Promise<Array<{ domain: string }>> {
  return (await listStoredReports()).map(({ domain }) => ({ domain }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const domain = await decodeDomain((await params).domain);
  const stored = await getStoredReport(domain);
  const title = `${domain} 的 GEO 检测报告 - AI 引用分析`;
  const description = stored
    ? `${domain} GEO 检测得分 ${stored.score.total}/${stored.score.max}（等级 ${stored.score.grade}）：robots.txt AI 爬虫规则、llms.txt、JSON-LD 结构化数据、AI 爬虫可达性与内容流失五项检测详情与改进建议。`
    : `${domain} 的 GEO 检测报告。`;
  return {
    title: { absolute: title },
    alternates: { canonical: `/reports/${domain}` },
    openGraph: {
      type: "article",
      url: `/reports/${domain}`,
      title,
      description,
      images: [{ url: "/og-image.jpg", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.jpg"],
    },
  };
}

export default async function ReportArticlePage({ params }: PageProps) {
  const domain = await decodeDomain((await params).domain);
  const stored = await getStoredReport(domain);
  // dynamicParams = false makes this unreachable; kept as a type guard.
  if (!stored) return null;

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${domain} 的 GEO 检测报告`,
    description: `${domain} 的 GEO（AI 引用友好度）检测报告：五项检测详情与改进建议。`,
    datePublished: new Date(stored.report.auditedAt).toISOString(),
    dateModified: new Date(stored.report.auditedAt).toISOString(),
    mainEntityOfPage: `${SITE_URL}/reports/${domain}`,
    author: { "@type": "Organization", name: "BotGaze", url: `${SITE_URL}/` },
    publisher: { "@type": "Organization", name: "BotGaze", url: `${SITE_URL}/` },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <ReportArticle stored={stored} />
    </>
  );
}
