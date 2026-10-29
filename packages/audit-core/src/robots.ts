// robots.txt parser and AI-bot evaluation (pure logic, no chrome.* APIs).
// Semantics follow RFC 9309 as implemented by Google:
//   - Consecutive User-agent lines share the rules that follow; a UA line
//     seen after rules have started begins a new group.
//   - An exact product-token group wins over the "*" fallback group; rules
//     from repeated groups of the same token are merged.
//   - Among the rules matching the path, the most specific (longest literal
//     pattern, "*" and "$" counted as zero) wins; ties go to Allow.
//   - "Disallow:" with an empty value matches nothing (i.e. allows all).

import {
  AI_BOTS,
  GOOGLE_EXTENDED_NOTE,
  GOOGLE_EXTENDED_TOKEN,
} from "./bots";
import type { BotResult, CheckStatus, RobotsCheck } from "./types";

export type RobotsRuleType = "allow" | "disallow";

export interface RobotsRule {
  type: RobotsRuleType;
  path: string;
  line: number; // 1-based line number in robots.txt
}

export type RobotsGroups = Record<string, RobotsRule[]>; // keyed by lowercase token

export interface RobotsFetchOutcome {
  fetchError?: string; // network-level failure
  httpStatus?: number; // undefined when fetchError is set
  contentType?: string;
  body?: string;
}

export type TokenVerdict = "allow" | "disallow" | "not-mentioned";

export interface TokenEvaluation {
  verdict: TokenVerdict;
  mentioned: boolean; // the token (or "*") has a group in robots.txt
  matchedRule?: RobotsRule;
}

interface Directive {
  name: string;
  value: string;
  line: number;
}

function cleanLine(raw: string): string {
  // Strip BOM and comments ("#" at line start or preceded by whitespace).
  return raw.replace(/^\uFEFF/, "").replace(/(^|\s)#.*$/, "").trim();
}

function lexRobots(text: string): Directive[] {
  const directives: Directive[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = cleanLine(raw);
    if (!line) return;
    const idx = line.indexOf(":");
    if (idx <= 0) return; // tolerate junk lines
    directives.push({
      name: line.slice(0, idx).trim().toLowerCase(),
      value: line.slice(idx + 1).trim(),
      line: i + 1,
    });
  });
  return directives;
}

export function parseRobots(text: string): RobotsGroups {
  const groups: RobotsGroups = {};
  let currentAgents: string[] = [];
  let sawRule = false;

  for (const { name, value, line } of lexRobots(text)) {
    if (name === "user-agent") {
      if (sawRule) {
        currentAgents = []; // rules started: the next group begins
        sawRule = false;
      }
      if (value) currentAgents.push(value.toLowerCase());
    } else if (name === "allow" || name === "disallow") {
      // Empty Allow/Disallow is a no-op rule: it never matches a path, but
      // pushing it keeps the group "present" (mentioned) per RFC 9309.
      for (const agent of currentAgents) {
        (groups[agent] ??= []).push({
          type: name === "allow" ? "allow" : "disallow",
          path: value,
          line,
        });
      }
      sawRule = true;
    }
    // Other directives (Sitemap, Crawl-delay, ...) are ignored.
  }
  return groups;
}

function patternToRegExp(pattern: string, endAnchor: boolean): RegExp {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  // Without "$" the pattern is a prefix match (RFC 9309).
  return new RegExp(`^${source}${endAnchor ? "$" : ""}`);
}

function specificity(pattern: string): number {
  // Literal length only: wildcards contribute nothing to specificity.
  return pattern.replace(/[*$]/g, "").length;
}

function bestMatch(rules: RobotsRule[], path: string): RobotsRule | undefined {
  let best: { rule: RobotsRule; score: number } | undefined;
  for (const rule of rules) {
    if (rule.path === "") continue; // empty directive: no-op
    const endAnchor = rule.path.endsWith("$");
    const re = patternToRegExp(
      endAnchor ? rule.path.slice(0, -1) : rule.path,
      endAnchor,
    );
    if (!re.test(path)) continue;
    const score = specificity(rule.path);
    if (
      !best ||
      score > best.score ||
      (score === best.score &&
        rule.type === "allow" &&
        best.rule.type === "disallow")
    ) {
      best = { rule, score };
    }
  }
  return best?.rule;
}

export function evaluateToken(
  groups: RobotsGroups,
  token: string,
  path: string,
): TokenEvaluation {
  const exact = groups[token.toLowerCase()];
  const fallback = groups["*"];
  const rules = exact ?? fallback;
  if (!rules) return { verdict: "not-mentioned", mentioned: false };

  const matched = bestMatch(rules, path);
  return {
    verdict: matched?.type === "disallow" ? "disallow" : "allow",
    mentioned: true,
    matchedRule: matched,
  };
}

function googlebotNote(evaluation: TokenEvaluation): string {
  if (!evaluation.mentioned) return "robots.txt 未提及 Googlebot，默认允许";
  return evaluation.verdict === "disallow"
    ? "当前 robots.txt 对 Googlebot 的判定：禁止"
    : "当前 robots.txt 对 Googlebot 的判定：允许";
}

export function buildRobotsCheck(
  outcome: RobotsFetchOutcome,
  evaluatedPath: string,
): RobotsCheck {
  if (outcome.fetchError) {
    return {
      status: "fail",
      exists: false,
      evaluatedPath,
      bots: [],
      fetchError: outcome.fetchError,
    };
  }

  const httpStatus = outcome.httpStatus as number;
  const contentType = (outcome.contentType ?? "").toLowerCase();

  if (httpStatus === 404 || httpStatus === 410) {
    // No robots.txt: everything is crawled by default, which is GEO-friendly.
    return { status: "pass", exists: false, evaluatedPath, bots: [], httpStatus };
  }
  if (httpStatus !== 200) {
    return {
      status: "fail",
      exists: false,
      evaluatedPath,
      bots: [],
      httpStatus,
    };
  }
  if (contentType.includes("text/html")) {
    // Soft-404: some servers answer 200 with an HTML error page.
    return { status: "warn", exists: false, evaluatedPath, bots: [], httpStatus };
  }
  if (!outcome.body) {
    return { status: "fail", exists: false, evaluatedPath, bots: [], httpStatus };
  }

  const groups = parseRobots(outcome.body);
  const googlebot = evaluateToken(groups, "googlebot", evaluatedPath);

  const bots: BotResult[] = AI_BOTS.map((bot) => {
    const evaluation = evaluateToken(groups, bot.token, evaluatedPath);
    return {
      token: bot.token,
      category: bot.category,
      verdict: evaluation.verdict,
      rule: evaluation.matchedRule,
    };
  });

  // Google-Extended is informational only: no verdict, fixed copy plus the
  // current Googlebot evaluation so users know what to check next.
  bots.push({
    token: GOOGLE_EXTENDED_TOKEN,
    category: "other",
    verdict: "info",
    note: `${GOOGLE_EXTENDED_NOTE}（${googlebotNote(googlebot)}）`,
  });

  // Module status: blocking search bots hurts AI-search visibility directly;
  // blocking training/user bots is a deliberate trade-off, hence a warning.
  const blockedSearch = bots.some(
    (b) => b.category === "search" && b.verdict === "disallow",
  );
  const blockedRest = bots.some(
    (b) =>
      (b.category === "training" || b.category === "user") &&
      b.verdict === "disallow",
  );
  const status: CheckStatus = blockedSearch
    ? "fail"
    : blockedRest
      ? "warn"
      : "pass";

  return {
    status,
    exists: true,
    evaluatedPath,
    bots,
    httpStatus,
    sizeBytes: new TextEncoder().encode(outcome.body).length,
  };
}
