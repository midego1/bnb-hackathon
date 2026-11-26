#!/usr/bin/env node
// The /media page's files (app/(app)/media): copies every downloadable file into public/media/<folder>/, zips them into
// public/media/keyscrow-media.zip and writes public/media/manifest.json (path + bytes of each file, read by the page).
// All three are build outputs (gitignored). Runs before every next build: package.json build, cf.mjs, testnet-web.sh,
// playwright.config.ts. Needs the system `zip` (macOS and Ubuntu ship it).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(WEB, "..");
const OUT = join(WEB, "public", "media");
export const ZIP = "keyscrow-media.zip";
/** Workers Static Assets serves at most 25 MiB per file. */
export const MAX_FILE = 25 * 1024 * 1024;

const ls = (dir, re) => readdirSync(join(REPO, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`);

/**
 * [folder, repo-relative source, in the zip]. Duplicates stay out of the zip to keep it under 25 MiB: the .webm and the
 * .gif repeat the .mp4 videos, the iOS .jpg files are JPEG copies of iOS PNGs. They stay separate downloads.
 */
const FILES = [
  ...["duo", "demo-guided", "eli5", "tour"].flatMap((v) => [
    ["videos", `docs/submission/${v}.mp4`, true],
    ["videos", `docs/submission/${v}.webm`, false],
  ]),
  ["videos", "docs/submission/duo.gif", false],
  ["deck", "docs/submission/deck.pdf", true],
  ["deck", "docs/submission/deck-cover.jpg", true],
  ...ls("docs/submission/screenshots", /\.png$/).map((f) => ["screenshots/web", f, true]),
  ["screenshots/web", "docs/submission/inspection.png", true],
  ...ls("docs/screenshots", /\.png$/).map((f) => ["screenshots/web", f, true]),
  ...ls("docs/screenshots/judges", /\.png$/).map((f) => ["screenshots/web", f, true]),
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
  // -X: no extra attributes (uid/gid, timestamps beyond the DOS one), so the zip only changes when a file does.
  execFileSync("zip", ["-q", "-X", ZIP, ...files.filter((f) => f.zip).map((f) => f.path)], { cwd: OUT });
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
