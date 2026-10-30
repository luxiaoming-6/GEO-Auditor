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
  title: {
    default: "GEO Auditor - 免费 AI 引用检测工具",
    template: "%s | GEO Auditor",
  },
  description:
    "免费检测网站在 ChatGPT、Perplexity 等 AI 搜索引擎中的可见性与引用情况，生成 GEO 优化建议报告。",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "GEO Auditor",
    url: "/",
    title: "GEO Auditor - 免费 AI 引用检测工具",
    description:
      "免费检测网站在 ChatGPT、Perplexity 等 AI 搜索引擎中的可见性与引用情况，生成 GEO 优化建议报告。",
    images: [{ url: "/og-image.jpg", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GEO Auditor - 免费 AI 引用检测工具",
    description:
      "免费检测网站在 ChatGPT、Perplexity 等 AI 搜索引擎中的可见性与引用情况，生成 GEO 优化建议报告。",
    images: ["/og-image.jpg"],
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
