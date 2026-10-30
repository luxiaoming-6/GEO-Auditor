// Build-time helpers for the git-based report archive (content/reports/*.json).
// Reads happen on Node during static generation / dev requests — this module
// must never be imported from an edge-runtime route (fs is unavailable there).
// Each archive file is the raw AuditReport JSON saved by server.mjs.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  buildScore,
  type AuditReport,
  type ScoreResult,
} from "@geo-auditor/audit-core";

export interface StoredReportWithScore {
  domain: string;
  report: AuditReport;
  score: ScoreResult;
}

function reportsDir(): string {
  return path.join(process.cwd(), "content", "reports");
}

// Same guard as server.mjs: filenames are hostname-derived.
const DOMAIN_RE = /^[a-z0-9.-]+$/;

export async function listStoredReports(): Promise<StoredReportWithScore[]> {
  let files: string[];
  try {
    files = await readdir(reportsDir());
  } catch {
    // Directory not created yet (no reports archived so far).
    return [];
  }
  const out: StoredReportWithScore[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const domain = file.slice(0, -".json".length);
    try {
      const raw = await readFile(path.join(reportsDir(), file), "utf8");
      const report = JSON.parse(raw) as AuditReport;
      out.push({ domain, report, score: buildScore(report) });
    } catch {
      // Skip corrupted files instead of failing the whole build.
    }
  }
  return out.sort((a, b) => b.report.auditedAt - a.report.auditedAt);
}

export async function getStoredReport(
  domain: string,
): Promise<StoredReportWithScore | null> {
  if (!DOMAIN_RE.test(domain)) return null;
  try {
    const raw = await readFile(path.join(reportsDir(), `${domain}.json`), "utf8");
    const report = JSON.parse(raw) as AuditReport;
    return { domain, report, score: buildScore(report) };
  } catch {
    return null;
  }
}

export function formatCnDateTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}
