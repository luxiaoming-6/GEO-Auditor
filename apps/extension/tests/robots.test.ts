import { describe, expect, it } from "vitest";
import { buildRobotsCheck, evaluateToken, parseRobots } from "@geo-auditor/audit-core";

describe("parseRobots + evaluateToken", () => {
  it("treats empty Disallow as allow-all", () => {
    const groups = parseRobots("User-agent: *\nDisallow:");
    expect(evaluateToken(groups, "GPTBot", "/")).toMatchObject({
      verdict: "allow",
      mentioned: true,
    });
  });

  it("reports disallow for a full block", () => {
    const groups = parseRobots("User-agent: *\nDisallow: /");
    const result = evaluateToken(groups, "PerplexityBot", "/some/page");
    expect(result.verdict).toBe("disallow");
    expect(result.matchedRule).toMatchObject({ path: "/", line: 2 });
  });

  it("prefers the exact token group over *", () => {
    const groups = parseRobots(
      "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /",
    );
    expect(evaluateToken(groups, "gptbot", "/x").verdict).toBe("allow");
    expect(evaluateToken(groups, "ClaudeBot", "/x").verdict).toBe("disallow");
  });

  it("longest match wins (allow carves out of disallow)", () => {
    const groups = parseRobots(
      "User-agent: *\nDisallow: /private/\nAllow: /private/public",
    );
    expect(evaluateToken(groups, "CCBot", "/private/public/a").verdict).toBe(
      "allow",
    );
    expect(evaluateToken(groups, "CCBot", "/private/secret").verdict).toBe(
      "disallow",
    );
  });

  it("falls back to not-mentioned when no group matches", () => {
    const groups = parseRobots("User-agent: GPTBot\nDisallow: /");
    expect(evaluateToken(groups, "Bytespider", "/")).toMatchObject({
      verdict: "not-mentioned",
      mentioned: false,
    });
  });

  it("ties between Allow and Disallow go to Allow", () => {
    const groups = parseRobots(
      "User-agent: *\nDisallow: /penguin\nAllow: /penguin",
    );
    expect(evaluateToken(groups, "CCBot", "/penguin").verdict).toBe("allow");
  });

  it("counts wildcard characters as zero specificity (Google example)", () => {
    const groups = parseRobots(
      "User-agent: *\nDisallow: /penguin*\nAllow: /penguin",
    );
    expect(evaluateToken(groups, "CCBot", "/penguin/feed").verdict).toBe(
      "allow",
    );
  });

  it("supports wildcards and the $ anchor", () => {
    const groups = parseRobots(
      "User-agent: *\nDisallow: /foo*/bar\nDisallow: /baz$",
    );
    expect(evaluateToken(groups, "CCBot", "/foox/bar/baz").verdict).toBe(
      "disallow",
    );
    expect(evaluateToken(groups, "CCBot", "/bazz").verdict).toBe("allow");
    expect(evaluateToken(groups, "CCBot", "/baz").verdict).toBe("disallow");
  });

  it("merges rules from repeated groups of the same token", () => {
    const groups = parseRobots(
      "User-agent: GPTBot\nDisallow: /a\n\nUser-agent: GPTBot\nDisallow: /b",
    );
    expect(evaluateToken(groups, "GPTBot", "/b").verdict).toBe("disallow");
  });

  it("tolerates comments, BOM, junk lines and unknown directives", () => {
    const text =
      "\uFEFF# comment\nSitemap: https://x/s.xml\nUser-agent: *\njunk line\nDisallow: /a # trailing\n";
    const groups = parseRobots(text);
    expect(evaluateToken(groups, "GPTBot", "/a/b").verdict).toBe("disallow");
    expect(evaluateToken(groups, "GPTBot", "/b").verdict).toBe("allow");
  });
});

describe("buildRobotsCheck", () => {
  it("marks search-bot blocking as fail", () => {
    const check = buildRobotsCheck(
      { httpStatus: 200, contentType: "text/plain", body: "User-agent: *\nDisallow: /" },
      "/",
    );
    expect(check.status).toBe("fail");
    expect(check.exists).toBe(true);
  });

  it("marks training-bot blocking as warn", () => {
    const check = buildRobotsCheck(
      {
        httpStatus: 200,
        contentType: "text/plain",
        body: "User-agent: GPTBot\nDisallow: /",
      },
      "/",
    );
    expect(check.status).toBe("warn");
  });

  it("passes when nothing is blocked", () => {
    const check = buildRobotsCheck(
      { httpStatus: 200, contentType: "text/plain", body: "User-agent: *\nDisallow:" },
      "/",
    );
    expect(check.status).toBe("pass");
  });

  it("passes when robots.txt is missing (default allow)", () => {
    const check = buildRobotsCheck({ httpStatus: 404, contentType: "text/html" }, "/");
    expect(check.status).toBe("pass");
    expect(check.exists).toBe(false);
  });

  it("warns on soft-404 (200 with HTML body)", () => {
    const check = buildRobotsCheck(
      { httpStatus: 200, contentType: "text/html", body: "<html></html>" },
      "/",
    );
    expect(check.status).toBe("warn");
    expect(check.exists).toBe(false);
  });

  it("fails on network errors and non-404 error statuses", () => {
    expect(
      buildRobotsCheck({ fetchError: "请求超时" }, "/").status,
    ).toBe("fail");
    expect(
      buildRobotsCheck({ httpStatus: 403, contentType: "text/plain" }, "/").status,
    ).toBe("fail");
  });

  it("attaches the Google-Extended info row with Googlebot verdict", () => {
    const check = buildRobotsCheck(
      {
        httpStatus: 200,
        contentType: "text/plain",
        body: "User-agent: Googlebot\nDisallow: /",
      },
      "/",
    );
    const row = check.bots.find((bot) => bot.token === "Google-Extended");
    expect(row?.verdict).toBe("info");
    expect(row?.note).toContain("禁止");
  });
});
