import { getEvidenceStore } from "@/lib/server/evidence";
import { normalizeBytes32 } from "@/lib/server/hash";
import { jsonError } from "@/lib/server/http";

/** GET /api/evidence/<sha256> — serve stored evidence back by its content hash. */
export async function GET(_request: Request, ctx: RouteContext<"/api/evidence/[hash]">) {
  const { hash: raw } = await ctx.params;
  const hash = normalizeBytes32(raw);
  if (!hash) return jsonError(400, "hash must be a 32-byte hex sha256");

  const ev = await getEvidenceStore().get(hash);
  if (!ev) return jsonError(404, "evidence not found");

  return new Response(Buffer.from(ev.bytes), {
    headers: {
      "Content-Type": ev.contentType,
      "Content-Length": String(ev.bytes.byteLength),
      // Content-addressed: bytes for a hash never change.
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: `"${hash}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
