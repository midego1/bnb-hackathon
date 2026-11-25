import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EvidenceRejectedError,
  evidenceStoreFromEnv,
  LocalEvidenceStore,
  sniffContentType,
  storeEvidence,
} from "@/lib/server/evidence";
import { normalizeBytes32 } from "@/lib/server/hash";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

let dir: string;
let routes: { POST: typeof import("@/app/api/evidence/route").POST; GET: typeof import("@/app/api/evidence/[hash]/route").GET };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "keyescrow-evidence-"));
  process.env.EVIDENCE_DIR = dir;
  process.env.EVIDENCE_MAX_BYTES = "1024";
  routes = {
    POST: (await import("@/app/api/evidence/route")).POST,
    GET: (await import("@/app/api/evidence/[hash]/route")).GET,
  };
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function upload(files: { name: string; bytes: Uint8Array; type?: string }[]) {
  const form = new FormData();
  for (const f of files) form.append("file", new File([Buffer.from(f.bytes)], f.name, { type: f.type ?? "application/octet-stream" }));
  return routes.POST(new NextRequest("http://localhost/api/evidence", { method: "POST", body: form }));
}

function fetchBack(hash: string) {
  return routes.GET(new Request(`http://localhost/api/evidence/${hash}`), { params: Promise.resolve({ hash }) });
}

describe("evidence helpers", () => {
  it("sniffs allowed types from magic bytes", () => {
    expect(sniffContentType(PDF)).toBe("application/pdf");
    expect(sniffContentType(PNG)).toBe("image/png");
    expect(sniffContentType(JPEG)).toBe("image/jpeg");
    expect(sniffContentType(WEBP)).toBe("image/webp");
    expect(sniffContentType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });

  it("normalizes bytes32 hashes", () => {
    const hex = "AB".repeat(32);
    expect(normalizeBytes32(hex)).toBe(`0x${"ab".repeat(32)}`);
    expect(normalizeBytes32("0x1234")).toBeNull();
    expect(normalizeBytes32("../../etc/passwd")).toBeNull();
  });

  it("uses local storage unless every GREENFIELD_* var is set", () => {
    expect(evidenceStoreFromEnv({}).name).toBe("local");
    expect(evidenceStoreFromEnv({ GREENFIELD_RPC_URL: "x", GREENFIELD_CHAIN_ID: "5600" }).name).toBe("local");
    expect(
      evidenceStoreFromEnv({ GREENFIELD_RPC_URL: "x", GREENFIELD_CHAIN_ID: "5600", GREENFIELD_BUCKET: "b", GREENFIELD_PRIVATE_KEY: "0x1" }).name,
    ).toBe("greenfield");
  });

  it("hashes with sha256, stores idempotently and reads back", async () => {
    const store = new LocalEvidenceStore(path.join(dir, "unit"));
    const rec = await storeEvidence(store, PDF, "lease.pdf", 1024);
    expect(rec.hash).toBe(`0x${createHash("sha256").update(PDF).digest("hex")}`);
    expect(rec).toMatchObject({ size: PDF.byteLength, contentType: "application/pdf", storage: "local", url: `/api/evidence/${rec.hash}` });
    await storeEvidence(store, PDF, "again.pdf", 1024);
    expect(await readdir(path.join(dir, "unit"))).toHaveLength(1);
    const got = await store.get(rec.hash);
    expect(Buffer.from(got!.bytes).equals(Buffer.from(PDF))).toBe(true);
    expect(await store.get(`0x${"0".repeat(64)}`)).toBeNull();
  });

  it("rejects empty, oversized and disallowed files", async () => {
    const store = new LocalEvidenceStore(path.join(dir, "reject"));
    await expect(storeEvidence(store, new Uint8Array(), "e", 1024)).rejects.toMatchObject({ status: 400 });
    await expect(storeEvidence(store, new Uint8Array(2048).fill(0xff), "big", 1024)).rejects.toMatchObject({ status: 413 });
    await expect(storeEvidence(store, new TextEncoder().encode("hello"), "a.txt", 1024)).rejects.toBeInstanceOf(EvidenceRejectedError);
  });
});

describe("POST/GET /api/evidence", () => {
  it("uploads several files and serves them back by hash", async () => {
    const res = await upload([
      { name: "lease.pdf", bytes: PDF, type: "application/pdf" },
      { name: "kitchen.png", bytes: PNG, type: "image/png" },
    ]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ storage: "local", mock: true, maxBytes: 1024 });
    expect(body.items).toHaveLength(2);
    expect(body.items[0].hash).toMatch(/^0x[0-9a-f]{64}$/);

    const back = await fetchBack(body.items[1].hash);
    expect(back.status).toBe(200);
    expect(back.headers.get("content-type")).toBe("image/png");
    expect(back.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await back.arrayBuffer()).equals(Buffer.from(PNG))).toBe(true);
  });

  it("trusts magic bytes over the declared type", async () => {
    const res = await upload([{ name: "evil.png", bytes: new TextEncoder().encode("<html>"), type: "image/png" }]);
    expect(res.status).toBe(415);
  });

  it("enforces the size limit", async () => {
    const big = new Uint8Array(2048);
    big.set(PNG);
    expect((await upload([{ name: "big.png", bytes: big }])).status).toBe(413);
  });

  it("rejects requests without files or with the wrong content type", async () => {
    const empty = new FormData();
    empty.append("note", "hi");
    expect((await routes.POST(new NextRequest("http://localhost/api/evidence", { method: "POST", body: empty }))).status).toBe(400);
    const json = new NextRequest("http://localhost/api/evidence", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect((await routes.POST(json)).status).toBe(415);
  });

  it("GET validates the hash and 404s unknown content", async () => {
    expect((await fetchBack("not-a-hash")).status).toBe(400);
    expect((await fetchBack(`0x${"1".repeat(64)}`)).status).toBe(404);
  });
});
