import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_WEB_PORT } from "./env";
import { audit } from "./phoneAudit";
import { SPONSOR_CHECKLIST } from "../lib/sponsorChecklist";

/**
 * /sponsors: one card per sponsor track with its state from the server's integrations (the e2e server blanks every
 * sponsor env var, so CMC, Atlas and Cournot wait for a key and Living Brain is built, on local memory).
 */
const SHOTS = process.env.SPONSORS_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/sponsors");
const TRACKS = ["bnb", "cmcAtlas", "livingBrain", "cournot", "aws"];

function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`));
  return problems;
}
const sideways = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);

test("landing footer → /sponsors: five tracks, honest states, the checklist, see-it and proof links", async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize({ width: 1470, height: 830 });
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Sponsor tracks" }).click();
  await page.waitForURL(/\/sponsors$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sponsor tracks" })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/sponsors$/);
  await expect(page.getByTestId("sponsor-track")).toHaveCount(5);
  expect(await page.getByTestId("sponsor-track").evaluateAll((els) => els.map((e) => e.getAttribute("data-track")))).toEqual(TRACKS);
  const states = { bnb: "live", cmcAtlas: "waiting", cmc: "waiting", atlas: "waiting", livingBrain: "built", cournot: "waiting", aws: "built" };
  for (const [id, state] of Object.entries(states)) await expect(page.getByTestId(`sponsor-${id}-state`)).toHaveAttribute("data-state", state);
  await expect(page.getByTestId("sponsor-bnb-state")).toHaveText("Live");
  await expect(page.getByTestId("sponsor-cournot-state")).toHaveText("Waiting for key");
  // The states are the API's.
  const api = await (await page.request.get("/api/integrations")).json();
  expect(api.integrations.map((i: { state: string }) => i.state)).not.toContain("live");

  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Split screen: renter phone + rental company" })).toHaveAttribute("href", "/duo/mystery-box");
  await expect(main.getByRole("link", { name: "Dispute desk with history cards" })).toHaveAttribute("href", "/arbiter");
  await expect(main.getByRole("link", { name: "Back office: demo shops" })).toHaveAttribute("href", "/backoffice");
  await expect(main.getByRole("link", { name: "Agent card (ERC-8004 #2921)" })).toHaveAttribute("href", /agent-card\.json$/);
  await expect(main.getByRole("link", { name: "Mainnet factory on BscScan" })).toHaveAttribute("href", "https://bscscan.com/address/0x8d708713C2a9da93450F224f35eF7FA15c0a2d3E");
  // The checklist: every row of lib/sponsorChecklist.ts, in track order; rows whose integration is not live here
  // (CMC, Atlas, Living Brain: blank on the e2e server) say pending and why, the rest keep their state.
  const rows = Object.values(SPONSOR_CHECKLIST).flat();
  expect(await page.getByTestId("sponsor-check").evaluateAll((els) => els.map((e) => e.getAttribute("data-row")))).toEqual(rows.map((r) => r.id));
  for (const r of rows) await expect(page.getByTestId(`sponsor-check-${r.id}`)).toHaveAttribute("data-state", r.needs ? "pending" : r.state);
  const guard = page.locator('[data-row="atlasGuard"]');
  await expect(guard).toContainText("Deploy on BNB Chain");
  await expect(guard.getByRole("link", { name: "AtlasSwapGuard on BscScan" })).toHaveAttribute("href", "https://testnet.bscscan.com/address/0xD26dBba1eE904c95d3467F479FC4410b0400b6bA");
  await expect(page.getByTestId("sponsor-check-atlasGuard")).toHaveText("Live");
  await expect(page.locator('[data-row="cmcCore"]')).toContainText("Not live on this server.");
  await expect(page.locator('[data-row="cournotCall"]')).toContainText("7dcbb40bfbfdebad018e9bcad0d70c51");
  await expect(page.getByTestId("sponsor-check-cournotCall")).toHaveText("Done");
  await expect(page.locator('[data-row="cmcWriteup"]').getByRole("link", { name: "WRITEUP.md" })).toHaveAttribute("href", "https://github.com/midego1/bnb-hackathon/blob/main/docs/WRITEUP.md");
  await expect(page.locator('[data-row="lbWallet"]').getByRole("link", { name: "Dispute desk" })).toHaveAttribute("href", "/arbiter");
  await expect(page.getByTestId("sponsor-not-entered")).toContainText("Four.meme");
  await expect(page.getByTestId("sponsor-not-entered")).toContainText("Flap");
  await expect(page.getByTestId("nav-sponsors")).toHaveAttribute("href", "/sponsors");
  await expect(page.getByTestId("nav-sponsors")).toHaveAttribute("aria-current", "page");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(SHOTS, "sponsors-light-1470x830.png") });
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test("/sponsors in dark and in 中文", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("keyescrow-theme", "dark"));
  await page.setViewportSize({ width: 1470, height: 830 });
  await page.goto("/sponsors");
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  await page.screenshot({ path: path.join(SHOTS, "sponsors-dark-1470x830.png") });
  await page.context().addCookies([{ name: "ke_lang", value: "zh", url: `http://127.0.0.1:${E2E_WEB_PORT}` }]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "赞助赛道" })).toBeVisible();
  await expect(page.getByTestId("sponsor-bnb-state")).toHaveText("已上线");
  await expect(page.getByTestId("sponsor-not-entered")).toContainText("未参加");
  await expect(page.getByText("赛道要求 → KeyScrow 如何做到")).toHaveCount(5);
  await expect(page.getByTestId("sponsor-check-cournotCall")).toHaveText("已完成");
});

test("/sponsors on a phone: no sideways scroll, tap targets and text pass the phone audit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sponsors");
  await expect(page.getByTestId("sponsor-track")).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready);
  expect(await audit(page)).toEqual([]);
  await page.screenshot({ path: path.join(SHOTS, "sponsors-phone-390x844.png"), fullPage: true });
});
