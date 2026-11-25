import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * /how-it-works: the animated "explain it like I'm 5" story. No wallet, no chain: pure front-end.
 * ?speed= runs the story clock faster (test only); ?scene=&t=&autoplay=0 freeze an exact frame.
 *
 * Screenshots go to ELI5_SHOTS (default test-results/screenshots/eli5). ELI5_VIDEO=1 also records the happy
 * ending at normal speed as a webm in the same folder.
 */

const SHOTS = process.env.ELI5_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/eli5");
const VIEWPORTS = [
  { width: 1470, height: 830 },
  { width: 1440, height: 800 },
  { width: 1280, height: 720 },
];
const OPENING = ["problem", "agree", "fund", "rent", "moveout", "inspect"];
const ENDINGS = ["happy", "disagree", "silent"] as const;

const root = (page: Page) => page.getByTestId("eli5");

/** Record every scene shown and the worst page overflow from now on. */
async function watch(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __eli5: { scenes: string[]; y: number; x: number } };
    w.__eli5 = { scenes: [], y: 0, x: 0 };
    const check = () => {
      const el = document.querySelector('[data-testid="eli5"]');
      const id = el?.getAttribute("data-scene") ?? "";
      if (id && w.__eli5.scenes.at(-1) !== id) w.__eli5.scenes.push(id);
      const s = document.scrollingElement!;
      w.__eli5.y = Math.max(w.__eli5.y, s.scrollHeight - window.innerHeight);
      w.__eli5.x = Math.max(w.__eli5.x, s.scrollWidth - window.innerWidth);
    };
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    check();
  });
}
const watched = (page: Page) => page.evaluate(() => (window as unknown as { __eli5: { scenes: string[]; y: number; x: number } }).__eli5);

function consoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

for (const vp of VIEWPORTS) {
  test(`autoplay reaches the recap for every ending, one screen at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    const errors = consoleErrors(page);
    for (const ending of ENDINGS) {
      const started = Date.now();
      await page.goto(`/how-it-works?ending=${ending}&speed=25&autoplay=0`);
      await expect(root(page)).toHaveAttribute("data-ending", ending);
      await expect(root(page)).toHaveAttribute("data-playing", "false");
      await watch(page);
      await page.getByTestId("eli5-play").click();
      await expect(root(page)).toHaveAttribute("data-done", "true", { timeout: 20_000 });
      await expect(root(page)).toHaveAttribute("data-scene", "recap");
      await expect(root(page)).toHaveAttribute("data-playing", "false");
      await expect(page.getByTestId("eli5-recap")).toBeVisible();
      await expect(page.getByTestId("eli5-replay")).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId("eli5-narration")).toBeInViewport({ ratio: 1 });
      const seen = await watched(page);
      expect(seen.scenes, `scenes for ${ending}`).toEqual([...OPENING, ending, "recap"]);
      expect({ y: seen.y, x: seen.x }, `page overflow during ${ending}`).toEqual({ y: 0, x: 0 });
      console.log(`[eli5] ${vp.width}x${vp.height} ${ending}: recap after ${Date.now() - started} ms at 25x`);
    }
    expect(errors).toEqual([]);
  });
}

test("controls: space pauses and plays, back / next / dots, the ending picker jumps to the ending", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 830 });
  await page.goto("/how-it-works");
  await expect(root(page)).toHaveAttribute("data-playing", "true");
  await expect(root(page)).toHaveAttribute("data-scene", "problem");

  await page.keyboard.press("Space");
  await expect(root(page)).toHaveAttribute("data-playing", "false");
  const frozen = await page.getByTestId("eli5-stage").innerHTML();
  await page.waitForTimeout(600);
  expect(await page.getByTestId("eli5-stage").innerHTML(), "paused stage does not move").toBe(frozen);

  await page.getByTestId("eli5-next").click();
  await expect(root(page)).toHaveAttribute("data-scene", "agree");
  await page.keyboard.press("ArrowRight");
  await expect(root(page)).toHaveAttribute("data-scene", "fund");
  // Space while a button has focus toggles play once, and does not also click the button.
  await page.keyboard.press("Space");
  await expect(root(page)).toHaveAttribute("data-playing", "true");
  await expect(root(page)).toHaveAttribute("data-scene", "fund");
  await page.getByTestId("eli5-play").click();
  await expect(root(page)).toHaveAttribute("data-playing", "false");
  await page.getByTestId("eli5-back").click();
  await expect(root(page)).toHaveAttribute("data-scene", "agree");

  await page.getByTestId("eli5-dot").nth(6).click();
  await expect(root(page)).toHaveAttribute("data-scene", "happy");
  await page.getByTestId("eli5-ending-silent").click();
  await expect(root(page)).toHaveAttribute("data-scene", "silent");
  await expect(root(page)).toHaveAttribute("data-playing", "true");
  await expect(page.getByTestId("eli5-sleep")).toBeVisible();

  // Before the branch, the picker only changes which ending comes.
  await page.getByTestId("eli5-dot").first().click();
  await page.getByTestId("eli5-ending-disagree").click();
  await expect(root(page)).toHaveAttribute("data-scene", "problem");
  await expect(root(page)).toHaveAttribute("data-ending", "disagree");
  await expect(page.getByTestId("eli5-ending-disagree")).toHaveAttribute("aria-checked", "true");
});

test("reduced motion: coins fade in place instead of flying, and the story still plays to the end", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 830 });
  const coinXs = () =>
    page.getByTestId("eli5-coin").evaluateAll((els) => els.map((e) => Number(/translate\(([-\d.]+)/.exec(e.getAttribute("transform") ?? "")?.[1])));

  // Mid-flight in "the tenant fills the safe": tenant at x 995, safe at x 600.
  await page.goto("/how-it-works?scene=3&t=1300&autoplay=0");
  await expect(root(page)).toHaveAttribute("data-motion", "full");
  const flying = await coinXs();
  expect(flying.length).toBeGreaterThan(0);
  expect(flying.some((x) => x !== 995 && x !== 600)).toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(root(page)).toHaveAttribute("data-motion", "reduced");
  const fading = await coinXs();
  expect(fading.length).toBeGreaterThan(0);
  for (const x of fading) expect([995, 600]).toContain(x);

  await page.goto("/how-it-works?ending=disagree&speed=25");
  await expect(root(page)).toHaveAttribute("data-done", "true", { timeout: 20_000 });
  await expect(page.getByTestId("eli5-recap")).toBeVisible();
});

test("it is linked from the home page, the footer and /demo", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 830 });
  await page.goto("/");
  await expect(page.getByTestId("footer-eli5")).toHaveAttribute("href", "/how-it-works");
  await page.getByTestId("home-eli5").click();
  await expect(root(page)).toBeVisible();
  await page.goto("/demo"); // the link shows from 1400 px wide; below that the sidebar's "How it works" covers it
  await expect(page.getByTestId("demo-eli5")).toBeVisible();
  await expect(page.getByTestId("demo-eli5")).toHaveAttribute("href", "/how-it-works");
});

test("phone: stacks and scrolls, nothing sticks out sideways, amounts readable below the cartoon", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/how-it-works?scene=7&t=8000&autoplay=0&ending=happy");
  await expect(page.getByTestId("eli5-balances")).toBeVisible();
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(SHOTS, "390x844-mobile-happy.png"), fullPage: true });
});

test.describe("screenshots", () => {
  test.use({ viewport: { width: 1470, height: 830 } });

  test("key scenes in light and dark at 1470x830", async ({ page }) => {
    const frames = [
      { name: "1-problem", q: "scene=1&t=5200" },
      { name: "2-two-locks", q: "scene=2&t=7600" },
      { name: "3-fund", q: "scene=3&t=2000" },
      { name: "4-rent-and-fee", q: "scene=4&t=3100" },
      { name: "5-robot-inspector", q: "scene=6&t=6500" },
      { name: "6a-happy", q: "scene=7&t=4700&ending=happy" },
      { name: "6b-disagree", q: "scene=7&t=6000&ending=disagree" },
      { name: "6c-silent", q: "scene=7&t=4200&ending=silent" },
      { name: "7-recap", q: "scene=8&t=8000&ending=happy" },
    ];
    for (const theme of ["light", "dark"] as const) {
      await page.goto("/");
      await page.evaluate((t) => localStorage.setItem("keyescrow-theme", t), theme);
      for (const f of frames) {
        await page.goto(`/how-it-works?autoplay=0&${f.q}`);
        await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
        await expect(root(page)).toHaveAttribute("data-playing", "false");
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400); // narration pop-in
        await page.screenshot({ path: path.join(SHOTS, `${f.name}-${theme}.png`) });
      }
    }
  });
});

test("recording: the happy ending at normal speed (ELI5_VIDEO=1)", async ({ browser }) => {
  test.skip(process.env.ELI5_VIDEO !== "1", "set ELI5_VIDEO=1 to record");
  test.setTimeout(180_000);
  const size = { width: 1470, height: 830 };
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({ baseURL, viewport: size, recordVideo: { dir: path.join(SHOTS, "video"), size } });
  const page = await context.newPage();
  await page.goto("/how-it-works");
  const started = Date.now();
  await expect(root(page)).toHaveAttribute("data-done", "true", { timeout: 120_000 });
  console.log(`[eli5] happy ending at normal speed: ${Date.now() - started} ms`);
  await page.waitForTimeout(1500);
  const video = page.video();
  await context.close();
  await video?.saveAs(path.join(SHOTS, "eli5-happy.webm"));
});
