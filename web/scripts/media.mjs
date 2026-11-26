#!/usr/bin/env node
// The /media page's files (app/(app)/media): copies every downloadable file into public/media/<folder>/, zips them into
// public/media/keyscrow-media.zip and writes public/media/manifest.json (path + bytes of each file, read by the page).
// All three are build outputs (gitignored). Runs before every next build: package.json build, cf.mjs, testnet-web.sh,
// playwright.config.ts. Node only: the zip is written here (the production build server has no `zip` binary).
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(WEB, "..");
const OUT = join(WEB, "public", "media");
export const ZIP = "keyscrow-media.zip";
/** Workers Static Assets serves at most 25 MiB per file. */
export const MAX_FILE = 25 * 1024 * 1024;

const ls = (dir, re) => readdirSync(join(REPO, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`);

/**
 * [folder, repo-relative source, in the zip]. Duplicates stay out of the zip to keep it under 25 MiB: the .webm and the
 * .gif repeat the .mp4 videos, the iOS .jpg files are JPEG copies of iOS PNGs, and docs/screenshots holds older development shots. They stay separate downloads.
 */
const FILES = [
  ...["duo", "demo-guided", "eli5", "tour"].flatMap((v) => [
    ["videos", `docs/submission/${v}.mp4`, true],
    ["videos", `docs/submission/${v}.webm`, false],
  ]),
  ["videos", "docs/submission/duo.gif", false],
  // The pitch (4:46, 720p) alone is ~23 MB: a separate download, kept out of the zip so the zip stays under 25 MiB.
  ["videos", "docs/submission/pitch.mp4", false],
  ["videos", "docs/submission/pitch-poster.jpg", false],
  ["deck", "docs/submission/deck.pdf", true],
  ["deck", "docs/submission/deck-cover.jpg", true],
  ...ls("docs/submission/screenshots", /\.png$/).map((f) => ["screenshots/web", f, true]),
  ["screenshots/web", "docs/submission/inspection.png", true],
  // The older development shots stay separate downloads: with them the zip passes 25 MiB.
  ...ls("docs/screenshots", /\.png$/).map((f) => ["screenshots/web", f, false]),
  ...ls("docs/screenshots/judges", /\.png$/).map((f) => ["screenshots/web", f, false]),
  ...ls("ios/screenshots", /\.png$/).map((f) => ["screenshots/ios", f, true]),
  ...ls("docs/submission/screenshots/ios", /\.jpg$/).map((f) => ["screenshots/ios", f, false]),
  ["brand", "ios/KeyEscrow/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png", true],
  ["brand", "web/public/icons/icon-512.png", true],
  ["brand", "web/app/apple-icon.png", true],
  ["brand", "web/app/icon.png", true],
  ["brand", "web/app/favicon.ico", true],
  ["brand", "web/public/brand/mark-96.webp", true],
  ...["WRITEUP.md", "WRITEUP.zh-CN.md", "ARCHITECTURE.md", "BUSINESS.md", "DEMO.md"].map((f) => ["docs", `docs/${f}`, true]),
  ["docs", "docs/submission/HACKQUEST.md", true],
  ["docs", "docs/submission/README.md", true],
];

/** The file name inside its folder: README.md is the submission kit's, the judges' shots keep their folder as a prefix. */
const nameOf = (src) =>
  src === "docs/submission/README.md" ? "SUBMISSION.md" : src.startsWith("docs/screenshots/judges/") ? `judges-${basename(src)}` : basename(src);

// zlib.crc32 is Node >= 20.15 / 22.2; the table version covers older Node 20 (Next 16 needs >= 20.9).
const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n;
});
const crc32 = zlib.crc32 ?? ((buf) => ~buf.reduce((c, b) => CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8), -1) >>> 0);

/**
 * A plain zip (no zip64: every file and the whole zip stay far below 4 GiB, guarded at 25 MiB): each entry deflated
 * when that makes it smaller (the .md files), else stored (PNG, MP4 and PDF are compressed already).
 */
export function writeZip(file, entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data, mtime } of entries) {
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const [method, body] = deflated.length < data.length ? [8, deflated] : [0, data];
    const nameBuf = Buffer.from(name, "utf8");
    const dosTime = (mtime.getHours() << 11) | (mtime.getMinutes() << 5) | (mtime.getSeconds() >> 1);
    const dosDate = ((Math.max(mtime.getFullYear(), 1980) - 1980) << 9) | ((mtime.getMonth() + 1) << 5) | mtime.getDate();
    // version needed 2.0, flag bit 11: UTF-8 names, method, time, date, crc, compressed size, size, name length, no extra
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0);
    common.writeUInt16LE(0x0800, 2);
    common.writeUInt16LE(method, 4);
    common.writeUInt16LE(dosTime, 6);
    common.writeUInt16LE(dosDate, 8);
    common.writeUInt32LE(crc32(data), 10);
    common.writeUInt32LE(body.length, 14);
    common.writeUInt32LE(data.length, 18);
    common.writeUInt16LE(nameBuf.length, 22);
    const local = Buffer.concat([u32(0x04034b50), common, nameBuf]);
    // central header: signature, version made by, the common fields, then comment length, disk, internal and external
    // attributes (all 0) and the local header's offset
    const tail = Buffer.alloc(14);
    tail.writeUInt32LE(offset, 10);
    central.push(Buffer.concat([u32(0x02014b50), Buffer.from([20, 0]), common, tail, nameBuf]));
    parts.push(local, body);
    offset += local.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(file, Buffer.concat([...parts, cd, end]));
}
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

export function buildMedia() {
  rmSync(OUT, { recursive: true, force: true });
  const files = FILES.map(([folder, src, zip]) => {
    const path = `${folder}/${nameOf(src)}`;
    mkdirSync(join(OUT, folder), { recursive: true });
    cpSync(join(REPO, src), join(OUT, path));
    return { path, src, bytes: statSync(join(OUT, path)).size, zip };
  });
  const paths = files.map((f) => f.path);
  if (new Set(paths).size !== paths.length) throw new Error("media: two files share a name");
  writeZip(
    join(OUT, ZIP),
    files.filter((f) => f.zip).map((f) => ({ name: f.path, data: readFileSync(join(OUT, f.path)), mtime: statSync(join(REPO, f.src)).mtime })),
  );
  const zipBytes = statSync(join(OUT, ZIP)).size;
  if (zipBytes >= MAX_FILE) throw new Error(`media: ${ZIP} is ${zipBytes} bytes, over the 25 MiB Workers Static Assets limit`);
  const big = files.filter((f) => f.bytes >= MAX_FILE);
  if (big.length) throw new Error(`media: over 25 MiB: ${big.map((f) => f.path).join(", ")}`);
  const manifest = { zip: { path: ZIP, bytes: zipBytes }, files };
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = buildMedia();
  console.log(`media: ${m.files.length} files in public/media, ${ZIP} ${(m.zip.bytes / 1024 / 1024).toFixed(1)} MiB`);
}
