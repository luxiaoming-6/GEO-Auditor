// Score history persistence (chrome.storage.local), shared by the service
// worker (writes) and the popup (reads). Pure chrome.storage I/O — thin on
// purpose; geometry/copy helpers live in shared/format.ts and core/score.ts.

import { buildScore } from "@geo-auditor/audit-core";
import type { AuditReport, HistoryEntry } from "@geo-auditor/audit-core";

const HISTORY_KEY = "history";
// storage.local is shared surface; audits are tiny but cap anyway.
const HISTORY_CAP = 300;

export async function readHistory(): Promise<HistoryEntry[]> {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  return (data[HISTORY_KEY] as HistoryEntry[] | undefined) ?? [];
}

// Upsert by (host, auditedAt): a single-check retry rewrites the entry of the
// same audit run instead of adding a duplicate point on the curve.
export async function recordHistory(report: AuditReport): Promise<void> {
  let host = "";
  try {
    host = new URL(report.url).host;
  } catch {
    return; // not a normal page URL — skip recording
  }
  const { total, breakdown } = buildScore(report);
  const entry: HistoryEntry = { host, total, breakdown, auditedAt: report.auditedAt };
  const list = await readHistory();
  const idx = list.findIndex((e) => e.host === host && e.auditedAt === report.auditedAt);
  if (idx >= 0) list[idx] = entry;
  else list.unshift(entry);
  await chrome.storage.local.set({ [HISTORY_KEY]: list.slice(0, HISTORY_CAP) });
}
