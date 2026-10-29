// Self-contained collector logic, used in two ways:
// 1. The statically registered content script calls it at startup.
// 2. The service worker injects it on demand via
//    chrome.scripting.executeScript({ func: collectorMain }) when a tab has
//    no live collector (e.g. the page was loaded before the last extension
//    reload — the "Receiving end does not exist" failure on big sites).
// executeScript serializes the function source, so this function must not
// reference any outer identifier. Type-only imports are erased at compile
// time and are safe.

import type {
  ExtractJsonLdResponse,
  ParseServerHtmlMessage,
  ParseServerHtmlResponse,
} from "../shared/protocol";

export function collectorMain(): void {
  // Repeated injections (e.g. several retries) must not stack listeners.
  const w = window as unknown as { __geoAuditorCollector?: boolean };
  if (w.__geoAuditorCollector) return;
  w.__geoAuditorCollector = true;

  // Elements whose text content never appears visually in the rendered page.
  const STRIP_SELECTOR = "script, style, noscript, svg, template";

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      const type = (message as { type?: string } | undefined)?.type;

      if (type === "EXTRACT_JSONLD") {
        const rawBlocks = Array.from(
          document.querySelectorAll<HTMLScriptElement>(
            'script[type="application/ld+json"]',
          ),
        )
          .map((node) => node.textContent ?? "")
          .filter((text) => text.trim() !== "");
        sendResponse({ ok: true, rawBlocks } satisfies ExtractJsonLdResponse);
        return false; // synchronous response
      }

      if (type === "EXTRACT_RENDERED_TEXT") {
        sendResponse({
          ok: true,
          renderedText: document.body?.innerText ?? "",
        });
        return false;
      }

      if (type === "PARSE_SERVER_HTML") {
        const { html } = message as ParseServerHtmlMessage;
        // DOMParser never executes scripts — safe on untrusted HTML.
        const doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll(STRIP_SELECTOR).forEach((node) => node.remove());
        sendResponse({
          ok: true,
          serverText: doc.body?.textContent ?? "",
        } satisfies ParseServerHtmlResponse);
        return false;
      }

      return false;
    },
  );
}
