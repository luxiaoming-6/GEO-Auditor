// /llms.txt existence check and summary (pure logic, no chrome.* APIs).

import type { LlmsTxtCheck } from "./types";

export const LLMS_SUMMARY_CHARS = 500;

export interface LlmsFetchOutcome {
  fetchError?: string;
  httpStatus?: number;
  contentType?: string;
  body?: string;
}

export function buildLlmsTxtCheck(outcome: LlmsFetchOutcome): LlmsTxtCheck {
  if (outcome.fetchError) {
    return { status: "fail", exists: false, fetchError: outcome.fetchError };
  }

  const httpStatus = outcome.httpStatus as number;
  const contentType = (outcome.contentType ?? "").toLowerCase();

  if (httpStatus === 200) {
    // Soft-404 guard: hosting platforms often answer unknown paths with HTML.
    if (contentType.includes("text/html")) {
      return {
        status: "warn",
        exists: false,
        httpStatus,
        note: "未部署（服务器返回了 HTML 页面，疑似软 404）",
      };
    }
    const body = outcome.body ?? "";
    return {
      status: "pass",
      exists: true,
      httpStatus,
      summary: body.slice(0, LLMS_SUMMARY_CHARS),
      sizeBytes: new TextEncoder().encode(body).length,
    };
  }
  if (httpStatus === 404 || httpStatus === 410) {
    return { status: "warn", exists: false, httpStatus, note: "未部署" };
  }
  return {
    status: "warn",
    exists: false,
    httpStatus,
    note: `无法访问（HTTP ${httpStatus}）`,
  };
}
