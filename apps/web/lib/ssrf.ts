// SSRF guard for the user-supplied audit URL.
// The edge runtime cannot resolve DNS, so only hostname literals are checked —
// DNS-rebinding protection is out of scope for v1 (the probe fetches a public
// site's robots.txt/llms.txt/page, not arbitrary addresses).

const BLOCKED_HOSTNAMES = new Set(["localhost"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal"];

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map(Number);
  if (parts.some((p) => Number(p) > 255)) return false;
  return (
    a === 0 || // 0.0.0.0/8 ("this network")
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 198 && (b === 18 || b === 19)) // 198.18.0.0/15 benchmarking
  );
}

// Expand an IPv6 address (no brackets, no zone id, lowercase) into 8
// 16-bit groups. Returns null for unparseable input — unreachable in
// practice, since parseAuditUrl only passes hostname literals that new URL()
// already validated.
function expandIpv6Groups(h: string): number[] | null {
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...new Array<string>(missing).fill("0"), ...tail];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function isPrivateIPv6(host: string): boolean {
  // url.hostname keeps brackets for IPv6 ([::1]) and may carry a zone id
  // suffix (%25eth0); strip both before analyzing. WHATWG URL also
  // normalizes IPv4-mapped forms to plain hex (::ffff:7f00:1), so the
  // embedded-v4 check must work on hex groups, not dotted quads.
  const h = host.replace(/^\[/, "").replace(/\]$/, "").split("%")[0].toLowerCase();
  const groups = expandIpv6Groups(h);
  if (groups === null) return false;
  if (groups.every((g) => g === 0)) return true; // :: (unspecified)
  // Embedded IPv4 in the last 32 bits: ::1, ::x, ::ffff:x (mapped). These
  // cover loopback and v4-mapped private targets.
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0 || groups[5] === 0xffff)) {
    const [g6, g7] = [groups[6], groups[7]];
    return isPrivateIPv4(`${(g6 >> 8) & 255}.${g6 & 255}.${(g7 >> 8) & 255}.${g7 & 255}`);
  }
  const g0 = groups[0];
  if (g0 >= 0xfc00 && g0 <= 0xfdff) return true; // fc00::/7 ULA
  if (g0 >= 0xfe80 && g0 <= 0xfebf) return true; // fe80::/10 link-local
  return false;
}

export type ParsedAuditUrl = { url: URL } | { error: string };

export function parseAuditUrl(input: unknown): ParsedAuditUrl {
  if (typeof input !== "string" || input.trim() === "") {
    return { error: "请输入要检测的网址" };
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { error: "网址格式不正确，请输入完整的 http(s):// 地址" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "仅支持 http/https 网址" };
  }
  if (url.username || url.password) {
    return { error: "不支持携带用户名密码的网址" };
  }
  const host = url.hostname;
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { error: "不允许检测内网地址" };
  }
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { error: "不允许检测内网地址" };
  }
  if (host.includes(":") ? isPrivateIPv6(host) : isPrivateIPv4(host)) {
    return { error: "不允许检测内网地址" };
  }
  return { url };
}
