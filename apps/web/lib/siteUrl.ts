// Single source of truth for absolute URLs (OG meta tags, share button,
// sitemap, canonical link). Configured via NEXT_PUBLIC_SITE_URL — a
// Cloudflare Pages environment variable in production, apps/web/.env.local
// for local builds. Inlined at build time (NEXT_PUBLIC_ prefix). To change
// the domain, update that one variable and redeploy. Never hardcode a full
// URL anywhere else in the app.

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://geo-auditor.pages.dev"
).replace(/\/+$/, "");

// Shareable report link: {SITE_URL}/report/{domain}. The report page runs a
// fresh audit for the domain on open — no stored snapshots involved.
export function reportUrl(domain: string): string {
  return `${SITE_URL}/report/${encodeURIComponent(domain)}`;
}
