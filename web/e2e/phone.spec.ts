import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { E2E_WEB_PORT } from "./env";
import { audit } from "./phoneAudit";

/**
 * Phones (judges scan the QR on the big screen): 390x844 and 360x780, light + dark, EN and EN+中文, on the landing page,
 * /app, /tenant, a rental page, /demo and every step of the judge flow (/r/mystery-box). Each page is audited:
 * - no sideways scroll;
 * - tap targets: controls (buttons, inputs, button-like links) at least 44 x 44 px; a plain text link that stands
 *   alone at least 24 px tall (WCAG 2.5.8); a link inside a sentence is exempt; `data-hit` icon buttons count their
 *   44 px hit area; the local-only demo accounts strip (`data-phone-audit="skip"`) is not audited;
 * - no text cut off with an ellipsis or clipped (overflow hidden) unless it is an address or a hash;
 * - the Ask AI bubble (48 px on phones) never sits on a button, a link or a field, at the top of the page or scrolled
 *   to the bottom (the page column keeps room for it at its end).
 * PHONE_AUDIT=record only lists the findings (test annotations) instead of failing. Screenshots: PHONE_SHOTS
 * (default test-results/screenshots/phone).
 */

const SHOTS = process.env.PHONE_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/phone");
mkdirSync(SHOTS, { recursive: true });
const RECORD = process.env.PHONE_AUDIT === "record";
const PHONES = [
  { width: 390, height: 844 },
  { width: 360, height: 780 },
];
const SEEDED_LEASE = "0x9f1ac54BEF0DD2f6f3462EA0fa94fC62300d3a8e";
const SLUG = "mystery-box";

async function check(page: Page, label: string) {
  const findings = await audit(page);
  await page.screenshot({ path: path.join(SHOTS, `${label}.png`), fullPage: true });
  if (RECORD) {
    for (const f of findings) test.info().annotations.push({ type: label, description: f });
    return;
  }
  expect(findings, label).toEqual([]);
}

async function setMode(page: Page, mode: "en" | "both", theme: "light" | "dark") {
  await page.context().addCookies([{ name: "ke_lang", value: mode, url: `http://127.0.0.1:${E2E_WEB_PORT}` }]);
  await page.addInitScript((t) => localStorage.setItem("keyescrow-theme", t), theme);
}

const PAGES = [
  ["landing", "/"],
  ["app", "/app"],
  ["tenant", "/tenant"],
  ["rental", `/lease/${SEEDED_LEASE}`],
  ["demo", "/demo"],
  ["eli5", "/how-it-works?autoplay=0"],
  ["pitch", "/pitch?autoplay=0"],
  ["subscriptions", "/app/subscriptions"],
] as const;

for (const vp of PHONES) {
  for (const [mode, theme] of [
    ["en", "light"],
    ["both", "dark"],
  ] as const) {
    test(`phone ${vp.width}x${vp.height} ${mode === "en" ? "EN" : "EN+中文"} ${theme}: landing, /app, /tenant, a rental, /demo, /how-it-works, /pitch, /app/subscriptions`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(vp);
      await setMode(page, mode, theme);
      for (const [name, url] of PAGES) {
        await page.goto(url);
        if (name === "tenant") await page.getByTestId("dev-role-tenant").click();
        if (name === "rental") await expect(page.getByTestId("rental-banner")).toBeVisible();
        if (name === "demo") await expect(page.getByTestId("demo-play")).toBeEnabled();
        if (name === "tenant") await expect(page.getByTestId("renter-rental").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        if (name !== "landing") {
          // The bubble: 48 px and in reach; the top bar is not squeezed (the logo mark keeps its size).
          const bubble = (await page.getByTestId("assistant-bubble").boundingBox())!;
          expect(Math.round(bubble.width)).toBe(48);
          expect(bubble.y + bubble.height).toBeLessThanOrEqual(vp.height);
          const bar = page.getByTestId("mobile-nav");
          expect((await bar.getByRole("link").first().locator("img").boundingBox())!.width).toBeGreaterThanOrEqual(23);
          expect(await bar.evaluate((n) => n.scrollWidth - n.clientWidth)).toBeLessThanOrEqual(0);
        }
        await check(page, `${vp.width}-${mode}-${theme}-${name}`);
      }
    });
  }
}

async function phone(browser: Browser, vp: { width: number; height: number }, mode: "en" | "both") {
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "ke_lang", value: mode, url: `http://127.0.0.1:${E2E_WEB_PORT}` }]);
  return ctx.newPage();
}

const step = (p: Page, name: string) => expect(p.getByTestId("judge-flow")).toHaveAttribute("data-step", name, { timeout: 45_000 });

/** A small noisy 24-bit BMP for the camera inputs; a different seed per photo (the same bytes would be the same hash). */
function photo(seed: number, w = 160, h = 120) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + row * h);
  buf.write("BM", 0);
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * h, 34);
  let x = seed;
  for (let i = 54; i < buf.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = x >> 16;
  }
  return { name: `photo-${seed}.bmp`, mimeType: "image/bmp", buffer: buf };
}

for (const [vp, mode] of [
  [PHONES[0], "en"],
  [PHONES[1], "both"],
] as const) {
  test(`judge flow on a phone ${vp.width}x${vp.height} ${mode === "en" ? "EN" : "EN+中文"}: every step`, async ({ page: stage, browser }) => {
    test.setTimeout(240_000);
    await stage.goto(`/stage/${SLUG}`);
    await stage.getByTestId("stage-reset").click();
    await stage.getByTestId("confirm-ok").click(); // in-page dialog, not window.confirm
    await expect(stage.getByTestId("stage-view")).toHaveAttribute("data-status", "none");

    const p = await phone(browser, vp, mode);
    const label = (s: string) => `${vp.width}-${mode}-judge-${s}`;
    await p.goto(`/r/${SLUG}`);
    await step(p, "wallet");
    await check(p, label("1-wallet"));
    await p.getByTestId("judge-guest").click();
    await step(p, "money");
    await check(p, label("2-money"));
    await p.getByTestId("judge-drip").click();
    await step(p, "rent");
    await check(p, label("3-rent"));
    await p.getByTestId("judge-rent").click();
    await step(p, "pickup");
    await check(p, label("4-pickup"));
    await p.getByTestId("judge-camera-pickup").setInputFiles(photo(vp.width + 1));
    await check(p, label("4b-pickup-photo"));
    await p.getByTestId("judge-save-pickup").click();
    await step(p, "return");
    await check(p, label("5-return"));
    await p.getByTestId("judge-camera-return").setInputFiles(photo(vp.width + 2));
    await p.getByTestId("judge-save-return").click();
    await step(p, "inspect");
    await check(p, label("6-inspect"));
    await p.getByTestId("judge-inspect").click();
    await expect(p.getByTestId("judge-split")).toBeVisible();
    await check(p, label("7-split"));
    await p.getByTestId("judge-propose").click();
    await step(p, "waiting");
    await check(p, label("8-waiting"));
    await stage.getByTestId("stage-accept").click();
    await step(p, "settled");
    await check(p, label("9-settled"));
    await p.context().close();
  });
}
