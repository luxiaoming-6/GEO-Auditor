import AuditApp from "./AuditApp";
import { SITE_URL } from "../lib/siteUrl";

// WebApplication schema for the home page (server component — JSON-LD must
// be injected server-side so AI crawlers can read it).
const webAppJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "BotGaze",
  url: `${SITE_URL}/`,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
  description:
    "免费检测网站在 ChatGPT、Perplexity 等 AI 搜索引擎中的可见性与引用情况，生成 GEO 优化建议报告。",
};

// FAQ copy — single source of truth for both the visible FAQ section and the
// FAQPage JSON-LD, so the two can never drift apart.
const FAQ_ITEMS = [
  {
    q: "GEO 和 SEO 有什么区别？",
    a: "SEO 面向百度、Google 等传统搜索引擎的网页排名；GEO（Generative Engine Optimization，生成式引擎优化）面向 ChatGPT、Perplexity 等 AI 搜索引擎，目标是让内容更容易被 AI 爬虫抓取、理解并在回答中引用。两者不冲突：GEO 在 SEO 基础上补齐 AI 渠道的可见性。",
  },
  {
    q: "为什么我的网站在 AI 搜索里搜不到？",
    a: "常见原因有四类：robots.txt 禁止了 GPTBot 等 AI 爬虫；防火墙或 WAF 按 User-Agent 拦截 AI 爬虫；页面正文依赖 JavaScript 渲染（CSR 空壳），AI 爬虫抓到的 HTML 里几乎没有正文；缺少 JSON-LD 结构化数据，AI 难以理解页面主题。用 BotGaze 输入网址即可定位具体原因。",
  },
  {
    q: "允许 AI 爬虫抓取是好事还是坏事？",
    a: "取决于你的目标。希望被 AI 搜索引擎引用、获得 AI 渠道流量，就应该放行 GPTBot、PerplexityBot 等爬虫；如果不希望内容被用于模型训练，可以只放行搜索类爬虫（如 OAI-SearchBot、Claude-SearchBot、PerplexityBot），禁掉训练类爬虫（如 GPTBot、CCBot）。",
  },
  {
    q: "什么是 CSR 空壳？怎么解决？",
    a: "CSR（客户端渲染）页面把正文放在 JavaScript 里，浏览器打开后才渲染出来。AI 爬虫大多不执行 JavaScript，抓到的服务端 HTML 只有一个空的挂载点。解决办法是把核心正文改为服务端渲染（SSR/SSG）：Next.js 用 Server Components 或静态生成，WordPress 保持主题服务端输出，React/Vue SPA 加预渲染（prerender）。",
  },
  {
    q: "BotGaze 免费吗？需要注册吗？",
    a: "完全免费，无需注册。输入网址即可生成报告，每份报告都有独立链接，可以直接分享给同事或客户。",
  },
];

// FAQPage schema — built from the same FAQ_ITEMS as the visible section.
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

// Server-rendered explanatory content below the tool. This is the page's
// main body text: AI crawlers don't execute JS, so this static HTML (not the
// client-rendered audit form) is what they actually read and cite.
function StaticContent() {
  return (
    <>
      <section className="static-content">
        <h2>BotGaze 是什么？</h2>
        <p>
          BotGaze 是一款免费的 GEO 检测工具：输入网址，即可检测你的网站在 ChatGPT、Perplexity、Claude 等 AI
          搜索引擎眼中的友好度。AI 搜索正在成为新的流量入口——如果你的内容对 AI 爬虫不友好，就不会出现在 AI
          生成的回答里。
        </p>
        <p>
          检测完全免费、无需注册，报告基于服务端真实请求生成，包含评分、分级和逐条优化建议，并生成可分享的链接。
        </p>
      </section>

      <section className="static-content">
        <h2>检测原理：五项检测</h2>
        <ol>
          <li>
            <b>robots.txt AI 爬虫规则</b>
            ：解析 robots.txt，逐个检查 GPTBot、ClaudeBot、PerplexityBot、Bytespider 等 9 个主流 AI
            爬虫是允许还是禁止抓取。
          </li>
          <li>
            <b>llms.txt</b>
            ：检查站点是否提供 /llms.txt——一份面向大语言模型的站点说明文件，帮助 AI 快速了解你的网站。
          </li>
          <li>
            <b>JSON-LD 结构化数据</b>
            ：统计页面 schema.org 结构化数据的 @type 分布，结构化数据能帮助 AI 更准确地理解并引用你的内容。
          </li>
          <li>
            <b>AI 爬虫实测</b>
            ：模拟 9 个 AI 爬虫的 User-Agent 真实访问你的页面，并与普通浏览器基线对比，发现被防火墙/WAF
            悄悄拦截的情况（robots.txt 是君子协定，实际拦截要实测才知道）。
          </li>
          <li>
            <b>CSR 内容流失</b>
            ：估算服务端 HTML 中可见正文的含量。依赖 JavaScript 渲染的页面（CSR 空壳）对 AI 爬虫几乎是空白的。
          </li>
        </ol>
      </section>

      <section className="static-content">
        <h2>常见问题</h2>
        {FAQ_ITEMS.map((item) => (
          <div key={item.q} className="faq-item">
            <h3>{item.q}</h3>
            <p>{item.a}</p>
          </div>
        ))}
      </section>
    </>
  );
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppJsonLd) }}
      />
      {/* bottomSlot keeps the explanatory content server-rendered while
          AuditApp (the interactive form) stays a client component. */}
      <AuditApp showPremium bottomSlot={<StaticContent />} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </>
  );
}
