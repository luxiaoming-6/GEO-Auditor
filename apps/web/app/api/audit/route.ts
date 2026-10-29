// POST /api/audit — run the web edition audit for one URL.
// Edge runtime (required by @cloudflare/next-on-pages).

import { parseAuditUrl } from "../../../lib/ssrf";
import { runWebAudit } from "../../../lib/auditServer";

export const runtime = "edge";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(req: Request): Promise<Response> {
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = parseAuditUrl(body.url);
  if ("error" in parsed) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  try {
    const report = await runWebAudit(parsed.url);
    return Response.json({ ok: true, report });
  } catch (err) {
    return Response.json({ ok: false, error: `检测失败：${errorText(err)}` }, { status: 500 });
  }
}
