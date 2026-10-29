import { describe, expect, it } from "vitest";
import {
  aggregateProbeStatus,
  classifyProbe,
  describeDiff,
} from "@geo-auditor/audit-core";
import type { ProbeResult } from "@geo-auditor/audit-core";

describe("classifyProbe", () => {
  it("classifies 403/429/503 as blocked", () => {
    for (const status of [403, 429, 503]) {
      expect(classifyProbe(status, "<html>anything</html>")).toMatchObject({
        verdict: "blocked",
      });
    }
  });

  it("classifies challenge signatures on 200 (case-insensitive)", () => {
    expect(classifyProbe(200, "Just a moment...")).toMatchObject({
      verdict: "challenge",
    });
    expect(classifyProbe(200, "Please solve the CAPTCHA")).toMatchObject({
      verdict: "challenge",
    });
    expect(classifyProbe(200, "checking your CHALLENGE placement")).toMatchObject({
      verdict: "challenge",
    });
  });

  it("classifies very short 200 bodies as suspected challenge pages", () => {
    expect(classifyProbe(200, "denied")).toMatchObject({ verdict: "challenge" });
  });

  it("classifies normal 200 bodies as accessible", () => {
    const body = "x".repeat(300);
    expect(classifyProbe(200, body)).toMatchObject({ verdict: "accessible" });
  });

  it("treats non-WAF statuses as accessible with a note", () => {
    const result = classifyProbe(404, "x".repeat(300));
    expect(result.verdict).toBe("accessible");
    expect(result.note).toContain("404");
  });

  it("does not flag full page HTML merely containing 'challenge' (yoast false positive)", () => {
    const body = `<html><head><title>Yoast - SEO for everyone</title></head><body>${"challenge ".repeat(2000)}</body></html>`;
    expect(classifyProbe(200, body)).toMatchObject({ verdict: "accessible" });
  });

  it("flags a Cloudflare interstitial via its <title> even on a large body", () => {
    const body = `<html><head><title>Just a moment...</title></head><body>${"x".repeat(20000)}</body></html>`;
    expect(classifyProbe(200, body)).toMatchObject({ verdict: "challenge" });
  });

  it("flags weak signatures only on short interstitial-sized bodies", () => {
    const small = `<html><title>blocked</title><body>captcha required</body></html>`;
    expect(classifyProbe(200, small)).toMatchObject({ verdict: "challenge" });
    const big = `<html><title>ok</title><body>${"captcha ".repeat(3000)}</body></html>`;
    expect(classifyProbe(200, big)).toMatchObject({ verdict: "accessible" });
  });
});

describe("describeDiff", () => {
  it("reports status-code changes", () => {
    expect(
      describeDiff({ verdict: "accessible", httpStatus: 200 }, { verdict: "blocked", httpStatus: 403 }),
    ).toBe("状态码 200 → 403");
  });

  it("reports identical results", () => {
    expect(
      describeDiff({ verdict: "accessible", httpStatus: 200 }, { verdict: "accessible", httpStatus: 200 }),
    ).toBe("与基线一致");
  });

  it("handles failed baseline / failed probe", () => {
    expect(
      describeDiff({ verdict: "error", httpStatus: 0 }, { verdict: "blocked", httpStatus: 403 }),
    ).toBe("基线失败，无法对比");
    expect(
      describeDiff({ verdict: "accessible", httpStatus: 200 }, { verdict: "error", httpStatus: 0 }),
    ).toBe("请求失败");
  });
});

function result(overrides: Partial<ProbeResult>): ProbeResult {
  return {
    token: "GPTBot",
    vendor: "OpenAI",
    category: "training",
    httpStatus: 200,
    finalUrl: "https://example.com/",
    redirected: false,
    bodySnippet: "x".repeat(300),
    verdict: "accessible",
    ...overrides,
  };
}

describe("aggregateProbeStatus", () => {
  it("passes when everything is accessible", () => {
    expect(aggregateProbeStatus([result({}), result({ token: "CCBot" })])).toBe("pass");
  });

  it("fails when a search bot is blocked", () => {
    expect(
      aggregateProbeStatus([
        result({}),
        result({ token: "OAI-SearchBot", category: "search", verdict: "blocked", httpStatus: 403 }),
      ]),
    ).toBe("fail");
  });

  it("warns when only training/user bots are affected", () => {
    expect(
      aggregateProbeStatus([result({ verdict: "blocked", httpStatus: 403 })]),
    ).toBe("warn");
    expect(
      aggregateProbeStatus([
        result({ token: "ChatGPT-User", category: "user", verdict: "challenge" }),
      ]),
    ).toBe("warn");
  });

  it("warns on transport errors", () => {
    expect(aggregateProbeStatus([result({ verdict: "error", httpStatus: 0 })])).toBe("warn");
  });
});
