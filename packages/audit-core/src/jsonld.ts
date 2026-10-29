// JSON-LD extraction and @type statistics (pure logic, no chrome.* APIs).

import type { JsonLdCheck, TypeCount } from "./types";

// High-value types for GEO / AI-search visibility, highlighted in the popup.
export const GEO_KEY_TYPES = new Set([
  "Organization",
  "WebSite",
  "Article",
  "Product",
  "FAQPage",
  "HowTo",
  "BreadcrumbList",
  "LocalBusiness",
]);

function collectTypes(node: unknown, out: Map<string, number>): void {
  if (Array.isArray(node)) {
    for (const child of node) collectTypes(child, out);
    return;
  }
  if (typeof node !== "object" || node === null) return;

  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  if (typeof type === "string") {
    out.set(type, (out.get(type) ?? 0) + 1);
  } else if (Array.isArray(type)) {
    for (const item of type) {
      if (typeof item === "string") out.set(item, (out.get(item) ?? 0) + 1);
    }
  }
  // Walk nested structures, including the @graph container.
  if (obj["@graph"] !== undefined) collectTypes(obj["@graph"], out);
}

export function parseJsonLdBlocks(rawBlocks: string[]): JsonLdCheck {
  let invalidCount = 0;
  const counts = new Map<string, number>();

  for (const raw of rawBlocks) {
    try {
      collectTypes(JSON.parse(raw), counts);
    } catch {
      invalidCount += 1; // exists but malformed: reported, not silently dropped
    }
  }

  const typeCounts: TypeCount[] = [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  let status: JsonLdCheck["status"];
  if (rawBlocks.length === 0) status = "warn";
  else if (invalidCount === rawBlocks.length) status = "fail";
  else if (invalidCount > 0) status = "warn";
  else status = "pass";

  return {
    status,
    blockCount: rawBlocks.length,
    invalidCount,
    typeCounts,
  };
}
