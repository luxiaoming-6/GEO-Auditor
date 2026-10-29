import { describe, expect, it } from "vitest";
import { buildCsrCheck, buildCsrEstimate, normalizeLines } from "@geo-auditor/audit-core";

describe("normalizeLines", () => {
  it("splits, trims and drops empty lines", () => {
    expect(normalizeLines("  a \r\n\r\nb\n\n   c  ")).toEqual(["a", "b", "c"]);
  });
});

describe("buildCsrCheck", () => {
  it("rates a fully static page at ~1 overlap (example.com case)", () => {
    const text = "Example Domain\nThis domain is for use in illustrative examples";
    const check = buildCsrCheck(text, text);
    expect(check.overlapRate).toBe(1);
    expect(check.status).toBe("pass");
    expect(check.heavyCsr).toBe(false);
    expect(check.injectedSamples).toHaveLength(0);
  });

  it("ignores whitespace/empty-line differences", () => {
    const server = "<div>\n\n   Hello world\n\n\tSecond line\n</div>";
    const rendered = "Hello world\nSecond line";
    const check = buildCsrCheck(server, rendered);
    expect(check.overlapRate).toBe(1);
    expect(check.status).toBe("pass");
  });

  it("warns at exactly 0.5 overlap (boundary is inclusive)", () => {
    const server = ["l1", "l2", "l3", "l4", "l5"].join("\n");
    const rendered = [...Array.from({ length: 5 }, (_, i) => `l${i + 1}`), ...Array.from({ length: 5 }, (_, i) => `js${i + 1}`)].join("\n");
    const check = buildCsrCheck(server, rendered);
    expect(check.overlapRate).toBe(0.5);
    expect(check.status).toBe("warn");
    expect(check.injectedSamples).toEqual(["js1", "js2", "js3", "js4", "js5"]);
  });

  it("fails below 0.5 and lists rendered-only samples", () => {
    const server = "footer text";
    const rendered = Array.from({ length: 20 }, (_, i) => `injected ${i + 1}`).join("\n");
    const check = buildCsrCheck(server, rendered);
    expect(check.overlapRate).toBe(0);
    expect(check.status).toBe("fail");
    expect(check.injectedSamples).toHaveLength(10);
    expect(check.injectedSamples[0]).toBe("injected 1");
  });

  it("flags heavy CSR dependency (tiny server shell, rich rendered page)", () => {
    const server = "<div id=\"root\"></div>"; // 21 chars
    const rendered = Array.from({ length: 60 }, (_, i) => `injected line ${i + 1} with some content`).join("\n"); // > 1000 chars
    const check = buildCsrCheck(server, rendered);
    expect(check.heavyCsr).toBe(true);
    expect(check.status).toBe("fail");
  });

  it("does not flag heavy CSR when the server shell is large", () => {
    const server = "real content\n".repeat(100); // > 200 chars
    const rendered = `${server}${"js line\n".repeat(200)}`;
    const check = buildCsrCheck(server, rendered);
    expect(check.heavyCsr).toBe(false);
  });

  it("treats an empty rendered page as full overlap (nothing to lose)", () => {
    const check = buildCsrCheck("some content", "");
    expect(check.overlapRate).toBe(1);
    expect(check.status).toBe("pass");
  });
});

describe("buildCsrEstimate (web edition, no renderer)", () => {
  it("rates rich server text as low risk / pass", () => {
    const paragraph = "This is a content paragraph with plenty of visible words. ";
    const html = `<html><head><style>.x{color:red}</style><script>var a=1;</script></head><body><h1>Title</h1>${paragraph.repeat(30)}</body></html>`;
    const check = buildCsrEstimate(html);
    expect(check.estimate?.level).toBe("low");
    expect(check.status).toBe("pass");
    expect(check.heavyCsr).toBe(false);
    // style/script content must not leak into the visible text.
    expect(check.serverChars).toBeGreaterThan(1000);
    expect(check.serverChars).toBeLessThan(paragraph.length * 30 + 100);
    expect(check.estimate?.signals).toHaveLength(0);
  });

  it("rates a JS shell (empty mount point + noscript hint) as high risk / fail", () => {
    const html = [
      "<html><head><title>App</title></head><body>",
      '<noscript>Please enable JavaScript to use this app.</noscript>',
      '<div id="root"></div>',
      `<script>${"x".repeat(6000)}</script>`,
      "</body></html>",
    ].join("");
    const check = buildCsrEstimate(html);
    expect(check.estimate?.level).toBe("high");
    expect(check.status).toBe("fail");
    expect(check.heavyCsr).toBe(true);
    expect(check.estimate?.signals).toContain("页面提示需启用 JavaScript");
    expect(check.estimate?.signals).toContain("存在 SPA 挂载点空容器");
    // The 6000 chars of inline script must not count as visible text.
    expect(check.serverChars).toBeLessThan(200);
  });

  it("keeps medium (not high) for thin text without CSR signals", () => {
    const html = "<html><body><p>short page</p></body></html>";
    const check = buildCsrEstimate(html);
    expect(check.estimate?.level).toBe("medium");
    expect(check.status).toBe("warn");
    expect(check.heavyCsr).toBe(false);
  });

  it("scores through buildScore: low = 25 pts with max 100", async () => {
    const { buildScore } = await import("@geo-auditor/audit-core");
    const paragraph = "Real content line. ".repeat(80); // > 1000 chars
    const check = buildCsrEstimate(`<html><body>${paragraph}</body></html>`);
    const score = buildScore({
      url: "https://x/",
      origin: "https://x",
      auditedAt: 0,
      robots: { status: "pass", exists: false, evaluatedPath: "/", bots: [] },
      llmsTxt: { status: "warn", exists: false },
      jsonLd: { status: "fail", blockCount: 0, invalidCount: 0, typeCounts: [] },
      probe: {
        status: "pass",
        targetUrl: "https://x/",
        baseline: { httpStatus: 200, finalUrl: "https://x/", redirected: false, bodySnippet: "", verdict: "accessible" },
        results: [],
      },
      csr: check,
    });
    expect(score.max).toBe(100);
    expect(score.breakdown.csr).toBe(25);
  });
});
