import type { Metadata } from "next";
import AuditApp from "../../AuditApp";
import { reportUrl } from "../../../lib/siteUrl";

// Required by @cloudflare/next-on-pages: every dynamic route must run on the
// edge runtime. This page is a thin shell (client component + metadata), so
// edge rendering is safe. Do not remove this export.
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

function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "什么是 GEO？",
        acceptedAnswer: {
          "@type": "Answer",
          text: "GEO（Generative Engine Optimization，生成式引擎优化）指让网站内容更容易被 ChatGPT、Perplexity 等 AI 搜索引擎引用和推荐的优化方法，可以理解为面向 AI 引擎的 SEO。",
        },
      },
      {
        "@type": "Question",
        name: "为什么我的网站没被 AI 引用？",
        acceptedAnswer: {
          "@type": "Answer",
          text: "常见原因包括：robots.txt 禁止了 GPTBot 等 AI 爬虫、未部署 llms.txt、缺少 JSON-LD 结构化数据、页面正文主要由 JavaScript 渲染导致 AI 爬虫读不到内容。",
        },
      },
      {
        "@type": "Question",
        name: "如何提升 AI 可见性？",
        acceptedAnswer: {
          "@type": "Answer",
          text: "放行 AI 爬虫、部署 llms.txt、补充 JSON-LD 结构化数据、增加服务端可见正文，并持续监控各 AI 引擎的引用变化。",
        },
      },
    ],
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const domain = await decodeDomain((await params).domain);
  const url = reportUrl(domain);
  const title = `${domain} 的 GEO 检测报告 - AI 引用分析`;
  const description = `检测 ${domain} 在 ChatGPT/Perplexity 等 AI 引擎中的可见性与引用情况，含 robots.txt AI 爬虫规则、llms.txt、JSON-LD 结构化数据分析。`;
  return {
    title: { absolute: title },
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
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

export default async function ReportPage({ params }: PageProps) {
  const domain = await decodeDomain((await params).domain);
  const url = reportUrl(domain);
  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${domain} 的 GEO 检测报告 - AI 引用分析`,
    url,
    description: `检测 ${domain} 在 ChatGPT/Perplexity 等 AI 引擎中的可见性与引用情况。`,
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }}
      />
      <AuditApp initialDomain={domain} autoStart showPremium />
    </>
  );
}
