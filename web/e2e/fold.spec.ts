import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { audit } from "./phoneAudit";

/**
 * Unfolded foldables (Galaxy Z Fold 5 inner screen 673x841, Pixel Fold 701x840, both ways round) get the desktop
 * layout, not the stacked phone one (the `fold` variant in app/globals.css):
 * - /duo and /stage: the 1280x800 desktop composition, scaled to fit (components/stage/Live.tsx FitFrame); the duo's
 *   three columns side by side, and the framed renter phone (/r) still takes a tap;
 * - the landing page: the header's section links, the search as fields (not the phone's pill), the wide street picture
 *   and the money board lying across;
 * - the app pages: the sidebar (not the phone's top bar) and the desktop grids;
 * - everywhere: no sideways scroll, nothing cut off, every control at least 40 px (the phone audit, e2e/phoneAudit.ts).
 * FOLD_AUDIT=record only lists the audit's findings (test annotations) instead of failing. Screenshots: FOLD_SHOTS
 * (default test-results/screenshots/fold).
 */

const SHOTS = process.env.FOLD_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/fold");
mkdirSync(SHOTS, { recursive: true });
const RECORD = process.env.FOLD_AUDIT === "record";
const FOLDS = [
  { width: 673, height: 841 },
  { width: 841, height: 673 },
  { width: 701, height: 840 },
  { width: 840, height: 701 },
];
const SLUG = "mystery-box";
const HONDA = "honda-click-125i";
const PAGES = ["/", "/app", "/tenant", "/landlord", "/sponsors", "/media", "/how-it-works?autoplay=0", "/demo"];

async function fold(browser: Browser, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 });
  return ctx.newPage();
}

const box = async (l: Locator) => (await l.boundingBox())!;
const noSidewaysScroll = async (page: Page) => expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
/** a is left of b, on the same row (their heights overlap). */
function sideBySide(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
  expect(a.y).toBeLessThan(b.y + b.height);
  expect(b.y).toBeLessThan(a.y + a.height);
}

for (const vp of FOLDS) {
  const at = `${vp.width}x${vp.height}`;

  test(`fold ${at}: /duo and /stage are the desktop screen, scaled to fit, and the framed phone takes a tap`, async ({ browser }) => {
    const page = await fold(browser, vp);
    await page.goto(`/duo/${SLUG}`);
    const duo = page.frameLocator("[data-testid='fit-frame'] iframe");
    await expect(duo.getByTestId("duo-view")).toBeVisible();
    const frame = await box(page.locator("[data-testid='fit-frame'] iframe"));
    // 1280x800 scaled to the viewport: the whole screen in view, as wide (or as tall) as it can be.
    expect(frame.x).toBeGreaterThanOrEqual(-0.5);
    expect(frame.y).toBeGreaterThanOrEqual(-0.5);
    expect(frame.x + frame.width).toBeLessThanOrEqual(vp.width + 0.5);
    expect(frame.y + frame.height).toBeLessThanOrEqual(vp.height + 0.5);
    expect(Math.max(frame.width / vp.width, frame.height / vp.height)).toBeGreaterThan(0.99);
    expect(frame.width / frame.height).toBeCloseTo(1280 / 800, 1);
    // Renter phone | vault | owner phone, side by side; no "best on a laptop" note.
    await expect(duo.getByTestId("duo-owner-phone")).toBeVisible(); // the phones are measured and drawn
    await expect(async () => {
      const [renter, vault, owner] = await Promise.all([duo.getByTestId("duo-renter"), duo.getByTestId("duo-board"), duo.getByTestId("duo-owner")].map(box));
      sideBySide(renter, vault);
      sideBySide(vault, owner);
    }).toPass();
    await expect(duo.getByText(/best on a laptop/i)).toBeHidden();
    await noSidewaysScroll(page);
    // The real /r flow in the scaled phone: a tap picks the Honda; the owner pane and the address follow.
    const phone = duo.frameLocator("[data-testid='duo-phone-frame']");
    await expect(phone.getByTestId("judge-flow")).toHaveAttribute("data-step", "choose", { timeout: 45_000 });
    await phone.getByTestId(`judge-pick-${HONDA}`).tap();
    // The phone leaves its chooser (for the wallet step, or a mirror of a rental another spec left on the Honda).
    await expect(phone.getByTestId("judge-flow")).not.toHaveAttribute("data-step", "choose");
    await expect(duo.getByTestId("duo-owner-screen")).toContainText("Honda Click 125i");
    await expect(page).toHaveURL(new RegExp(`/duo/${HONDA}$`));
    await page.screenshot({ path: path.join(SHOTS, `duo-${at}.png`) });

    await page.goto(`/stage/${SLUG}`);
    const stage = page.frameLocator("[data-testid='fit-frame'] iframe");
    await expect(stage.getByTestId("stage-view")).toBeVisible();
    // The big screen's two columns: the item and its QR on the left, the story on the right.
    await expect(async () => sideBySide(await box(stage.getByTestId("stage-title")), await box(stage.getByTestId("stage-headline")))).toPass();
    await expect(stage.getByTestId("stage-qr")).toBeInViewport();
    await expect(stage.getByTestId("stage-open-here")).toBeHidden();
    await noSidewaysScroll(page);
    await page.screenshot({ path: path.join(SHOTS, `stage-${at}.png`) });
    await page.context().close();
  });

  test(`fold ${at}: the landing page and the app pages have the desktop layout, touch-sized`, async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await fold(browser, vp);
    for (const url of PAGES) {
      await page.goto(url);
      if (url === "/demo") await expect(page.getByTestId("demo-play")).toBeEnabled();
      await page.waitForLoadState("networkidle");
      const name = url === "/" ? "landing" : url.slice(1).replace(/\?.*/, "");
      if (url === "/") {
        const nav = page.getByRole("navigation", { name: "Site" });
        await expect(nav.locator("ul").getByRole("link")).toHaveCount(5);
        for (const link of await nav.locator("ul").getByRole("link").all()) await expect(link).toBeVisible();
        await expect(page.locator(".mk-search-fields")).toBeVisible();
        await expect(page.locator(".mk-search-pill")).toBeHidden();
        expect(await page.locator(".mk-art img").evaluate((img: HTMLImageElement) => img.currentSrc)).toContain("street-wide");
        // The money board lies across: renter, escrow and owner on one row.
        const stations = page.locator(".mk-board .mk-station");
        sideBySide(await box(stations.first()), await box(stations.nth(1)));
      } else {
        await expect(page.getByTestId("sidebar")).toBeVisible();
        await expect(page.getByTestId("mobile-nav")).toBeHidden();
      }
      // The recipe card keeps its grid (the list is for phones only).
      if (url === "/sponsors" || url === "/media") {
        await expect(page.getByTestId("recipe-grid")).toBeVisible();
        await expect(page.getByTestId("recipe-list")).toBeHidden();
      }
      if (url === "/tenant") {
        const cards = page.getByTestId("book-card");
        await expect(cards.first()).toBeVisible();
        // The desktop's three columns.
        sideBySide(await box(cards.nth(0)), await box(cards.nth(1)));
        sideBySide(await box(cards.nth(1)), await box(cards.nth(2)));
      }
      const findings = await audit(page, 40);
      if (RECORD) for (const f of findings) test.info().annotations.push({ type: `${name} ${at}`, description: f });
      else expect(findings, `${name} at ${at}`).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `${name}-${at}.png`), fullPage: true });
    }
    await page.context().close();
  });
}
