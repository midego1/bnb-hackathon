import { NextResponse, type NextRequest } from "next/server";
import {
  EvidenceRejectedError,
  getEvidenceStore,
  MAX_FILES_PER_REQUEST,
  maxEvidenceBytes,
  storeEvidence,
  type EvidenceRecord,
} from "@/lib/server/evidence";
import { jsonError } from "@/lib/server/http";

/**
 * POST /api/evidence — multipart/form-data with one or more `file` fields (rental agreement PDF, photos).
 * Each file is type-sniffed, size-limited and sha256-hashed; the hash is the bytes32 to store
 * on-chain and the key to fetch it back from GET /api/evidence/<hash>.
 */
export async function POST(request: NextRequest) {
  const maxBytes = maxEvidenceBytes();
  const declared = Number(request.headers.get("content-length"));
  // Multipart overhead is small; reject obviously oversized bodies before buffering them.
  if (Number.isFinite(declared) && declared > maxBytes * MAX_FILES_PER_REQUEST + 64 * 1024) {
    return jsonError(413, "request body too large");
  }
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return jsonError(415, "send multipart/form-data with one or more `file` fields");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "could not parse multipart body");
  }
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
  if (files.length === 0) return jsonError(400, "no `file` field in the form");
  if (files.length > MAX_FILES_PER_REQUEST) return jsonError(413, `at most ${MAX_FILES_PER_REQUEST} files per request`);

  const store = getEvidenceStore();
  const items: EvidenceRecord[] = [];
  try {
    for (const f of files) {
      if (f.size > maxBytes) throw new EvidenceRejectedError(`${f.name} is ${f.size} bytes; limit is ${maxBytes}`, 413);
      items.push(await storeEvidence(store, new Uint8Array(await f.arrayBuffer()), f.name || undefined, maxBytes));
    }
  } catch (err) {
    if (err instanceof EvidenceRejectedError) return jsonError(err.status, err.message);
    console.error("evidence store failed", (err as Error).message);
    return jsonError(502, `evidence storage (${store.name}) failed`);
  }
  return NextResponse.json(
    { storage: store.name, mock: store.name === "local", maxBytes, items },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
