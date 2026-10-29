import { describe, expect, it } from "vitest";
import { buildMarkdownReport } from "../src/core/markdown";
import { buildScore, gradeFor } from "@geo-auditor/audit-core";
import type { AuditReport, ProbeResult } from "@geo-auditor/audit-core";

// ---------- fixtures ----------

const PROBE_TOKENS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "Bytespider",
  "CCBot",
  "Applebot-Extended",
];

function probeResults(verdict: ProbeResult["verdict"]): ProbeResult[] {
  return PROBE_TOKENS.map((token) => ({
    token,
    vendor: "test",
    category: "search" as const,
    httpStatus: verdict === "blocked" ? 403 : 200,
    finalUrl: "https://example.com/",
    redirected: false,
    bodySnippet: "",
    verdict,
  }));
}

// example.com-like baseline: everything reachable, no llms.txt, no JSON-LD.
function makeReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    url: "https://example.com/",
    origin: "https://example.com",
    auditedAt: 1730000000000,
    robots: { status: "pass", exists: false, evaluatedPath: "/", bots: [] },
    llmsTxt: { status: "warn", exists: false },
    jsonLd: { status: "fail", blockCount: 0, invalidCount: 0, typeCounts: [] },
    probe: {
      status: "pass",
      targetUrl: "https://example.com/",
      baseline: {
        httpStatus: 200,
        finalUrl: "https://example.com/",
        redirected: false,
        bodySnippet: "",
        verdict: "accessible",
      },
      results: probeResults("accessible"),
    },
    csr: {
      status: "pass",
      serverChars: 100,
      renderedChars: 100,
      serverLines: 3,
      renderedLines: 3,
      overlapLines: 3,
      overlapRate: 1,
      heavyCsr: false,
      injectedSamples: [],
    },
    ...overrides,
  };
}

// ---------- scoring ----------

describe("gradeFor", () => {
  it.each([
    [100, "A"],
    [85, "A"],
    [84, "B"],
    [70, "B"],
    [69, "C"],
    [50, "C"],
    [49, "D"],
    [0, "D"],
  ] as const)("gradeFor(%i) = %s", (total, grade) => {
    expect(gradeFor(total)).toBe(grade);
  });
});

describe("buildScore", () => {
  it("scores the example.com case at 70 = grade B", () => {
    const score = buildScore(makeReport());
    // robots 30 + llms 0 + jsonld 0 + csr 25 + probe 15
    expect(score.total).toBe(70);
    expect(score.grade).toBe("B");
    expect(score.breakdown).toEqual({ robots: 30, llmsTxt: 0, jsonLd: 0, csr: 25, probe: 15 });
    expect(score.suggestions).toHaveLength(2); // llms + jsonld
  });

  it("treats a skipped CSR (web edition) as 0 pts, max 75, with proportional grade", () => {
    const report = makeReport({
      csr: {
        status: "warn",
        serverChars: 0,
        renderedChars: 0,
        serverLines: 0,
        renderedLines: 0,
        overlapLines: 0,
        overlapRate: 0,
        heavyCsr: false,
        injectedSamples: [],
        skipped: true,
        error: "Web 版不支持渲染检测（需真实浏览器环境）",
      },
    });
    const score = buildScore(report);
    // robots 30 + llms 0 + jsonld 0 + probe 15; CSR not scoreable → max drops to 75
    expect(score.total).toBe(45);
    expect(score.max).toBe(75);
    expect(score.grade).toBe("C"); // 45/75 = 0.6
    expect(score.suggestions).toContain(
      "内容流失检测在 Web 版不可用：建议安装浏览器扩展获取完整评分",
    );
  });

  it("deducts 6 per scored robot blocked, and only for the 5 scored bots", () => {
    const bots = (verdicts: Record<string, string>) =>
      Object.entries(verdicts).map(([token, verdict]) => ({
        token,
        category: "search" as const,
        verdict: verdict as "allow" | "disallow",
      }));
    const report = makeReport({
      robots: {
        status: "warn",
        exists: true,
        evaluatedPath: "/",
        bots: bots({
          GPTBot: "disallow",
          "OAI-SearchBot": "disallow",
          ClaudeBot: "allow",
          PerplexityBot: "allow",
          Bytespider: "disallow",
          // Not scored: user/other bots.
          "ChatGPT-User": "disallow",
          CCBot: "disallow",
        }),
      },
    });
    const score = buildScore(report);
    expect(score.breakdown.robots).toBe(30 - 3 * 6); // 12
    expect(score.suggestions.some((s) => s.includes("GPTBot"))).toBe(true);
    expect(score.suggestions.some((s) => s.includes("ChatGPT-User"))).toBe(false);
  });

  it("caps the robots deduction at 0 with all 5 scored bots blocked", () => {
    const report = makeReport({
      robots: {
        status: "fail",
        exists: true,
        evaluatedPath: "/",
        bots: ["GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Bytespider"].map(
          (token) => ({ token, category: "search" as const, verdict: "disallow" as const }),
        ),
      },
    });
    expect(buildScore(report).breakdown.robots).toBe(0);
  });

  it("scores JSON-LD: valid block +10, key @type bonus +10, invalid-only 0", () => {
    const base = { status: "pass" as const, blockCount: 1, invalidCount: 0 };
    expect(
      buildScore(makeReport({ jsonLd: { ...base, typeCounts: [{ type: "Article", count: 1 }] } }))
        .breakdown.jsonLd,
    ).toBe(10);
    expect(
      buildScore(
        makeReport({ jsonLd: { ...base, typeCounts: [{ type: "Organization", count: 1 }] } }),
      ).breakdown.jsonLd,
    ).toBe(20);
    expect(
      buildScore(
        makeReport({
          jsonLd: { status: "fail", blockCount: 2, invalidCount: 2, typeCounts: [] },
        }),
      ).breakdown.jsonLd,
    ).toBe(0);
  });

  it("scores CSR tiers and the heavy-CSR extra deduction with a 0 floor", () => {
    const csr = (overlapRate: number, heavyCsr = false) => ({
      status: "pass" as const,
      serverChars: 100,
      renderedChars: 2000,
      serverLines: 3,
      renderedLines: 30,
      overlapLines: Math.round(overlapRate * 30),
      overlapRate,
      heavyCsr,
      injectedSamples: [],
    });
    expect(buildScore(makeReport({ csr: csr(0.9) })).breakdown.csr).toBe(25);
    expect(buildScore(makeReport({ csr: csr(0.8) })).breakdown.csr).toBe(12); // boundary
    expect(buildScore(makeReport({ csr: csr(0.5) })).breakdown.csr).toBe(12);
    expect(buildScore(makeReport({ csr: csr(0.4) })).breakdown.csr).toBe(0);
    expect(buildScore(makeReport({ csr: csr(0.4, true) })).breakdown.csr).toBe(0); // floor
  });

  it("deducts 5 per blocked/challenged probe and floors at 0", () => {
    expect(buildScore(makeReport({ probe: { ...makeReport().probe, results: probeResults("blocked") } })).breakdown.probe).toBe(0);
    const mixed = probeResults("accessible").map((r, i) =>
      i < 2 ? { ...r, verdict: "blocked" as const } : r,
    );
    expect(buildScore(makeReport({ probe: { ...makeReport().probe, results: mixed } })).breakdown.probe).toBe(5);
    // verdict "error" (request failed) does not deduct per spec.
    const errored = probeResults("error");
    expect(buildScore(makeReport({ probe: { ...makeReport().probe, results: errored } })).breakdown.probe).toBe(15);
  });
});

// ---------- markdown export ----------

describe("buildMarkdownReport", () => {
  it("produces a complete, readable report for the example.com case", () => {
    const report = makeReport();
    const md = buildMarkdownReport(report, buildScore(report));

    expect(md).toContain("# GEO 审计报告 — example.com");
    expect(md).toContain("综合评分：**70 / 100 · 等级 B**");
    expect(md).toContain("## 评分明细");
    expect(md).toContain("| robots.txt AI 爬虫友好度 | 30 | 30 |");
    expect(md).toContain("## 检测结果");
    expect(md).toContain("### robots.txt · AI 爬虫访问规则 —— 通过");
    expect(md).toContain("### AI 爬虫 UA 可达性探测 —— 通过");
    expect(md).toContain("### 内容流失 · CSR 盲区 —— 通过");
    expect(md).toContain("## 建议动作");
    expect(md).toContain("建议在站点根路径部署 llms.txt");
    expect(md).toContain("建议添加至少包含 Organization 或 WebSite 的 JSON-LD");
  });

  it("lists robot blocking suggestions with the bot token", () => {
    const report = makeReport({
      robots: {
        status: "fail",
        exists: true,
        evaluatedPath: "/",
        bots: [{ token: "GPTBot", category: "search", verdict: "disallow" }],
      },
    });
    const md = buildMarkdownReport(report, buildScore(report));
    expect(md).toContain("建议在 robots.txt 为 GPTBot 添加 Allow 规则");
  });
});
