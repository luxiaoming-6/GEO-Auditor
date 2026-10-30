// Dev-only custom server: wraps `next dev` and adds POST /api/save-report,
// which archives each successful audit report into content/reports/{domain}.json
// so reports ship with the repo (git-based publishing — no database).
// Never used in production: Cloudflare Pages builds the prerendered output
// directly and has no filesystem, so this endpoint simply does not exist there.

import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";

const PORT = 3100; // fixed dev port (project convention)

const app = next({ dev: true, port: PORT });
const handle = app.getRequestHandler();
await app.prepare();

const REPORTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "content",
  "reports",
);
// Hostname-derived filename guard (also blocks path traversal).
const DOMAIN_RE = /^[a-z0-9.-]+$/;

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/save-report") {
    try {
      const body = JSON.parse(await readBody(req));
      // The client posts the raw AuditReport (url + auditedAt at top level);
      // it is archived as-is, matching what lib/reportsContent.ts reads back.
      const { url, auditedAt } = body ?? {};
      if (typeof url !== "string" || typeof auditedAt !== "number") {
        return json(res, 400, { ok: false, error: "invalid report payload" });
      }
      const hostname = new URL(url).hostname.toLowerCase();
      const domain = hostname.replace(/[^a-z0-9.-]/g, "");
      if (!DOMAIN_RE.test(domain)) {
        return json(res, 400, { ok: false, error: "invalid domain" });
      }
      await mkdir(REPORTS_DIR, { recursive: true });
      await writeFile(
        path.join(REPORTS_DIR, `${domain}.json`),
        JSON.stringify(body, null, 2),
        "utf8",
      );
      console.log(`> report archived: content/reports/${domain}.json`);
      return json(res, 200, { ok: true, domain });
    } catch (err) {
      return json(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return handle(req, res);
}).listen(PORT, () => {
  console.log(`> BotGaze web (dev) ready on http://localhost:${PORT}`);
});
