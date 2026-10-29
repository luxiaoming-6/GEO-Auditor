// Shared report types for all audit checks.

export type CheckStatus = "pass" | "warn" | "fail";

export interface TypeCount {
  type: string;
  count: number;
}

export interface BotResult {
  token: string;
  category: "search" | "training" | "user" | "other";
  verdict: "allow" | "disallow" | "not-mentioned" | "info";
  rule?: { type: "allow" | "disallow"; path: string; line: number };
  note?: string;
}

export interface RobotsCheck {
  status: CheckStatus;
  exists: boolean;
  evaluatedPath: string;
  bots: BotResult[];
  httpStatus?: number;
  sizeBytes?: number;
  fetchError?: string;
}

export interface LlmsTxtCheck {
  status: CheckStatus;
  exists: boolean;
  httpStatus?: number;
  summary?: string;
  sizeBytes?: number;
  note?: string;
  fetchError?: string;
}

export interface JsonLdCheck {
  status: CheckStatus;
  blockCount: number;
  invalidCount: number;
  typeCounts: TypeCount[];
  error?: string;
}

// ---------- M3: UA reachability probe ----------

export type ProbeVerdict = "accessible" | "blocked" | "challenge" | "error";

export interface ProbeBaseline {
  httpStatus: number;
  finalUrl: string;
  redirected: boolean;
  // First 200 chars of the response body.
  bodySnippet: string;
  verdict: ProbeVerdict;
  fetchError?: string;
}

export interface ProbeResult {
  token: string;
  vendor: string;
  category: "search" | "training" | "user" | "other";
  httpStatus: number;
  finalUrl: string;
  redirected: boolean;
  bodySnippet: string;
  verdict: ProbeVerdict;
  // Why the verdict was chosen (signature hit, short body, HTTP status...).
  note?: string;
  // Difference vs the Chrome-UA baseline, e.g. "状态码 200 → 403".
  diff?: string;
  fetchError?: string;
}

export interface ProbeCheck {
  status: CheckStatus;
  targetUrl: string;
  baseline: ProbeBaseline;
  results: ProbeResult[];
  // Module-level failure (probe phase itself crashed); results is empty then.
  error?: string;
}

// ---------- M4: CSR content-loss ----------

// Web-edition estimate: no real renderer exists on the edge runtime, so the
// check scores the visible text volume of the server HTML — exactly what
// non-JS AI crawlers see. Not comparable to the extension's rendered-DOM diff.
export interface CsrEstimate {
  // Visible text chars extracted from the server HTML (whitespace collapsed).
  visibleChars: number;
  // Raw HTML size the estimate was derived from.
  htmlChars: number;
  // Human-readable CSR signals backing the level (noscript hints, empty SPA
  // mount points, script-heavy markup).
  signals: string[];
  // low: server text rich; medium: thin; high: suspected empty shell.
  level: "low" | "medium" | "high";
}

export interface CsrCheck {
  status: CheckStatus;
  serverChars: number;
  renderedChars: number;
  serverLines: number;
  renderedLines: number;
  overlapLines: number;
  overlapRate: number;
  // Server text is an empty shell (<200 chars) while the rendered page is
  // rich (>1000 chars): heavy CSR dependency.
  heavyCsr: boolean;
  injectedSamples: string[];
  // Web-edition estimate (see CsrEstimate). Mutually exclusive with the
  // rendered-DOM comparison fields, which stay zero-filled.
  estimate?: CsrEstimate;
  // Set when the check cannot run at all in the current environment (the web
  // edition has no real browser renderer). Scored as 0 with a dedicated
  // suggestion; the extension never sets it.
  skipped?: boolean;
  error?: string;
}

export interface AuditReport {
  url: string;
  origin: string;
  auditedAt: number;
  robots: RobotsCheck;
  llmsTxt: LlmsTxtCheck;
  jsonLd: JsonLdCheck;
  probe: ProbeCheck;
  csr: CsrCheck;
}

// ---------- v1.1: score history (chrome.storage.local) ----------

export interface HistoryEntry {
  host: string;
  total: number;
  breakdown: {
    robots: number;
    llmsTxt: number;
    jsonLd: number;
    csr: number;
    probe: number;
  };
  auditedAt: number;
}
