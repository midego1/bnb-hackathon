import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_CHECKIN_MANIFEST_HASH, DEMO_LEASE_HASH, documentUrl, photosForHash } from "@/lib/demoEvidence";

const demo = (f: string) => readFileSync(path.resolve(import.meta.dirname, "../public/demo", f));
const sha = (b: Buffer) => `0x${createHash("sha256").update(b).digest("hex")}`;

describe("demo evidence registry", () => {
  it("matches the bytes the seed script hashes", () => {
    expect(sha(demo("lease.pdf"))).toBe(DEMO_LEASE_HASH);
    expect(sha(demo("checkin-manifest.json"))).toBe(DEMO_CHECKIN_MANIFEST_HASH);
  });

  it("expands the pickup (check-in) manifest into its photos, each with the right hash", () => {
    const photos = photosForHash(DEMO_CHECKIN_MANIFEST_HASH);
    expect(photos).toHaveLength(3);
    for (const p of photos) expect(sha(demo(path.basename(p.src)))).toBe(p.hash);
  });

  it("falls back to evidence storage for anything else", () => {
    const h = `0x${"ab".repeat(32)}` as const;
    expect(photosForHash(h)).toEqual([{ hash: h, src: `/api/evidence/${h}` }]);
    expect(documentUrl(h)).toBe(`/api/evidence/${h}`);
    expect(documentUrl(DEMO_LEASE_HASH)).toBe("/demo/lease.pdf");
  });
});
