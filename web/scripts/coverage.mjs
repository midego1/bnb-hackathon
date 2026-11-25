#!/usr/bin/env node
// `pnpm coverage` (repo root): line coverage of the contracts (forge coverage), the web unit tests and the agent tests
// (vitest + v8), each written as lcov to <part>/coverage/lcov.info, then the static shields.io badges in README.md
// (between the coverage:start/end markers) are rewritten with the measured numbers. No coverage service is involved.
// The forge flags match the coverage step in .github/workflows/ci.yml.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const run = (cwd, cmd, args) => execFileSync(cmd, args, { cwd: join(root, cwd), stdio: "inherit" });

mkdirSync(join(root, "contracts/coverage"), { recursive: true }); // forge does not create it
run("contracts", "forge", [
  "coverage",
  "--report", "summary",
  "--report", "lcov",
  "--report-file", "coverage/lcov.info",
  // Only the deployed contracts count: not the tests, the deploy scripts or the testnet mocks.
  "--no-match-coverage", "(script|test|mocks)/",
]);
run("web", "pnpm", ["exec", "vitest", "run", "--coverage"]);
run("agent", "pnpm", ["exec", "vitest", "run", "--coverage"]);

/** Lines hit / lines found over every file in an lcov report, as a percentage with one decimal. */
function lcovLines(file) {
  let found = 0;
  let hit = 0;
  for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
    if (line.startsWith("LF:")) found += Number(line.slice(3));
    if (line.startsWith("LH:")) hit += Number(line.slice(3));
  }
  if (!found) throw new Error(`${file}: no LF records, is this an lcov report?`);
  return Math.floor((hit / found) * 1000) / 10;
}

const badge = (label, pct) => {
  const color = pct >= 90 ? "brightgreen" : pct >= 75 ? "green" : pct >= 60 ? "yellow" : "orange";
  return `![${label} coverage](https://img.shields.io/badge/${encodeURIComponent(`coverage ${label}`)}-${pct}%25-${color}.svg)`;
};
const parts = [
  ["contracts", lcovLines("contracts/coverage/lcov.info")],
  ["web", lcovLines("web/coverage/lcov.info")],
  ["agent", lcovLines("agent/coverage/lcov.info")],
];

const readme = join(root, "README.md");
const text = readFileSync(readme, "utf8");
const block = /<!-- coverage:start -->[\s\S]*?<!-- coverage:end -->/;
if (!block.test(text)) throw new Error("README.md has no <!-- coverage:start --> ... <!-- coverage:end --> block");
const badges = parts.map(([label, pct]) => badge(label, pct)).join("\n");
writeFileSync(readme, text.replace(block, `<!-- coverage:start -->\n${badges}\n<!-- coverage:end -->`));
console.log(`\nline coverage: ${parts.map(([l, p]) => `${l} ${p}%`).join(", ")} (README.md badges updated)`);
