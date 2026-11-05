import { NextResponse, type NextRequest } from "next/server";
import { SITE_URL } from "./lib/siteUrl";

// Canonical-host redirect: every hostname other than the configured site
// origin (legacy *.pages.dev deployment domains, preview URLs, the bare
// apex or www if they ever route here) 301s to the canonical host with
// path + query preserved. Search engines and AI crawlers then consolidate
// all signals onto one host instead of indexing duplicates.
// The canonical host is derived from NEXT_PUBLIC_SITE_URL (inlined at build
// time) — never hardcoded. Localhost is exempt so `next dev` keeps working.
const CANONICAL_HOST = new URL(SITE_URL).hostname;

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  // Strip the port. IPv6 literals arrive bracketed ("[::1]:3100") — extract
  // the address inside the brackets instead of cutting at the first colon.
  const hostname = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.split(":")[0];
  // Exempt local dev hosts (browsers may reach localhost via IPv6 ::1).
  const isLocal =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (hostname === CANONICAL_HOST || isLocal) {
    return NextResponse.next();
  }
  const url = new URL(req.url);
  return NextResponse.redirect(
    `https://${CANONICAL_HOST}${url.pathname}${url.search}`,
    301,
  );
}

export const config = {
  // Everything except Next.js internals. robots.txt / sitemap.xml are
  // deliberately included: crawlers must see the 301 during a domain move.
  matcher: ["/((?!_next/).*)"],
};
