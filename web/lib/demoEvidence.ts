import type { Hex } from "viem";
import manifest from "@/public/demo/checkin-manifest.json";

/**
 * Placeholder evidence the seed script (contracts/script/Seed.s.sol) anchors on the demo rentals. The files are
 * static assets under web/public/demo, not in evidence storage, so /api/evidence would 404 for their hashes.
 * The hashes are SHA-256 of the file bytes; tests/demo-evidence.test.ts keeps them in sync with the files.
 */
export const DEMO_LEASE_HASH = "0x8e43b2a1bceb9f83f91ca4b0aee9dbfe91631fa35a5c03bd1272dc60f0153411" as Hex;
export const DEMO_CHECKIN_MANIFEST_HASH = "0x5648f06d1aea37d500f2f808579978b486095e6c2044a575ba9806ef3817a6a6" as Hex;

export type EvidenceView = { hash: Hex; src: string; label?: string };

const demoPhotos: EvidenceView[] = manifest.photos.map((p) => ({
  hash: p.sha256.toLowerCase() as Hex,
  src: `/demo/${p.file}`,
  label: p.file.replace(/^checkin-|\.svg$/g, "").replace(/-/g, " "),
}));

/** Where to fetch a document by its on-chain hash: the bundled demo file, or evidence storage. */
export function documentUrl(hash: Hex): string {
  return hash.toLowerCase() === DEMO_LEASE_HASH ? "/demo/lease.pdf" : `/api/evidence/${hash}`;
}

/**
 * Photos to show for one anchored hash. A demo pickup manifest expands to its photos; a demo photo maps to its
 * static file; anything else is served by /api/evidence.
 */
export function photosForHash(hash: Hex): EvidenceView[] {
  const h = hash.toLowerCase() as Hex;
  if (h === DEMO_CHECKIN_MANIFEST_HASH) return demoPhotos;
  const demo = demoPhotos.find((p) => p.hash === h);
  return [demo ?? { hash: h, src: `/api/evidence/${h}` }];
}
