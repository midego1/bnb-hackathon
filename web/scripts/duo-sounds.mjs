// Renders /duo's sounds (lib/duoSound.ts) offline in Playwright's Chromium (OfflineAudioContext, 48 kHz stereo) to
// WAV files, and prints each one's peak, so they can be listened to and checked without the page.
// Usage: node scripts/duo-sounds.mjs [out-dir]   (default test-results/duo-sounds)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import ts from "typescript";

const out = path.resolve(process.argv[2] ?? "test-results/duo-sounds");
const src = readFileSync(new URL("../lib/duoSound.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;

const RATE = 48000;
/** [file, what plays at which second, length in s]. */
const TAKES = [
  ["fill", [["fill", 0.05]], 2.4],
  ["tick", [["tick", 0.05]], 0.4],
  ["split", [["split", 0.05]], 1.5],
  ["settle", [["settle", 0.05]], 4.2],
  ["click", [["click", 0.05]], 0.3],
  // The whole rental as /duo plays it (pay, two photos, the AI split, settled), then fill + settle on top of each other.
  ["rental", [["fill", 0.3], ["tick", 3], ["tick", 4.5], ["split", 6], ["settle", 8]], 12.5],
  ["overlap", [["fill", 0.05], ["settle", 0.05], ["tick", 0.4], ["click", 0.6]], 4.2],
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addScriptTag({ type: "module", content: `${js}\nwindow.duoSound = { schedule };` });
await page.waitForFunction(() => window.duoSound);
mkdirSync(out, { recursive: true });
for (const [name, cues, secs] of TAKES) {
  const { pcm, peak } = await page.evaluate(
    async ({ cues, secs, rate }) => {
      const c = new OfflineAudioContext(2, Math.round(secs * rate), rate);
      for (const [sound, at] of cues) window.duoSound.schedule(c, sound, at);
      const b = await c.startRendering();
      const [l, r] = [b.getChannelData(0), b.getChannelData(1)];
      const pcm = new Int16Array(l.length * 2);
      let peak = 0;
      for (let i = 0; i < l.length; i++) {
        peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
        pcm[2 * i] = Math.max(-1, Math.min(1, l[i])) * 32767;
        pcm[2 * i + 1] = Math.max(-1, Math.min(1, r[i])) * 32767;
      }
      let bin = "";
      const bytes = new Uint8Array(pcm.buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { pcm: btoa(bin), peak };
    },
    { cues, secs, rate: RATE },
  );
  const data = Buffer.from(pcm, "base64");
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(2, 22); // stereo
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  writeFileSync(path.join(out, `duo-${name}.wav`), Buffer.concat([head, data]));
  console.log(`duo-${name}.wav  ${secs} s  peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
}
await browser.close();
