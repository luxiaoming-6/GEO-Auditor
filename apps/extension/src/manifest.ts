import { defineManifest } from "@crxjs/vite-plugin";

// NOTE: the content script is statically registered for now; it answers
// EXTRACT_JSONLD messages from the service worker. On-demand injection via
// chrome.scripting.executeScript is deferred (revisit in M4) because crxjs
// emits content-script assets under content-hashed names, which breaks
// fixed `files:` paths.
// TODO: add action/default icons (16/32/48/128) before store submission.
export default defineManifest({
  manifest_version: 3,
  name: "GEO Auditor",
  description: "一键检测当前网站对 AI 搜索引擎（GEO）的友好度",
  version: "0.2.0",
  // 103+: AbortSignal.timeout used by SW fetches.
  minimum_chrome_version: "103",
  permissions: [
    // Read the active tab URL once the user opens the popup (no "tabs" needed).
    "activeTab",
    // On-demand injection of the content-script collector (M2+).
    "scripting",
    // Cache the last audit report in chrome.storage.session.
    "storage",
    // Rewrite the User-Agent of probe requests via session rules (M3).
    "declarativeNetRequestWithHostAccess",
  ],
  // The service worker must be able to fetch robots.txt / llms.txt / server
  // HTML and fire UA probe requests against any site the user is auditing.
  host_permissions: ["<all_urls>"],
  action: {
    default_popup: "src/popup/index.html",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/collector.ts"],
    },
  ],
});
