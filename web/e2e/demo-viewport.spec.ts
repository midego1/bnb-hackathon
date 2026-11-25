import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * /demo is one screen on a laptop or projector: at these viewports the page never scrolls (not during play, not on
 * the end summary) for all three stories. A monitor in the page records the worst overflow after every DOM change.
 *
 * Screenshots of every size go to DEMO_VIEWPORT_SHOTS (default test-results/screenshots/viewport).
 */

const VIEWPORTS = [
  { width: 1470, height: 830 }, // MacBook Air 13"/15", Pro 14" at default scaling, minus the browser chrome
  { width: 1440, height: 800 },
  { width: 1280, height: 720 }, // projector
];
const SHOTS = process.env.DEMO_VIEWPORT_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/viewport");

type Overflow = { y: number; x: number; at: string };

/** Record the largest page overflow (scrollHeight - innerHeight, and the same sideways) from now on. */
async function watchOverflow(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __overflow: Overflow };
    w.__overflow = { y: 0, x: 0, at: "" };
    const check = () => {
      const el = document.scrollingElement!;
      const y = el.scrollHeight - window.innerHeight;
      const x = el.scrollWidth - window.innerWidth;
      if (y > w.__overflow.y || x > w.__overflow.x) {
        const runner = document.querySelector('[data-testid="demo-runner"]');
        const title = document.querySelector('[data-testid="demo-narration"] h2')?.textContent ?? "";
        w.__overflow = { y: Math.max(y, w.__overflow.y), x: Math.max(x, w.__overflow.x), at: `${runner?.getAttribute("data-phase")} ${title}` };
      }
    };
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    window.addEventListener("resize", check);
    check();
  });
}
const worstOverflow = (page: Page) => page.evaluate(() => (window as unknown as { __overflow: Overflow }).__overflow);

/** Right now: no page scroll in either direction. */
async function expectOneScreen(page: Page, when: string) {
  const m = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement!.scrollHeight,
    innerHeight: window.innerHeight,
    scrollWidth: document.scrollingElement!.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(m.scrollHeight, `page scrolls vertically ${when}`).toBeLessThanOrEqual(m.innerHeight);
  expect(m.scrollWidth, `page scrolls sideways ${when}`).toBeLessThanOrEqual(m.innerWidth);
}

async function expectSummary(page: Page, pathId: string) {
  const summary = page.getByTestId("demo-summary");
  await expect(summary).toBeVisible({ timeout: 90_000 });
  await expect(summary).toHaveAttribute("data-path", pathId);
  await expect(summary).toHaveAttribute("data-balanced", "true");
  // The whole summary sits inside the viewport: nothing below the fold.
  const box = (await summary.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  await expect(page.getByTestId("demo-balanced")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("demo-run-again")).toBeInViewport({ ratio: 1 });
  await expectOneScreen(page, `on the ${pathId} summary`);
}

/** In step-by-step mode, stop after step `id`, check the stage mid-run and optionally screenshot it. */
async function midRun(page: Page, id: string, shot?: string) {
  await expect(page.locator(`[data-step="${id}"]`)).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(page.getByTestId("demo-next")).toBeVisible();
  // The key info of a running step is on screen: narration, controls, the actors and the current step on the timeline.
  await expect(page.getByTestId("demo-narration")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("demo-next")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("demo-actors")).toBeInViewport({ ratio: 0.9 });
  await expect(page.locator('[data-testid="demo-step"][data-current="true"]')).toBeInViewport({ ratio: 1 });
  await expectOneScreen(page, `mid-run after ${id}`);
  if (shot) await page.screenshot({ path: path.join(SHOTS, `${shot}.png`) });
}

for (const vp of VIEWPORTS) {
  const name = `${vp.width}x${vp.height}`;
  const main = true; // screenshot every size; the 1470x830 ones are the reference

  test(`one screen at ${name}: happy, dispute and timeout stories never scroll the page`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(vp);
    await page.goto("/demo");
    await expect(page.getByTestId("demo-play")).toBeEnabled();
    await watchOverflow(page);
    await expectOneScreen(page, "before play");
    if (main) await page.screenshot({ path: path.join(SHOTS, `${name}-0-start.png`) });

    // Happy path, step by step to stop mid-run after the first rent payout (money moves to landlord and treasury).
    await page.getByTestId("demo-speed-fast").click();
    await page.getByTestId("demo-mode-step").click();
    await page.getByTestId("demo-play").click();
    for (const id of ["create", "checkin", "faucet", "fund"]) {
      await midRun(page, id, main && id === "fund" ? `${name}-1-happy-mid-run-fund` : undefined);
      await page.getByTestId("demo-next").click();
    }
    await midRun(page, "rent", main ? `${name}-2-happy-mid-run-rent` : undefined);
    await page.getByTestId("demo-mode-auto").click();
    await expectSummary(page, "happy");
    if (main) await page.screenshot({ path: path.join(SHOTS, `${name}-3-happy-summary.png`) });

    // Dispute path from the end screen, stopping after the dispute desk's ruling.
    await page.getByTestId("demo-mode-step").click();
    await page.getByTestId("demo-try-dispute").click();
    for (const id of ["create", "checkin", "faucet", "fund", "rent", "checkout", "inspect", "propose", "dispute"]) {
      await midRun(page, id, main && id === "inspect" ? `${name}-4-dispute-mid-run-inspect` : main && id === "dispute" ? `${name}-5-dispute-mid-run-dispute` : undefined);
      await page.getByTestId("demo-next").click();
    }
    await midRun(page, "resolve", main ? `${name}-6-dispute-mid-run-ruling` : undefined);
    await page.getByTestId("demo-mode-auto").click();
    await expectSummary(page, "dispute");
    if (main) await page.screenshot({ path: path.join(SHOTS, `${name}-7-dispute-summary.png`) });

    // Landlord timeout, autoplay all the way.
    await page.getByTestId("demo-try-timeout").click();
    await expect(page.getByTestId("demo-narration")).toBeVisible();
    await expectSummary(page, "timeout");
    if (main) await page.screenshot({ path: path.join(SHOTS, `${name}-8-timeout-summary.png`) });

    // Never once, during any of the three runs.
    const worst = await worstOverflow(page);
    expect(worst, `worst page overflow (at: ${worst.at})`).toMatchObject({ y: 0, x: 0 });
  });
}

test("mobile: the stage stacks and scrolls, nothing sticks out sideways", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  await page.getByTestId("demo-speed-fast").click();
  await page.getByTestId("demo-play").click();
  await expect(page.getByTestId("demo-summary")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("demo-summary")).toHaveAttribute("data-balanced", "true");
  const m = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.iw);
  await page.screenshot({ path: path.join(SHOTS, "390x844-mobile-summary.png"), fullPage: true });
});
