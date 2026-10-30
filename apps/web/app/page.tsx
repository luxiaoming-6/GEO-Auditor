import AuditApp from "./AuditApp";
import { SITE_URL } from "../lib/siteUrl";

// WebApplication schema for the home page (server component — JSON-LD must
// be injected server-side so AI crawlers can read it).
const webAppJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "GEO Auditor",
  url: `${SITE_URL}/`,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
  description:
    "免费检测网站在 ChatGPT、Perplexity 等 AI 搜索引擎中的可见性与引用情况，生成 GEO 优化建议报告。",
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppJsonLd) }}
      />
      <AuditApp />
    </>
  );
}
