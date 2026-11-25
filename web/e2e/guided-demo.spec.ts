import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { restoreChainAfterEachTest } from "./chain";

/**
 * The one-click guided demo (/demo) on the hermetic e2e anvil: click "Play the demo" in fast mode and check the end
 * summary (lease settled, balances add up) for the happy path and the dispute path, plus the "owner ignores it"
 * timeout path (fast-forwards the throwaway anvil by 7 days).
 */

// The "owner ignores it" story fast-forwards the shared anvil 7 days: undo it after each test (e2e/chain.ts).
restoreChainAfterEachTest();

const SHOTS = path.resolve(__dirname, "../test-results/screenshots");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

/** Success toasts clear themselves after 6 s; wait so screenshots show the page, not the toast stack. */
async function noToasts(page: Page) {
  await expect(page.locator('[role="status"]')).toHaveCount(0, { timeout: 15_000 });
}

/** Track the most toasts ever on screen at once (the demo shows none: its timeline reports every transaction). */
async function trackToasts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __maxToasts: number };
    w.__maxToasts = 0;
    new MutationObserver(() => {
      w.__maxToasts = Math.max(w.__maxToasts, document.querySelectorAll('[role="status"]').length);
    }).observe(document.body, { childList: true, subtree: true });
  });
}
const maxToasts = (page: Page) => page.evaluate(() => (window as unknown as { __maxToasts: number }).__maxToasts);

function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  return problems;
}

async function expectSettledAndBalanced(page: Page, pathId: string) {
  const summary = page.getByTestId("demo-summary");
  await expect(summary).toBeVisible({ timeout: 90_000 });
  await expect(summary).toHaveAttribute("data-path", pathId);
  await expect(summary).toHaveAttribute("data-status", "settled");
  await expect(summary).toHaveAttribute("data-balanced", "true");
  await expect(summary.getByTestId("status-badge")).toHaveText("Settled");
  await expect(page.getByTestId("demo-balanced")).toContainText("Balances add up");
  // Every step on the rail finished, and the escrow is empty.
  await expect(page.locator('[data-testid="demo-step"]:not([data-status="done"])')).toHaveCount(0);
  await expect(page.getByTestId("demo-bal-escrow")).toHaveAttribute("data-value", "0");
  // Amounts are THB first.
  await expect(summary.getByTestId("amount-thb").first()).toContainText("฿");
  // The live lease page shows the same outcome.
  await expect(page.getByTestId("settlement")).toBeVisible();
  const value = async (id: string) => BigInt((await page.getByTestId(id).getAttribute("data-value")) ?? "-1");
  return { tenant: await value("demo-bal-tenant"), landlord: await value("demo-bal-landlord"), treasury: await value("demo-bal-treasury") };
}

test("landing page: Play the demo runs the happy path to a settled, balanced summary", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("/app");
  await expect(page.getByTestId("play-demo")).toBeVisible();
  await shot(page, "10-landing-play-demo");

  await page.goto("/demo");
  await expect(page.getByTestId("demo-play")).toBeEnabled();
  await shot(page, "11-demo-start");
  await page.getByTestId("demo-speed-fast").click();
  await trackToasts(page);
  await page.getByTestId("demo-play").click();

  // The AI inspection with reasons and the KeyEscrow Inspector line.
  await expect(page.getByTestId("demo-inspection")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("demo-inspector")).toContainText("KeyEscrow Inspector");
  await expect(page.getByTestId("demo-inspection").locator("li")).toHaveCount(2);

  const b = await expectSettledAndBalanced(page, "happy");
  // No toast ever covers the stage: the timeline and the balance cards report every transaction instead.
  expect(await maxToasts(page)).toBe(0);
  await expect(page.locator('[role="status"]')).toHaveCount(0, { timeout: 1_000 });
  expect(b.treasury).toBeGreaterThan(BigInt(0)); // the one-time fee reached the treasury
  expect(b.landlord).toBeGreaterThan(BigInt(0));
  expect(await page.getByTestId("demo-tx").count()).toBeGreaterThanOrEqual(9);
  await noToasts(page);
  await shot(page, "13-demo-summary");
  await page.getByTestId("demo-summary").screenshot({ path: path.join(SHOTS, "13-demo-summary-card.png") });
  expect(problems).toEqual([]);
});

test("dispute path: landlord disputes, dispute desk rules on a split", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("/demo");
  await page.getByTestId("demo-path-dispute").click();
  await page.getByTestId("demo-speed-fast").click();
  await page.getByTestId("demo-play").click();
  const b = await expectSettledAndBalanced(page, "dispute");
  // The desk's split: both sides get part of the deposit.
  expect(b.tenant).toBeGreaterThan(BigInt(0));
  await expect(page.locator('[data-event="DisputeRaised"]')).toHaveCount(1);
  await shot(page, "14-demo-dispute-summary");

  // "Try: owner ignores it" from the end screen: a 7-day fast-forward, then the full deposit back to the renter.
  await page.getByTestId("demo-try-timeout").click();
  await expect(page.locator('[data-step="wait"]')).toContainText("fast-forward 7 days (demo only)");
  await expectSettledAndBalanced(page, "timeout");
  expect(problems).toEqual([]);
});

test("step by step waits for a click; a failed step shows the error and Retry carries on", async ({ page }) => {
  // The AI inspector fails once (HTTP 503), then works again.
  let failures = 0;
  await page.route("**/api/settlement", (route) => (failures++ === 0 ? route.fulfill({ status: 503, json: { error: "down" } }) : route.fallback()));
  const status = (id: string) => page.locator(`[data-step="${id}"]`);

  await page.goto("/demo");
  await page.getByTestId("demo-mode-step").click();
  await page.getByTestId("demo-speed-fast").click();
  await page.getByTestId("demo-play").click();
  for (const id of ["create", "checkin", "faucet", "fund", "rent", "checkout"]) {
    await expect(status(id)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await expect(page.getByTestId("demo-next")).toBeVisible();
    // Step by step: nothing moves until the presenter clicks.
    await expect(page.locator('[data-testid="demo-step"][data-status="running"]')).toHaveCount(0);
    await page.getByTestId("demo-next").click();
  }

  // The inspection fails: plain-language error, Retry, and the run carries on from that step.
  await expect(page.getByTestId("demo-error")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("demo-error")).toContainText("The AI inspector is unavailable right now");
  await expect(status("inspect")).toHaveAttribute("data-status", "error");
  await page.getByTestId("demo-retry").click();
  await expect(status("inspect")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(page.getByTestId("demo-next")).toBeVisible();
  await expect(page.getByTestId("demo-narration")).toContainText("KeyEscrow Inspector agent compared");
  await expect(page.getByText("Return photos (2)")).toBeVisible();
  await noToasts(page);
  await shot(page, "12-demo-mid-run");

  // Switch to autoplay mid-run: it carries on by itself to the end.
  await page.getByTestId("demo-mode-auto").click();
  await expectSettledAndBalanced(page, "happy");
  expect(failures).toBe(2);
});
