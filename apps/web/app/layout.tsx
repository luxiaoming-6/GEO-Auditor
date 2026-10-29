import type { Metadata } from "next";
import Script from "next/script";
import { SITE_URL } from "../lib/siteUrl";
import "./globals.css";

// Baidu Tongji injection — only when analytics is enabled for this build
// (NEXT_PUBLIC_ANALYTICS_ENABLED, see .env.local / Cloudflare Pages vars).
// The _hmt queue is declared before the script tag loads, as required by
// Baidu. The site id comes from the environment, never hardcoded.
const BAIDU_ID = process.env.NEXT_PUBLIC_BAIDU_TONGJI_ID;
const BAIDU_SNIPPET = `var _hmt = _hmt || [];
(function() {
  var hm = document.createElement("script");
  hm.src = "https://hm.baidu.com/hm.js?${BAIDU_ID}";
  var s = document.getElementsByTagName("script")[0];
  s.parentNode.insertBefore(hm, s);
})();`;
const ANALYTICS_ENABLED = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "1";

// metadataBase makes every relative canonical/OG url resolve against the
// configured site origin (NEXT_PUBLIC_SITE_URL) — no hardcoded domains.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "GEO Auditor — AI 搜索友好度检测",
  description:
    "输入网址，检测网站对 AI 搜索引擎（GEO）的友好度：robots.txt AI 爬虫规则、llms.txt、JSON-LD 结构化数据、AI 爬虫 UA 可达性。",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "GEO Auditor",
    url: "/",
    title: "GEO Auditor — AI 搜索友好度检测",
    description:
      "输入网址，检测网站对 AI 搜索引擎（GEO）的友好度：robots.txt AI 爬虫规则、llms.txt、JSON-LD 结构化数据、AI 爬虫 UA 可达性。",
  },
  twitter: {
    card: "summary",
    title: "GEO Auditor — AI 搜索友好度检测",
    description:
      "输入网址，检测网站对 AI 搜索引擎（GEO）的友好度：robots.txt AI 爬虫规则、llms.txt、JSON-LD 结构化数据、AI 爬虫 UA 可达性。",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        {ANALYTICS_ENABLED && BAIDU_ID && (
          <Script
            id="baidu-tongji"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{ __html: BAIDU_SNIPPET }}
          />
        )}
      </body>
    </html>
  );
}
