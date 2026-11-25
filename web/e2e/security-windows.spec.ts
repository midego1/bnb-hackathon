import { expect, test, type Page } from "@playwright/test";
import { increaseTime, restoreChainAfterEachTest } from "./chain";

/**
 * Security review follow-ups (docs/SECURITY.md): KE-02 the owner's reply window closes after the renter's proposal
 * (only "Claim deposit" works), KE-01 fleet shares are locked 7 days after a deposit (claiming income is not).
 * Both fast-forward the anvil clock, so every test runs on a snapshot that is reverted afterwards.
 */
restoreChainAfterEachTest();

const DAY = 86400;

async function actAs(page: Page, role: "landlord" | "tenant" | "investor") {
  await page.getByTestId(`dev-role-${role}`).click();
  await expect(page.getByTestId(`dev-role-${role}`)).toHaveAttribute("aria-pressed", "true");
}

async function waitForTx(page: Page, title: string) {
  await expect(page.locator('[role="status"]', { hasText: title }).last()).toHaveAttribute("data-kind", "success", { timeout: 30_000 });
}

test("after the 7-day reply window the owner cannot answer; the renter's Claim deposit is the main action", async ({ page }) => {
  // The renter proposes a full refund on the seeded active rental.
  await page.goto("/tenant");
  await actAs(page, "tenant");
  const active = page.locator('[data-testid="renter-rental"][data-status="1"]').first();
  const address = (await active.getAttribute("data-address"))!;
  await page.goto(`/lease/${address}`);
  await page.getByTestId("propose-manual").click();
  await waitForTx(page, "Propose split");
  await expect(page.getByTestId("current-proposal")).toContainText("by the renter");

  // Inside the window the owner can still answer.
  await actAs(page, "landlord");
  await expect(page.getByTestId("accept-proposal")).toBeEnabled();
  await expect(page.getByTestId("response-window-closed")).toHaveCount(0);

  // Past the window (chain time): owner's accept / counter / dispute are gone, with the plain reason.
  await increaseTime(7 * DAY + 60);
  await page.reload();
  await actAs(page, "landlord");
  await expect(page.getByTestId("response-window-closed")).toContainText("The 7-day response window closed on");
  await expect(page.getByTestId("response-window-closed")).toContainText("The renter can now claim the full deposit.");
  await expect(page.getByTestId("accept-proposal")).toBeDisabled();
  await expect(page.getByTestId("propose-manual")).toHaveCount(0);
  await expect(page.getByTestId("dispute")).toHaveCount(0);

  // The renter's Claim deposit works.
  await actAs(page, "tenant");
  await expect(page.getByTestId("claim-timeout")).toHaveText("Claim deposit");
  await page.getByTestId("claim-timeout").click();
  await waitForTx(page, "Claim owner timeout");
  await expect(page.getByTestId("status-badge").first()).toHaveText("Settled");
});

test("shares are locked 7 days after a deposit: redeem is disabled with a countdown, then opens", async ({ page }) => {
  await page.goto("/shareholders");
  await actAs(page, "investor");
  await page.getByTestId("deposit-amount").fill("100");
  await page.getByTestId("approve-vault").click();
  await waitForTx(page, "Approve USDT");
  await page.getByTestId("deposit-vault").click();
  await waitForTx(page, "Buy fleet shares");

  await expect(page.getByTestId("share-lock")).toContainText("Shares locked until");
  await expect(page.getByTestId("share-lock")).toContainText("7 days after your last deposit");
  await expect(page.getByTestId("redeem-shares")).toBeDisabled();

  await increaseTime(7 * DAY + 60);
  await page.reload();
  await actAs(page, "investor");
  await expect(page.getByTestId("share-lock")).toHaveCount(0);
  await expect(page.getByTestId("redeem-shares")).toBeEnabled();
});
