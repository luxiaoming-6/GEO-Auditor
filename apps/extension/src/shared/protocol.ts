// Message protocol between popup / service worker / content script.

import type { AuditReport } from "@geo-auditor/audit-core";

export interface AuditStartMessage {
  type: "AUDIT_START";
}

export type AuditResponse =
  | { ok: true; report: AuditReport }
  | { ok: false; error: string };

export interface ExtractJsonLdMessage {
  type: "EXTRACT_JSONLD";
}

export interface ExtractJsonLdResponse {
  ok: true;
  rawBlocks: string[];
}

// Progress event pushed by the service worker during the M3 UA probe phase
// (serial, one per bot). Fire-and-forget: the popup may be closed.
export interface ProbeProgressMessage {
  type: "PROBE_PROGRESS";
  token: string;
  index: number;
  total: number;
}

// ---------- M4: CSR content-loss ----------

export interface ExtractRenderedTextMessage {
  type: "EXTRACT_RENDERED_TEXT";
}

export interface ExtractRenderedTextResponse {
  ok: true;
  renderedText: string;
}

// The service worker has no DOMParser (MV3), so it fetches the raw server
// HTML and the content script reduces it to text on the SW's behalf.
export interface ParseServerHtmlMessage {
  type: "PARSE_SERVER_HTML";
  html: string;
}

export interface ParseServerHtmlResponse {
  ok: true;
  serverText: string;
}

// ---------- v1.1: single-check retry ----------

export type RetryableCheck = "jsonld" | "csr";

export interface RetryCheckMessage {
  type: "RETRY_CHECK";
  check: RetryableCheck;
}

export interface RetryCheckResponse {
  ok: boolean;
  report?: AuditReport;
  error?: string;
}
