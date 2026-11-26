import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_WEB_PORT } from "./env";
import { audit } from "./phoneAudit";

/** /media: every file of the media kit downloads (scripts/media.mjs builds them before `next build`). */
const SHOTS = process.env.MEDIA_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/media");

/** Lazy images load only on scroll: load them all before a full-page screenshot. */
const loadImages = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    for (const img of document.images) img.loading = "eager";
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  });
const hrefs = (page: Page, testId: string) => page.getByTestId(testId).evaluateAll((els) => els.map((e) => e.getAttribute("href")!));

test("landing footer → /media: the zip and every download respond 200", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Media kit and downloads" }).click();
  await page.waitForURL(/\/media$/);
  await expect(page.getByRole("heading", { level: 1, name: "Media kit" })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/media$/);
  await expect(page.getByTestId("media-zip")).toHaveText(/^Download everything \(\.zip, \d+\.\d MB\)$/);
  await expect(page.getByTestId("media-video")).toHaveCount(4);
  await expect(page.getByTestId("media-contract").first()).toHaveAttribute("href", /^https:\/\/testnet\.bscscan\.com\/address\/0x/);

  const zip = await page.request.head((await page.getByTestId("media-zip").getAttribute("href"))!);
  expect(zip.status()).toBe(200);
  expect(Number(zip.headers()["content-length"])).toBeLessThan(25 * 1024 * 1024);
  const files = [...new Set(await hrefs(page, "media-download"))];
  expect(files.length).toBeGreaterThan(50);
  for (const href of files) expect((await page.request.head(href)).status(), href).toBe(200);

  await loadImages(page);
  await page.screenshot({ path: path.join(SHOTS, "media-light-1440.png"), fullPage: true });
  expect(problems).toEqual([]);
});

test("/sponsors links to /media; dark and 中文", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("keyescrow-theme", "dark"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sponsors");
  await page.getByTestId("sponsors-media").click();
  await page.waitForURL(/\/media$/);
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  await expect(page.getByTestId("footer-media")).toHaveAttribute("href", "/media");
  await loadImages(page);
  await page.screenshot({ path: path.join(SHOTS, "media-dark-1440.png"), fullPage: true });
  await page.context().addCookies([{ name: "ke_lang", value: "zh", url: `http://127.0.0.1:${E2E_WEB_PORT}` }]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "媒体资料" })).toBeVisible();
  await expect(page.getByTestId("media-zip")).toContainText("下载全部");
  await page.screenshot({ path: path.join(SHOTS, "media-zh-1440.png") });
  // EN+中文: English body, the Chinese line under each headline.
  await page.context().addCookies([{ name: "ke_lang", value: "both", url: `http://127.0.0.1:${E2E_WEB_PORT}` }]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 }).locator(".i18n-zh")).toHaveText("媒体资料");
  await expect(page.locator("#videos-title .i18n-zh")).toHaveText("视频");
  await expect(page.getByTestId("media-zip")).toContainText("Download everything");
});

test("/media on a phone: no sideways scroll, tap targets and text pass the phone audit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/media");
  await expect(page.getByTestId("media-zip")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await audit(page)).toEqual([]);
  await loadImages(page);
  await page.screenshot({ path: path.join(SHOTS, "media-phone-390.png"), fullPage: true });
});
