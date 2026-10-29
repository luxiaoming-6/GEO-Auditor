// Preset AI crawler list. The `token` is the identifier used in robots.txt
// User-agent lines; `ua` is the real User-Agent string used by M3 probe
// requests (DNR session rules) — verify UA values again at M3, vendors drift.

export interface BotSpec {
  token: string;
  vendor: string;
  category: "search" | "training" | "user" | "other";
  ua?: string;
}

export const AI_BOTS: BotSpec[] = [
  {
    token: "GPTBot",
    vendor: "OpenAI",
    category: "training",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)",
  },
  {
    token: "OAI-SearchBot",
    vendor: "OpenAI",
    category: "search",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
  },
  {
    token: "ChatGPT-User",
    vendor: "OpenAI",
    category: "user",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
  },
  {
    token: "ClaudeBot",
    vendor: "Anthropic",
    category: "training",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  },
  {
    token: "Claude-SearchBot",
    vendor: "Anthropic",
    category: "search",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +claudebot@anthropic.com)",
  },
  {
    token: "PerplexityBot",
    vendor: "Perplexity",
    category: "search",
    ua: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  },
  {
    token: "Bytespider",
    vendor: "ByteDance",
    category: "training",
    ua: "Mozilla/5.0 (compatible; Bytespider; +https://zhanzhang.toutiao.com/)",
  },
  {
    token: "CCBot",
    vendor: "Common Crawl",
    category: "training",
    ua: "CCBot/2.0 (https://commoncrawl.org/faq/)",
  },
  {
    token: "Applebot-Extended",
    vendor: "Apple",
    category: "training",
    ua: "Mozilla/5.0 (compatible; Applebot-Extended/1.0; +http://www.apple.com/go/applebot)",
  },
];

export const GOOGLE_EXTENDED_TOKEN = "Google-Extended";

// Fixed copy mandated by the spec. Google-Extended has no crawler of its own;
// the token only flags Google's AI use of Googlebot-fetched content.
export const GOOGLE_EXTENDED_NOTE =
  "该token由Google前台控制，无独立爬虫，需检查Googlebot是否被允许";
