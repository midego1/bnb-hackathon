import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { mediaCopy } from "@/components/media/copy";

/** scripts/media.mjs: the /media files, the .zip and the manifest the page reads. */
const WEB = path.join(__dirname, "..");
const OUT = path.join(WEB, "public", "media");
const MiB = 1024 * 1024;
type Manifest = { zip: { path: string; bytes: number }; files: { path: string; src: string; bytes: number; zip: boolean }[] };
let m: Manifest;

beforeAll(() => {
  execFileSync("node", ["scripts/media.mjs"], { cwd: WEB });
  m = JSON.parse(readFileSync(path.join(OUT, "manifest.json"), "utf8"));
}, 60_000);

describe("media manifest", () => {
  it("lists files that exist, with their size, copied from the repo", () => {
    expect(m.files.length).toBeGreaterThan(50);
    for (const f of m.files) {
      expect(statSync(path.join(OUT, f.path)).size, f.path).toBe(f.bytes);
      expect(statSync(path.join(WEB, "..", f.src)).size, f.src).toBe(f.bytes);
    }
  });

  it("zips every file but the duplicates, in folders, below the 25 MiB Workers Static Assets limit", () => {
    expect(m.zip.bytes).toBe(statSync(path.join(OUT, m.zip.path)).size);
    expect(m.zip.bytes).toBeLessThan(25 * MiB);
    // scripts/media.mjs writes the zip itself (no `zip` binary): unzip checks every entry's CRC and its listing.
    expect(execFileSync("unzip", ["-tq", m.zip.path], { cwd: OUT, encoding: "utf8" })).toMatch(/No errors detected/);
    const inZip = execFileSync("unzip", ["-Z1", m.zip.path], { cwd: OUT, encoding: "utf8" }).trim().split("\n").sort();
    expect(inZip).toEqual(m.files.filter((f) => f.zip).map((f) => f.path).sort());
    expect(new Set(inZip.map((p) => p.slice(0, p.lastIndexOf("/"))))).toEqual(new Set(["videos", "deck", "screenshots/web", "screenshots/ios", "brand", "docs"]));
    expect(m.files.filter((f) => !f.zip).every((f) => /\.(webm|gif|jpg)$/.test(f.path) || f.path === "videos/pitch.mp4" || f.path === "videos/pitch-1080.mp4" || f.src.startsWith("ios/screenshots/") || f.src.startsWith("docs/screenshots/"))).toBe(true);
  });

  it("has a label for every brand file and document the page lists", () => {
    const names = (folder: string) => m.files.filter((f) => f.path.startsWith(`${folder}/`)).map((f) => f.path.split("/").pop()!).sort();
    expect(names("brand")).toEqual(Object.keys(mediaCopy.en.brand.file).sort());
    expect(names("docs")).toEqual(Object.keys(mediaCopy.en.docs).sort());
  });
});
