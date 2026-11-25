import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Regenerates the README / docs screenshots (docs/screenshots/*.png) at 1470x830, light theme, on the seeded
 * throwaway anvil of the e2e setup (no keys: Demo rates, demo inspector). It is kept in docs/ so it never runs in CI.
 *
 *   cp docs/screenshots/capture.spec.ts web/e2e/docs-screenshots.spec.ts
 *   cd web && npx playwright test docs-screenshots --workers=1
 *   rm e2e/docs-screenshots.spec.ts
 *
 * Shots go to DOCS_SHOTS (default ../docs/screenshots). Viewport-sized (not full page), so they read like the screen.
 */

const SHOTS = process.env.DOCS_SHOTS ?? path.resolve(__dirname, "../../docs/screenshots");
const VP = { width: 1470, height: 830 };
const SEEDED_LEASE = "0x9f1ac54BEF0DD2f6f3462EA0fa94fC62300d3a8e"; // contracts/deployments/31337.demo.example.json `lease`

test.use({ viewport: VP, colorScheme: "light" });

async function light(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("keyescrow-theme", "light"));
}

/** No toasts, no hover state, top of the page, transitions settled. */
async function shot(page: Page, name: string) {
  await expect(page.locator('[role="status"]')).toHaveCount(0, { timeout: 20_000 });
  await page.mouse.move(VP.width - 2, VP.height - 2);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function view(page: Page, href: "landlord" | "shareholders" | "tenant" | "arbiter", role: string) {
  await page.getByTestId(`view-${href}`).first().click();
  await page.waitForURL(new RegExp(`/${href}$`));
  await expect(page.getByTestId(`dev-role-${role}`)).toHaveAttribute("aria-pressed", "true");
}

test("docs screenshots", async ({ page }) => {
  test.setTimeout(300_000);
  await light(page);

  // Home.
  await page.goto("/");
  await expect(page.getByTestId("play-demo")).toBeVisible();
  await shot(page, "home");

  // /how-it-works: the robot inspector scene, paused on a fixed frame.
  await page.goto("/how-it-works?autoplay=0&scene=6&t=6500");
  await page.waitForTimeout(800);
  await shot(page, "how-it-works");

  // /developers.
  await page.goto("/developers");
  await expect(page.getByTestId("action-get_lease")).toBeVisible();
  await shot(page, "developers");

  // Fleet owner and Shareholders (the sidebar role switcher also switches the demo account).
  await page.goto("/");
  await view(page, "landlord", "landlord");
  await expect(page.getByTestId("scooter-card").first()).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "fleet-owner");

  await view(page, "shareholders", "investor");
  await expect(page.getByTestId("my-shares")).toContainText("3,000.00");
  await expect(page.getByTestId("vault-inflow").first()).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "shareholders");

  await view(page, "tenant", "tenant");
  await expect(page.getByTestId("renter-rental").first()).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "renter");

  await view(page, "arbiter", "arbiter");
  await page.waitForTimeout(2500);
  await shot(page, "dispute-desk");

  // Lease detail: the seeded active rental (funded, pickup photos, timeline), seen by the renter.
  await page.goto(`/lease/${SEEDED_LEASE}`);
  await page.getByTestId("dev-role-tenant").click();
  await expect(page.getByTestId("dev-role-tenant")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("status-badge").first()).toHaveText("Active");
  await expect(page.getByTestId("timeline")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "lease-detail");

  // /demo in Guided speed, step by step: start screen, then mid-run on the AI inspection's "What just changed".
  await page.goto("/demo?speed=guided&step=1&timescale=0.05");
  await expect(page.getByTestId("demo-play")).toBeEnabled();
  await shot(page, "demo-start");
  await page.getByTestId("demo-play").click();
  const inspect = page.locator('[data-step="inspect"]');
  const narration = page.getByTestId("demo-narration");
  for (let i = 0; i < 80; i++) {
    if ((await inspect.getAttribute("data-status")) === "done" && (await narration.getAttribute("data-beat")) === "changed") break;
    const next = page.getByTestId("demo-beat-next").or(page.getByTestId("demo-next")).first();
    if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await expect(inspect).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("demo-inspection")).toBeVisible();
  await page.waitForTimeout(2000);
  await shot(page, "demo-mid-run");

  // Play out to the end summary.
  await page.getByTestId("demo-mode-auto").click().catch(() => {});
  for (let i = 0; i < 200 && !(await page.getByTestId("demo-summary").isVisible()); i++) {
    const next = page.getByTestId("demo-beat-next").or(page.getByTestId("demo-next")).first();
    if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await expect(page.getByTestId("demo-summary")).toHaveAttribute("data-balanced", "true", { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot(page, "demo-summary");
});
