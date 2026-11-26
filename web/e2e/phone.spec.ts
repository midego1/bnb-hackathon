import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { E2E_WEB_PORT } from "./env";

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

type Finding = string;

/** Everything wrong with what is on screen now (see the file comment). Runs in the page. */
async function audit(page: Page): Promise<Finding[]> {
  const found = await page.evaluate(() => {
    const out: string[] = [];
    const name = (el: Element) => {
      const t = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ");
      return `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `#${el.getAttribute("data-testid")}` : ""} "${t.slice(0, 40)}"`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      // Visually hidden (sr-only, the camera inputs behind their labels) is not on screen.
      if (r.width <= 1 || r.height <= 1 || el.closest(".sr-only")) return false;
      return s.visibility !== "hidden" && s.display !== "none" && !el.closest("[inert],[aria-hidden='true'],[data-phone-audit='skip']");
    };
    const sw = document.scrollingElement!.scrollWidth - window.innerWidth;
    if (sw > 0) out.push(`sideways scroll ${sw}px`);

    const targets = [...document.querySelectorAll("a[href], button, [role='button'], input:not([type='hidden']), select, textarea, summary")].filter(visible);
    for (const el of targets) {
      // A link inside a sentence is exempt (WCAG 2.5.8): an inline element whose parent holds other text too.
      if (el.tagName === "A" && getComputedStyle(el).display === "inline") {
        const parent = el.parentElement;
        if (parent && (parent.innerText || "").trim().length > (el as HTMLElement).innerText.trim().length + 2) continue;
      }
      const r = el.getBoundingClientRect();
      const hit = el.hasAttribute("data-hit") ? 24 : 0; // the ::after hit area reaches 12 px out on each side
      const s = getComputedStyle(el);
      const textLink = el.tagName === "A" && s.backgroundColor === "rgba(0, 0, 0, 0)" && parseFloat(s.borderTopWidth) === 0;
      const [minW, minH] = textLink ? [0, 24] : [44, 44];
      if (r.height + hit < minH - 0.5 || r.width + hit < minW - 0.5) out.push(`tap target ${Math.round(r.width)}x${Math.round(r.height)}: ${name(el)}`);
    }

    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el) || el.children.length > 0) continue;
      const h = el as HTMLElement;
      const text = h.innerText?.trim();
      if (!text || /^(0x[0-9a-fA-F…\.]+|[0-9a-f]{8,}…?)$/.test(text)) continue;
      const s = getComputedStyle(h);
      const clipped = (s.textOverflow === "ellipsis" || s.overflow === "hidden" || s.overflowX === "hidden") && h.scrollWidth > h.clientWidth + 1;
      if (clipped && !h.closest("[data-phone-audit='skip']")) out.push(`text cut off: ${name(h)}`);
    }
    return out;
  });
  const bubble = page.getByTestId("assistant-bubble");
  if ((await bubble.count()) && (await bubble.isVisible())) {
    for (const where of ["top", "bottom"] as const) {
      await page.evaluate((w) => window.scrollTo(0, w === "top" ? 0 : document.scrollingElement!.scrollHeight), where);
      await page.waitForTimeout(400); // the bubble tucks away with a short slide
      const hits = await page.evaluate(() => {
        const b = document.querySelector("[data-testid='assistant-bubble']")!.getBoundingClientRect();
        return [...document.querySelectorAll("a[href], button, input, textarea, select")]
          .filter((el) => {
            if (el.closest("[data-testid='assistant-bubble'], [data-testid='assistant-panel'], [data-phone-audit='skip']")) return false;
            const r = el.getBoundingClientRect();
            if (r.width <= 1 || r.height <= 1) return false;
            // The bubble is round: the nearest point of the control must be inside its circle.
            const [cx, cy, rad] = [(b.left + b.right) / 2, (b.top + b.bottom) / 2, b.width / 2];
            const dx = Math.max(r.left - cx, 0, cx - r.right);
            const dy = Math.max(r.top - cy, 0, cy - r.bottom);
            return dx * dx + dy * dy < rad * rad;
          })
          .map((el) => `${el.tagName.toLowerCase()} "${((el as HTMLElement).innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"`);
      });
      found.push(...hits.map((h) => `Ask AI bubble covers ${h} (${where})`));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
  }
  return found;
}

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
          expect((await bar.getByRole("link").first().locator("svg").boundingBox())!.width).toBeGreaterThanOrEqual(23);
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
    stage.once("dialog", (d) => d.accept());
    await stage.getByTestId("stage-reset").click();
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
