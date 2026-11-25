import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * /pitch: the animated storyboard of our 3-minute live pitch. Pure front-end, unlisted.
 * ?speed= runs the clock faster (test only); ?scene=&t=&autoplay=0 freeze an exact frame.
 * Screenshots go to PITCH_SHOTS (default test-results/screenshots/pitch).
 */

const SHOTS = process.env.PITCH_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/pitch");
const IDS = ["problem", "oneliner", "qr", "wallet", "rent", "pickup", "return", "inspect", "settle", "native", "business", "end"];
const root = (page: Page) => page.getByTestId("pitch");

test("plays to the end at test speed, on one screen at 1470x830, with no page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 830 });
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/pitch?speed=60&autoplay=0");
  await expect(root(page)).toHaveAttribute("data-playing", "false");
  await page.evaluate(() => {
    const w = window as unknown as { __pitch: { scenes: string[]; y: number; x: number } };
    w.__pitch = { scenes: [], y: 0, x: 0 };
    const check = () => {
      const id = document.querySelector('[data-testid="pitch"]')?.getAttribute("data-scene") ?? "";
      if (id && w.__pitch.scenes.at(-1) !== id) w.__pitch.scenes.push(id);
      const s = document.scrollingElement!;
      w.__pitch.y = Math.max(w.__pitch.y, s.scrollHeight - window.innerHeight);
      w.__pitch.x = Math.max(w.__pitch.x, s.scrollWidth - window.innerWidth);
    };
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    check();
  });
  await page.getByTestId("pitch-play").click();
  await expect(root(page)).toHaveAttribute("data-done", "true", { timeout: 30_000 });
  await expect(root(page)).toHaveAttribute("data-scene", "end");
  await expect(page.getByTestId("pitch-clock")).toHaveText("3:00 / 3:00");
  for (const id of ["pitch-play", "pitch-narration", "pitch-timer", "pitch-cartoon"]) await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  const seen = await page.evaluate(() => (window as unknown as { __pitch: { scenes: string[]; y: number; x: number } }).__pitch);
  expect(seen.scenes).toEqual(IDS);
  expect({ y: seen.y, x: seen.x }, "page overflow").toEqual({ y: 0, x: 0 });
  expect(errors).toEqual([]);
});

test("controls: space, back / next, dots; the key props show in their scenes", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 830 });
  await page.goto("/pitch");
  await expect(root(page)).toHaveAttribute("data-playing", "true");
  await page.keyboard.press("Space");
  await expect(root(page)).toHaveAttribute("data-playing", "false");
  await page.keyboard.press("ArrowRight");
  await expect(root(page)).toHaveAttribute("data-scene", "oneliner");
  await page.getByTestId("pitch-next").click();
  await expect(root(page)).toHaveAttribute("data-scene", "qr");
  await page.getByTestId("pitch-back").click();
  await expect(root(page)).toHaveAttribute("data-scene", "oneliner");
  await page.getByTestId("pitch-dot").nth(8).click();
  await expect(root(page)).toHaveAttribute("data-scene", "settle");
  await expect(page.getByTestId("pitch-note")).toContainText("2:05");

  await page.goto("/pitch?scene=3&t=7000&autoplay=0");
  await expect(page.getByTestId("pitch-qr")).toBeVisible();
  await expect(page.getByTestId("pitch-phone")).toBeVisible();
  await page.goto("/pitch?scene=5&t=9000&autoplay=0");
  await expect(page.getByTestId("pitch-bscscan")).toBeVisible();
  await page.goto("/pitch?scene=9&t=8000&autoplay=0");
  await expect(page.getByTestId("pitch-accept")).toHaveAttribute("data-accepted", "true");
  await expect(page.getByTestId("pitch-lock-0").locator("[data-open]")).toHaveAttribute("data-open", "true");
});

test("reduced motion: still plays to the end", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 830 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pitch?speed=60");
  await expect(root(page)).toHaveAttribute("data-motion", "reduced");
  await expect(root(page)).toHaveAttribute("data-done", "true", { timeout: 30_000 });
});

test("unlisted: not in the sidebar, not indexed", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 830 });
  await page.goto("/pitch?autoplay=0");
  await expect(page.locator('a[href="/pitch"]')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("screenshots: every scene in light and dark at 1470x830", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 830 });
  // A late frame of each scene, after its animations land.
  const frames = [6500, 8000, 9000, 6000, 9000, 9800, 9800, 8000, 8000, 6000, 6000, 3000];
  for (const theme of ["light", "dark"] as const) {
    await page.goto("/app");
    await page.evaluate((t) => localStorage.setItem("keyescrow-theme", t), theme);
    for (const [i, t] of frames.entries()) {
      await page.goto(`/pitch?autoplay=0&scene=${i + 1}&t=${t}`);
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
      await expect(root(page)).toHaveAttribute("data-scene", IDS[i]);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `${String(i + 1).padStart(2, "0")}-${IDS[i]}-${theme}.png`) });
    }
  }
});
