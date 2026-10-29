import { setupDevPlatform } from "@cloudflare/next-on-pages/next-dev";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // audit-core ships as TS source (no build step) — let Next compile it.
  transpilePackages: ["@geo-auditor/audit-core"],
};

// Edge bindings/dev platform for `next dev`; no-op during production build.
// The app declares no bindings, so the platform proxy is best-effort: swallow
// failures (e.g. unwritable wrangler state dir in sandboxed environments).
if (process.env.NODE_ENV === "development") {
  setupDevPlatform().catch(() => {});
}

export default nextConfig;
