import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { restoreChainAfterEachTest } from "./chain";
import { E2E_WEB_PORT } from "./env";

/**
 * The language switch (lib/i18n): EN / 中文 / EN+中文, kept in the ke_lang cookie.
 * Screenshots go to I18N_SHOTS (default test-results/screenshots/i18n).
 */

restoreChainAfterEachTest();

const SHOTS = process.env.I18N_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/i18n");
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
const LAPTOP = { width: 1470, height: 830 };
/** The switch in the landing header (the footer has a second one). */
const lang = (page: Page, mode: "en" | "zh" | "both") => page.getByRole("banner").getByTestId(`lang-${mode}`);

/** Record the worst page overflow (both directions) from now on. */
async function watchOverflow(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __of: { x: number; y: number } };
    w.__of = { x: 0, y: 0 };
    const check = () => {
      const s = document.scrollingElement!;
      w.__of = { x: Math.max(w.__of.x, s.scrollWidth - window.innerWidth), y: Math.max(w.__of.y, s.scrollHeight - window.innerHeight) };
    };
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    check();
  });
}
const worst = (page: Page) => page.evaluate(() => (window as unknown as { __of: { x: number; y: number } }).__of);

test("switch to 中文 on the landing page: /, /how-it-works and /demo change and it survives a reload", async ({ page }) => {
  await page.goto("/");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveText(/Rent the motorbike\.\s*Keep your passport\./);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("ai-translated")).toHaveCount(0);

  await lang(page, "zh").click();
  await expect(h1).toContainText("护照留下");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(lang(page, "zh")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ai-translated")).toContainText("AI 翻译");
  await shot(page, "zh-landing");

  await page.reload();
  await expect(h1).toContainText("护照留下");
  await expect(page.getByRole("heading", { level: 2, name: "每个争议都有期限。" })).toBeVisible();
  await expect(page).toHaveTitle(/不用押护照/);

  await page.goto("/how-it-works?autoplay=0&scene=6");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("KeyScrow，简单讲给你听");
  await expect(page.getByTestId("eli5-narration")).toContainText("机器人对比照片");
  await expect(page.getByTestId("eli5-ending-happy")).toContainText("双方同意");
  await shot(page, "zh-how-it-works");

  await page.goto("/demo");
  await expect(page.getByTestId("demo-play")).toContainText("播放演示");
  await expect(page.getByTestId("demo-play")).toBeEnabled();
  await expect(page.getByTestId("demo-path-dispute")).toContainText("争议流程");
  await shot(page, "zh-demo");
  // The steps run in Chinese too: the first beat's title and narration.
  await page.getByTestId("demo-mode-step").click();
  await page.getByTestId("demo-play").click();
  await page.getByTestId("demo-beat-next").click();
  await expect(page.getByTestId("demo-narration").locator("h2")).toHaveText("车主发布租赁", { timeout: 60_000 });
  await expect(page.getByTestId("demo-now")).toContainText("托管合约");
  await shot(page, "zh-demo-step");

  // And back to English.
  await page.goto("/");
  await lang(page, "en").click();
  await expect(h1).toHaveText(/Rent the motorbike\.\s*Keep your passport\./);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("EN+中文 from ?bilingual=1: Chinese under the headlines only, the landing page never scrolls sideways", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await page.goto("/?bilingual=1");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1.locator(".i18n-zh")).toHaveText("摩托车租走，护照留下。");
  await expect(h1).toContainText("Keep your passport.");
  await expect(lang(page, "both")).toHaveAttribute("aria-pressed", "true");
  // Body text stays English.
  await expect(page.getByTestId("fee-pitch")).toContainText("Never taken from the deposit");
  await expect(page.getByTestId("fee-pitch").locator("h2 .i18n-zh")).toContainText("只收一次");
  const m = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.iw);
  await shot(page, "both-landing-1470x830");
  await shot(page, "both-landing-full", true);

  // An explicit choice wins over the parameter.
  await lang(page, "en").click();
  await expect(h1.locator(".i18n-zh")).toHaveCount(0);
  await expect(page).not.toHaveURL(/bilingual/);
});

test("EN+中文 on /how-it-works at 1470x830: every scene of every ending fits one screen", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(LAPTOP);
  await page.goto("/how-it-works?bilingual=1&autoplay=0&scene=6&t=6000");
  const narration = page.getByTestId("eli5-narration");
  await expect(narration.locator(".i18n-zh")).toContainText("机器人");
  await shot(page, "both-how-it-works-1470x830");
  for (const ending of ["happy", "disagree", "silent"]) {
    await page.goto(`/how-it-works?ending=${ending}&speed=50`);
    await watchOverflow(page);
    await expect(page.getByTestId("eli5")).toHaveAttribute("data-done", "true", { timeout: 60_000 });
    expect(await worst(page), `overflow in the ${ending} ending`).toEqual({ x: 0, y: 0 });
  }
});

test("EN+中文 on /demo at 1470x830: guided beats and the summary fit one screen", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(LAPTOP);
  await page.goto("/demo?bilingual=1&timescale=0.03");
  await expect(page.getByTestId("demo-play")).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await watchOverflow(page);
  await shot(page, "both-demo-start-1470x830");
  await page.getByTestId("demo-mode-step").click();
  await page.getByTestId("demo-play").click();
  const narration = page.getByTestId("demo-narration");
  await page.getByTestId("demo-beat-next").click();
  await expect(narration.locator("h2 .i18n-zh")).toHaveText("车主发布租赁", { timeout: 60_000 });
  await expect(narration.locator("h2")).toContainText("Owner offers the rental");
  await shot(page, "both-demo-step-1470x830");
  await page.getByTestId("demo-mode-auto").click();
  await page.getByTestId("demo-beat-next").click();
  const summary = page.getByTestId("demo-summary");
  await expect(summary).toBeVisible({ timeout: 240_000 });
  await expect(summary.locator("h2 .i18n-zh")).toBeVisible();
  await expect(page.getByTestId("demo-run-again")).toBeInViewport({ ratio: 1 });
  await shot(page, "both-demo-summary-1470x830");
  expect(await worst(page)).toEqual({ x: 0, y: 0 });
});

/** Phase 2: the app screens. Sets the mode with the sidebar switch, then visits /app, /tenant, a rental page, /demo and /pitch. */
test("the app in 中文 and EN+中文: sidebar switch, /app, /tenant, a rental page, /demo, /pitch", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(LAPTOP);
  await page.goto("/app");
  const sidebar = page.getByTestId("sidebar");
  const h1 = page.getByRole("heading", { level: 1 }).first();
  await expect(sidebar.getByTestId("view-tenant")).toHaveText("Renter");
  await expect(h1).not.toContainText(/\p{Script=Han}/u);

  for (const mode of ["zh", "both"] as const) {
    await page.goto("/app");
    await sidebar.getByTestId(`lang-${mode}`).click();
    await expect(sidebar.getByTestId(`lang-${mode}`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("lang", mode === "zh" ? "zh-CN" : "en");
    // 中文: the sidebar is Chinese. EN+中文: body text stays English, headlines get the Chinese line.
    await expect(sidebar.getByTestId("view-tenant")).toHaveText(mode === "zh" ? "租客" : "Renter");
    if (mode === "both") await expect(h1.locator(".i18n-zh")).toHaveText(/\p{Script=Han}/u);
    else await expect(h1).toHaveText(/\p{Script=Han}/u);
    await shot(page, `${mode}-app`);

    await page.goto("/tenant");
    await page.getByTestId("dev-role-tenant").click();
    const card = page.getByTestId("renter-rental").first();
    await expect(card).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(/\p{Script=Han}/u);
    await shot(page, `${mode}-tenant`);

    const href = await card.locator('a[href^="/lease/"]').first().getAttribute("href");
    await page.goto(href!);
    const banner = page.getByTestId("rental-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/\p{Script=Han}/u);
    await shot(page, `${mode}-rental`);

    await page.goto("/demo");
    await expect(page.getByTestId("demo-play")).toBeEnabled();
    await shot(page, `${mode}-demo`);

    await page.goto("/pitch?scene=6&t=6000&autoplay=0");
    await expect(page.getByTestId("pitch-narration")).toContainText(/\p{Script=Han}/u);
    await page.waitForTimeout(600); // the narration fades in
    await shot(page, `${mode}-pitch`);
  }
});

for (const mode of ["both", "zh"] as const) {
  test(`/pitch in ${mode === "zh" ? "中文" : "EN+中文"} at 1470x830: every scene fits one screen`, async ({ page, context }) => {
    await context.addCookies([{ name: "ke_lang", value: mode, url: `http://127.0.0.1:${E2E_WEB_PORT}` }]);
    await page.setViewportSize(LAPTOP);
    await page.goto(`/pitch?speed=60&autoplay=0`);
    await expect(page.getByTestId("pitch-narration")).toContainText(/\p{Script=Han}/u);
    await watchOverflow(page);
    await page.getByTestId("pitch-play").click();
    await expect(page.getByTestId("pitch")).toHaveAttribute("data-done", "true", { timeout: 30_000 });
    for (const id of ["pitch-play", "pitch-narration", "pitch-timer", "pitch-cartoon"]) await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
    expect(await worst(page)).toEqual({ x: 0, y: 0 });
  });
}

/** Phase 3: subscriptions, the listing page, the /stage big screen and the /r judge phone. */
for (const mode of ["zh", "both"] as const) {
  test(`new screens in ${mode === "zh" ? "中文" : "EN+中文"}: /app/subscriptions, /app/listings, /stage, /r`, async ({ page, context, browser }) => {
    const cookie = { name: "ke_lang", value: mode, url: `http://127.0.0.1:${E2E_WEB_PORT}` };
    await context.addCookies([cookie]);
    await page.setViewportSize(LAPTOP);
    const han = /\p{Script=Han}/u;
    // EN+中文 puts the Chinese line in .i18n-zh under the English; 中文 replaces it.
    const headline = (l: ReturnType<Page["locator"]>) => (mode === "both" ? l.locator(".i18n-zh").first() : l);

    await page.goto("/app/subscriptions");
    await expect(headline(page.getByRole("heading", { level: 1 }).first())).toHaveText(han);
    await shot(page, `${mode}-subscriptions`);

    await page.goto("/app/listings/mystery-box");
    await expect(page.getByTestId("listing-rent")).toBeVisible();
    await shot(page, `${mode}-listing`);

    await page.goto("/stage/mystery-box");
    await expect(headline(page.getByTestId("stage-headline"))).toHaveText(han);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await shot(page, `${mode}-stage`);

    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await phoneCtx.addCookies([cookie]);
    const phone = await phoneCtx.newPage();
    await phone.goto("/r/mystery-box");
    // Step 0, the chooser: its title, a card's "/ 天 · 押金" line, then the picked item's first step.
    await expect(headline(phone.getByTestId("judge-flow").getByRole("heading", { level: 1 }))).toHaveText(han);
    if (mode === "zh") await expect(phone.getByTestId("judge-pick-honda-click-125i")).toContainText("天"); // body text: English in EN+中文
    expect(await phone.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await phone.screenshot({ path: path.join(SHOTS, `${mode}-judge-choose.png`), fullPage: true });
    await phone.getByTestId("judge-pick-mystery-box").click();
    await expect(headline(phone.getByTestId("judge-flow").getByRole("heading", { level: 2 }).first())).toHaveText(han);
    expect(await phone.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await phone.screenshot({ path: path.join(SHOTS, `${mode}-judge-phone.png`), fullPage: true });
    await phoneCtx.close();
  });
}
