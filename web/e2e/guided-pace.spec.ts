import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Guided speed (the default) on /demo: an intro card, then three beats per step ("What happens now", the
 * transactions, "What just changed"). `?timescale=` shortens every wait so the whole story plays in seconds.
 *
 * Screenshots of every beat go to GUIDED_SHOTS (default test-results/screenshots/guided). With MEASURE_GUIDED=1 the
 * last test plays all three stories at the real pace and writes their durations to GUIDED_SHOTS/durations.json.
 */

const SHOTS = process.env.GUIDED_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/guided");
const VP = { width: 1470, height: 830 };

/** Every beat the narration card shows, in order (deduplicated), recorded in the page. */
async function trackBeats(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __beats: string[]; __beatText: Record<string, string> };
    w.__beats = [];
    w.__beatText = {};
    const check = () => {
      const n = document.querySelector('[data-testid="demo-narration"]');
      const b = n?.getAttribute("data-beat");
      if (!b) return;
      const key = `${b}:${n?.querySelector("h2")?.textContent ?? ""}`;
      if (w.__beats[w.__beats.length - 1] !== key) w.__beats.push(key);
      w.__beatText[key] = n?.textContent ?? "";
    };
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true, attributes: true });
    check();
  });
}
const beats = (page: Page) => page.evaluate(() => (window as unknown as { __beats: string[] }).__beats);
/** The last text a beat showed (beats at test speed are too short to poll for). */
const beatText = (page: Page, key: string) => page.evaluate((k) => (window as unknown as { __beatText: Record<string, string> }).__beatText[k] ?? "", key);

async function noPageScroll(page: Page) {
  const m = await page.evaluate(() => ({ sh: document.scrollingElement!.scrollHeight, ih: window.innerHeight, sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(m.sh, "page scrolls vertically").toBeLessThanOrEqual(m.ih);
  expect(m.sw, "page scrolls sideways").toBeLessThanOrEqual(m.iw);
}

const beat = (page: Page) => page.getByTestId("demo-narration");

async function expectSummary(page: Page, pathId: string, timeout = 120_000) {
  const summary = page.getByTestId("demo-summary");
  await expect(summary).toBeVisible({ timeout });
  await expect(summary).toHaveAttribute("data-path", pathId);
  await expect(summary).toHaveAttribute("data-balanced", "true");
}

test("Guided is the default and plays the happy path, beat by beat, to the summary", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(VP);
  await page.goto("/demo?timescale=0.05");
  await expect(page.getByTestId("demo-play")).toBeEnabled();
  await expect(page.getByTestId("demo-speed-guided")).toHaveAttribute("aria-pressed", "true");
  await trackBeats(page);
  await page.getByTestId("demo-play").click();

  await expect(beat(page)).toHaveAttribute("data-beat", "intro");
  await expect(page.getByTestId("demo-cast").locator("li")).toHaveCount(6);
  // While the landlord creates the rental: the acting card and the receiving card light up.
  await expect(page.locator('[data-step="create"]')).toHaveAttribute("data-status", "running", { timeout: 20_000 });
  await expect(page.getByTestId("demo-actor-landlord")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("demo-actor-escrow")).toHaveAttribute("data-receiving", "true");
  // Funding: the tenant acts, the escrow receives, and "What just changed" shows the money that moved.
  await expect(page.locator('[data-step="fund"]')).toHaveAttribute("data-status", "running", { timeout: 30_000 });
  await expect(page.getByTestId("demo-actor-tenant")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("demo-actor-escrow")).toHaveAttribute("data-receiving", "true");

  await expectSummary(page, "happy");
  await noPageScroll(page);

  // Every step went through its three beats, after the intro.
  const seen = await beats(page);
  expect(seen[0]).toMatch(/^intro:/);
  const steps = 10;
  for (const b of ["now", "run", "changed"]) expect(seen.filter((s) => s.startsWith(`${b}:`)).length, `${b} beats`).toBe(steps);
  // (Step titles and role names follow the case-study wording: landlord / tenant or owner / renter.)
  const funded = seen.filter((s) => /^changed:.*funds deposit/.test(s));
  expect(funded).toHaveLength(1);
  // "What just changed" after funding: the money that moved, and what the contract now guarantees.
  const text = await beatText(page, funded[0]);
  expect(text).toContain("Money moved");
  expect(text).toMatch(/(Tenant|Renter)\s*−฿[\d,]+.*Escrow contract\s*\+฿/);
  expect(text).toMatch(/Neither (landlord|owner) nor (tenant|renter) can take it out alone/);
  // "On-chain now" listed the signer, the call and its hash.
  const run = seen.find((s) => /^run:.*funds deposit/.test(s))!;
  expect(await beatText(page, run)).toMatch(/Signing as (Tenant|Renter) → calling RentalEscrow\.fund\(\).*confirmed 0x/);
});

test("Guided step by step: captions wait for Next, Back reviews them, space pauses and resumes", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(VP);
  await page.goto("/demo?timescale=0.05");
  await page.getByTestId("demo-mode-step").click();
  await page.getByTestId("demo-play").click();

  // The intro waits for a click.
  await expect(beat(page)).toHaveAttribute("data-beat", "intro");
  await page.waitForTimeout(1_500);
  await expect(beat(page)).toHaveAttribute("data-beat", "intro");
  await expect(page.getByTestId("demo-beat-back")).toBeDisabled();
  await page.getByTestId("demo-beat-next").click();
  await expect(beat(page)).toHaveAttribute("data-beat", "now");
  await expect(beat(page).locator("h2")).toHaveText(/offers the (lease|rental)/);

  // Back shows the intro again (marked as a look back); the → key returns to the live caption.
  await page.getByTestId("demo-beat-back").click();
  await expect(beat(page)).toHaveAttribute("data-beat", "intro");
  await expect(page.getByTestId("demo-reviewing")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(beat(page)).toHaveAttribute("data-beat", "now");
  await expect(page.getByTestId("demo-reviewing")).toHaveCount(0);

  // Next runs the step; "What just changed" then waits for the next click.
  await page.keyboard.press("ArrowRight");
  await expect(beat(page)).toHaveAttribute("data-beat", "changed", { timeout: 20_000 });
  await page.waitForTimeout(1_000);
  await expect(beat(page)).toHaveAttribute("data-beat", "changed");
  await expect(page.locator('[data-step="create"]')).toHaveAttribute("data-status", "done");
  await expect(page.locator('[data-step="checkin"]')).toHaveAttribute("data-status", "pending");

  // Space pauses at any moment and resumes (even with the Pause button focused, it toggles once).
  await page.keyboard.press(" ");
  await expect(page.getByTestId("demo-runner")).toHaveAttribute("data-phase", "paused");
  await page.getByTestId("demo-mode-auto").click();
  await expect(page.getByTestId("demo-pause")).toHaveText(/Resume/);
  await page.waitForTimeout(1_000);
  await expect(page.locator('[data-step="checkin"]')).toHaveAttribute("data-status", "pending");
  await page.getByTestId("demo-pause").focus();
  await page.keyboard.press(" ");
  await expect(page.getByTestId("demo-pause")).toHaveText(/Pause/);
  await expect(page.locator('[data-step="checkin"]')).not.toHaveAttribute("data-status", "pending", { timeout: 20_000 });

  await expectSummary(page, "happy");
});

test("screenshots of every Guided beat at 1470x830, light and dark", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize(VP);
  for (const theme of ["light", "dark"] as const) {
    await page.addInitScript((t) => window.localStorage.setItem("keyescrow-theme", t), theme);
    await page.goto("/demo");
    await page.getByTestId("demo-mode-step").click();
    await page.getByTestId("demo-play").click();
    const snap = async (name: string) => {
      await noPageScroll(page);
      await page.screenshot({ path: path.join(SHOTS, `${theme}-${name}.png`) });
    };
    const next = () => page.getByTestId("demo-beat-next").click();

    await expect(beat(page)).toHaveAttribute("data-beat", "intro");
    await snap("1-intro");
    await next();
    // Through create, checkin and faucet to the funding step.
    for (const id of ["create", "checkin", "faucet"]) {
      await expect(page.locator(`[data-step="${id}"]`)).toHaveAttribute("data-status", "running");
      await expect(beat(page)).toHaveAttribute("data-beat", "now");
      await next();
      await expect(beat(page)).toHaveAttribute("data-beat", "changed", { timeout: 30_000 });
      await next();
    }
    await expect(page.locator('[data-step="fund"]')).toHaveAttribute("data-status", "running");
    await expect(beat(page)).toHaveAttribute("data-beat", "now");
    await snap("2-what-happens-now");
    await next();
    // Pause while the second transaction's line is up (before it is sent): spinner, plus the first one's hash.
    await expect(page.getByTestId("demo-activity-hash")).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator('[data-testid="demo-activity"][data-status="running"]')).toHaveCount(1, { timeout: 20_000 });
    await page.keyboard.press(" ");
    await expect(page.getByTestId("demo-runner")).toHaveAttribute("data-phase", "paused");
    await snap("3-tx-running");
    await page.keyboard.press(" ");
    await expect(beat(page)).toHaveAttribute("data-beat", "changed", { timeout: 30_000 });
    await snap("4-what-just-changed");
    // On to the AI inspection's "What just changed".
    for (const id of ["rent", "checkout", "inspect"]) {
      await next();
      await expect(page.locator(`[data-step="${id}"]`)).toHaveAttribute("data-status", "running");
      await next();
      await expect(beat(page)).toHaveAttribute("data-beat", "changed", { timeout: 30_000 });
      if (id === "rent") await snap("5-rent-changed");
    }
    await snap("6-ai-inspection-changed");
    await page.getByTestId("demo-mode-auto").click();
    await page.goto("/demo?timescale=0.05&autoplay=1");
    await expectSummary(page, "happy");
    await snap("7-summary");
  }
});

test("timing: the three stories at the real Guided pace", async ({ page }) => {
  test.skip(!process.env.MEASURE_GUIDED, "set MEASURE_GUIDED=1 to time the full Guided runs (about 10 minutes)");
  test.setTimeout(900_000);
  await page.setViewportSize(VP);
  const out: Record<string, number> = {};
  for (const p of ["happy", "dispute", "timeout"]) {
    await page.goto("/demo");
    await page.getByTestId(`demo-path-${p}`).click();
    await expect(page.getByTestId("demo-play")).toBeEnabled();
    const t0 = Date.now();
    await page.getByTestId("demo-play").click();
    await expectSummary(page, p, 400_000);
    out[p] = Math.round((Date.now() - t0) / 1000);
  }
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, "durations.json"), JSON.stringify(out, null, 2));
  console.log("Guided durations (s):", out);
});
