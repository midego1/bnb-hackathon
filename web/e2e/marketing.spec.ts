import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_WEB_PORT } from "./env";

/**
 * The marketing page at /: a server-rendered page without the app shell or a wallet. Its search filters the demo
 * listings below it and a card opens its listing page; it tells the story in order, its three calls to action lead
 * into the product, the money board works by mouse, keyboard and on its own, nothing logs an error, a phone never
 * scrolls sideways, and it reads in 中文 and EN+中文.
 *
 * Screenshots (1470x830 and 390x844, light and dark, EN and 中文, first screen and full page) go to MARKETING_SHOTS
 * (default test-results/screenshots/marketing).
 */

const SHOTS = process.env.MARKETING_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/marketing");
const DESKTOP = { width: 1470, height: 830 };
const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 360, height: 740 };
const CTAS = ["mk-cta-demo", "mk-cta-box", "mk-cta-app"];
const cityOf = (cards: ReturnType<Page["getByTestId"]>) => cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-city")));

/** Console errors, page errors and failed requests seen while the page is open. */
function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  // A navigation aborts the link prefetches still in flight: that is not a failure.
  page.on("requestfailed", (r) => r.failure()?.errorText !== "net::ERR_ABORTED" && problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`));
  return problems;
}

const sideways = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
const language = (page: Page, mode: "en" | "zh" | "both") => page.context().addCookies([{ name: "ke_lang", value: mode, url: `http://127.0.0.1:${E2E_WEB_PORT}` }]);

/** Scroll through the page so every lazy image has loaded, then return to the top (instantly: the page scrolls smoothly). */
async function loadAll(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  // Only pictures that are on show: the closing street is hidden on phones and so (being lazy) never downloaded there.
  await expect.poll(() => page.evaluate(() => [...document.images].filter((i) => i.getClientRects().length).every((i) => i.complete && i.naturalWidth > 0))).toBe(true);
}

test("landing page tells the whole story in order, without the app shell, a wallet or console errors", async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page).toHaveTitle(/KeyEscrow.*passport/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Rent the scooter\.\s*Keep your passport\./);
  await expect(page.getByRole("main")).toContainText("instead of your passport");
  await expect(page.getByRole("main")).toContainText("nobody can move it alone");
  await expect(page.getByTestId("mk-testnet")).toContainText("Demo listings on BSC testnet: test money only");
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await expect(page.getByTestId("wallet")).toHaveCount(0);
  await expect(page.getByTestId("assistant-bubble")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+j"); // Ask AI's shortcut belongs to the app shell only
  await expect(page.getByTestId("assistant-panel")).toHaveCount(0);

  // Find a scooter; why the deposit is safe (comparison, money board, who decides, deadlines); list your own; proof;
  // for agents, the fee, the roadmap, the ask.
  const story = [
    /Pick a scooter\. The deposit goes into escrow\./,
    /nobody holding your passport/i,
    /How your deposit is protected, in four steps/,
    /The AI proposes\. People decide\./,
    /Every dispute has a deadline/,
    /List your scooter\./,
    /Live on BSC testnet/,
    /Built for agents/,
    /10% of one month's rent\. Once\./,
    /Where this goes next/,
    /See a deposit come back/,
  ];
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings).toHaveLength(story.length);
  story.forEach((name, i) => expect(headings[i], `section ${i + 1}`).toMatch(name));

  // The listings under the hero: six demo scooters and the Mystery Box, labelled as a demo, rating-free.
  const cards = page.getByTestId("mk-listing");
  await expect(cards).toHaveCount(7);
  await expect(page.getByTestId("mk-listing-summary")).toHaveText("7 demo listings.");
  await expect(page.getByTestId("mk-listing-demo")).toContainText("Demo listings on BSC testnet");
  await expect(page.getByTestId("mk-listing-demo")).toContainText("the deposit and the first month's rent into its own escrow, with test money");
  await expect(page.getByTestId("mk-listing-demo")).toContainText("not real shops' offers");
  const click = page.locator('[data-testid="mk-listing"][data-slug="honda-click-125i"]');
  await expect(click).toHaveAttribute("href", "/app/listings/honda-click-125i");
  await expect(click).toContainText("Honda Click 125i");
  await expect(click).toContainText("Nimman, Chiang Mai");
  await expect(click.getByTestId("mk-listing-price")).toHaveText("฿250 per day");
  await expect(click).toContainText("฿3,400 per month");
  await expect(click).toContainText("Deposit ฿6,800");
  await expect(click).toContainText("Demo listing");
  for (const text of await cards.allTextContents()) expect(text).toContain("Deposit protected by escrow");
  await expect(page.locator('[data-testid="mk-listing"][data-slug="mystery-box"]')).toContainText("Live stage demo");
  await expect(page.locator("#listings")).not.toContainText(/review|rating|★/i);

  // Proof: four claims at the top of the proof section, each a link to where it can be checked.
  const proof = page.locator("#live").getByTestId("mk-proof");
  await expect(proof).toHaveText([/Live on BSC testnet/, /Contract v2/, /305 contract tests/, /ERC-8004 agent #2921/]);
  const [live, factory, tests, agent] = await proof.evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  expect(live).toBe("#contracts");
  await expect(page.locator("#contracts")).toHaveCount(1);
  expect(factory).toMatch(/^https:\/\/testnet\.bscscan\.com\/address\/0x[0-9a-fA-F]{40}#code$/);
  expect(tests).toBe("https://github.com/midego1/bnb-hackathon/tree/main/contracts/test");
  expect(agent).toMatch(/^https:\/\/testnet\.bscscan\.com\/tx\/0x[0-9a-f]{64}$/);

  // The verified testnet contracts link to BscScan testnet.
  const contracts = page.getByTestId("mk-contract");
  await expect(contracts).toHaveCount(4);
  for (const href of await contracts.evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))) {
    expect(href).toMatch(/^https:\/\/testnet\.bscscan\.com\/address\/0x[0-9a-fA-F]{40}#code$/);
  }
  await expect(page.locator("#live")).toContainText("there is no mainnet deployment yet");

  // For shops: the three rent rhythms of the example scooter, the vault and the desk.
  const shops = page.locator("#shops");
  await expect(shops).toContainText("Weekly");
  await expect(shops).toContainText("Every 2 weeks");
  for (const amount of ["฿793", "฿1,586", "฿3,400"]) await expect(shops).toContainText(amount);
  await expect(shops).toContainText("Fleet Vault");
  await expect(page.getByTestId("mk-list")).toHaveAttribute("href", "/landlord");
  await expect(shops).toContainText("A dispute desk that cannot stall");

  await expect(page.getByTestId("fee-pitch")).toContainText("Never taken from the deposit");
  // The roadmap says in words what is live and what is only planned.
  const phases = page.getByTestId("mk-phase");
  await expect(phases.first()).toContainText("Live on testnet");
  await expect(phases.nth(1)).toContainText("Capped BSC mainnet pilot");
  await expect(phases.nth(1)).toContainText("Planned");
  await expect(phases.nth(1)).toContainText("Not live yet");
  await expect(page.getByTestId("mk-github")).toHaveAttribute("href", "https://github.com/midego1/bnb-hackathon");

  // SEO and social card.
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /smart contract on BNB Chain/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/$/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/marketing\/og-v2\.jpg$/);
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", /in escrow/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  const card = await page.request.get("/marketing/og-v2.jpg");
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toBe("image/jpeg");

  // The hero artwork is the preloaded LCP image and has loaded; landmarks are in place; every image has a text.
  await expect(page.locator('link[rel="preload"][as="image"]')).toHaveCount(2);
  const art = page.locator(".mk-art img");
  await expect(art).toHaveAttribute("alt", /scooter rental shop/);
  await expect.poll(() => art.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await art.evaluate((img: HTMLImageElement) => img.currentSrc)).toMatch(/street-wide-\d+\.(avif|webp|jpg)$/);
  // Its dots are coins, and now and then a band of light sweeps across them.
  expect(await page.locator(".mk-art").evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("mk-glint");
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
  // ...the one decorative picture (the street again, behind the closing) has an empty one.
  expect(await page.locator("img").evaluateAll((imgs) => imgs.filter((i) => !i.getAttribute("alt")).map((i) => i.className))).toEqual(["mk-closing-art"]);
  expect(await page.locator("img").evaluateAll((imgs) => imgs.filter((i) => !i.getAttribute("width") || !i.getAttribute("height")).length)).toBe(0);

  // No web fonts or anything else from another origin.
  const origin = new URL(page.url()).origin;
  const foreign = await page.evaluate((o) => performance.getEntriesByType("resource").map((e) => e.name).filter((u) => !u.startsWith(o)), origin);
  expect(foreign).toEqual([]);

  await loadAll(page);
  expect(await page.locator('section[aria-labelledby="why"] img').evaluateAll((imgs: HTMLImageElement[]) => imgs.map((i) => i.currentSrc.replace(/^.*\//, "").replace(/-\d+\.\w+$/, "")))).toEqual(["today", "escrow"]);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test("calls to action: Play the live demo, Rent our Mystery Box, Open the app, How it works, Developers", async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize(DESKTOP);

  await page.goto("/");
  await expect(page.getByTestId("mk-cta-demo")).toHaveText("Play the live demo");
  await expect(page.getByTestId("mk-cta-box")).toHaveText("Rent our Mystery Box");
  await expect(page.getByTestId("mk-cta-app")).toHaveText("Open the app");
  await page.getByTestId("mk-cta-demo").click();
  await page.waitForURL(/\/demo$/);
  await expect(page.getByTestId("demo-play")).toBeVisible();

  await page.goto("/");
  await page.getByTestId("mk-cta-app").click();
  await page.waitForURL(/\/app$/);
  await expect(page.getByTestId("sidebar")).toBeVisible();

  await page.goto("/");
  await page.getByTestId("mk-cta-how").click();
  await page.waitForURL(/\/how-it-works$/);
  await expect(page.locator("[data-demo-stage]")).toBeVisible();

  await page.goto("/");
  await page.getByTestId("mk-open-app").click();
  await page.waitForURL(/\/app$/);
  await expect(page.getByTestId("role-switcher")).toBeVisible();
  // ...and the app links back to the marketing page.
  await page.getByTestId("footer-website").click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Keep your passport");

  await page.getByTestId("mk-developers").click();
  await page.waitForURL(/\/developers$/);
  await expect(page.getByTestId("action-get_lease")).toBeVisible();

  // Under the money board: from the example to the real thing.
  await page.goto("/");
  await page.getByTestId("mk-flow-demo").click();
  await page.waitForURL(/\/demo$/);
  await expect(page.getByTestId("demo-play")).toBeVisible();
  expect(problems).toEqual([]);

  // The live judge demo: the big screen of the box on stage (it polls the chain, so it is not held to the error check).
  await page.goto("/");
  await page.getByTestId("mk-cta-box").click();
  await page.waitForURL(/\/stage\/mystery-box$/);
  await expect(page.getByTestId("stage-view")).toBeVisible();
});

test("search: a city and a length filter the listings below, and the address carries the search", async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  const cards = page.getByTestId("mk-listing");
  const search = page.getByRole("search", { name: "Find a scooter" });
  await expect(cards).toHaveCount(7);
  await expect(page.getByTestId("mk-search-pill")).toBeHidden(); // the single pill is the phone's
  await expect(search.getByLabel("When")).toHaveAttribute("type", "date");

  await search.getByLabel("Where").selectOption("Phuket");
  await search.getByLabel("How long").selectOption("month");
  await search.getByRole("button", { name: "Search" }).click();
  await page.waitForURL((url) => url.searchParams.get("where") === "Phuket" && url.searchParams.get("how") === "month" && url.hash === "#listings");
  await expect(cards).toHaveCount(2);
  expect(await cityOf(cards)).toEqual(["Phuket", "Phuket"]);
  await expect(page.getByTestId("mk-listing-price")).toHaveText(["฿6,500 per month", "฿5,800 per month"]);
  await expect(cards.first()).toContainText("฿450 per day");
  await expect(page.getByTestId("mk-listing-summary")).toHaveText("2 demo listings in Phuket, by the month.");
  await expect(page.locator("#listings")).toBeInViewport();
  // The search is still what the form shows.
  await expect(search.getByLabel("Where")).toHaveValue("Phuket");

  // "Show all" brings back all seven, by the day.
  await page.getByTestId("mk-listing-all").click();
  await expect(cards).toHaveCount(7);
  await expect(page.getByTestId("mk-listing-summary")).toHaveText("7 demo listings.");
  await expect(page.getByTestId("mk-listing-all")).toHaveCount(0);
  await expect(search.getByLabel("Where")).toHaveValue("");
  await expect(search.getByLabel("How long")).toHaveValue("day");

  // The same search as a plain address (what the form sends without JavaScript): the server filters.
  await page.goto("/?where=Pai&how=week&when=2026-12-24");
  await expect(cards).toHaveCount(1);
  await expect(page.getByTestId("mk-listing-price")).toHaveText("฿653 per week"); // 2,800 x 7 / 30, rounded down
  await expect(page.getByTestId("mk-listing-summary")).toHaveText("1 demo listing in Pai, by the week, from 24 Dec 2026.");
  await expect(search.getByLabel("When")).toHaveValue("2026-12-24");
  // Anything unknown means everything.
  await page.goto("/?where=Atlantis&how=forever&when=soon");
  await expect(cards).toHaveCount(7);
  expect(await page.locator("form[role=search]").getAttribute("action")).toBe("/#listings");
  expect(problems).toEqual([]);
});

test("a listing card opens its listing page in the app", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/?where=Chiang%20Mai");
  const cards = page.getByTestId("mk-listing");
  expect(await cityOf(cards)).toEqual(["Chiang Mai", "Chiang Mai"]);
  await page.locator('[data-testid="mk-listing"][data-slug="honda-click-125i"]').click();
  await page.waitForURL(/\/app\/listings\/honda-click-125i$/);
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("listing-terms")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Honda Click 125i");
});

test("the money board: every step and both endings by click and keyboard, in baht", async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize(DESKTOP);
  await page.emulateMedia({ reducedMotion: "reduce" }); // no autoplay: the test drives it
  await page.goto("/");
  const flow = page.getByTestId("mk-flow");
  const board = flow.getByRole("group", { name: /Where the example rental's money is/ });
  const step = (n: number) => page.getByTestId(`mk-flow-step-${n}`);
  await flow.scrollIntoViewIfNeeded();

  // Server-rendered state: the renter has funded the escrow.
  await expect(flow).toHaveAttribute("data-step", "2");
  await expect(step(2)).toHaveAttribute("aria-current", "step");
  // Each panel reads what is at that station now.
  await expect(board).toContainText("฿0 with the renter");
  await expect(board).toContainText("฿10,200 in escrow");
  await expect(board).toContainText("฿0 with the owner");
  await expect(board).toContainText("Passport: still in your pocket");
  await expect(board.getByText("KeyEscrow fee ฿340, once")).toBeHidden();

  await step(1).click();
  await expect(flow).toHaveAttribute("data-step", "1");
  await expect(board).toContainText("฿10,200 with the renter");
  await expect(board).toContainText("฿0 in escrow");

  // Rent goes out to the owner after the one-time fee; the deposit stays.
  await step(3).click();
  await expect(board).toContainText("฿6,800 in escrow");
  await expect(board).toContainText("฿3,060 with the owner");
  await expect(board.getByText("KeyEscrow fee ฿340, once")).toBeVisible();

  // Return with no new damage: the whole deposit goes back.
  await step(4).focus();
  await page.keyboard.press("Enter");
  await expect(flow).toHaveAttribute("data-step", "4");
  await expect(board).toContainText("฿6,800 with the renter");
  await expect(board).toContainText("฿0 in escrow");
  await expect(page.getByTestId("mk-flow-clean")).toHaveAttribute("aria-pressed", "true");

  // ...or with new damage: the example split, which still adds up to the deposit.
  await page.getByTestId("mk-flow-damage").click();
  await expect(flow).toHaveAttribute("data-ending", "damage");
  await expect(board).toContainText("฿5,780 with the renter");
  await expect(board).toContainText("฿4,080 with the owner");
  await expect(step(4)).toContainText("฿1,020 to the owner");
  await expect(page.getByTestId("mk-flow-damage")).toHaveAttribute("aria-pressed", "true");

  // An ending is also a way to the last step.
  await step(2).click();
  await expect(page.getByTestId("mk-flow-damage")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("mk-flow-clean").click();
  await expect(flow).toHaveAttribute("data-step", "4");
  await expect(board).toContainText("฿6,800 with the renter");
  expect(problems).toEqual([]);
});

test("the money board plays by itself once it is on screen, and Play runs it again", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  const flow = page.getByTestId("mk-flow");
  const play = page.getByTestId("mk-flow-play");
  await expect(flow).toHaveAttribute("data-step", "2");
  await flow.scrollIntoViewIfNeeded();
  await expect(play).toHaveText("Pause"); // it started by itself...
  await expect(flow).toHaveAttribute("data-step", "4", { timeout: 15_000 });
  await expect(play).toHaveText("Play the steps", { timeout: 10_000 }); // ...and stopped at the end

  await play.click(); // again, from the first step
  await expect(play).toHaveText("Pause");
  await expect(flow).not.toHaveAttribute("data-step", "4");
  await play.click(); // pause
  await expect(play).toHaveText("Play the steps");
  const paused = await flow.getAttribute("data-step");
  await page.waitForTimeout(3200); // longer than one step
  await expect(flow).toHaveAttribute("data-step", paused!);
});

for (const vp of [PHONE, SMALL_PHONE]) {
  test(`phone (${vp.width} px): no sideways scroll, the search pill and the three ways in on the first screen, the board works`, async ({ page }) => {
    const problems = watchProblems(page);
    await page.setViewportSize(vp);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/");
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    for (const id of ["mk-search-pill", ...CTAS, "mk-cta-how"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.x, id).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, id).toBeLessThanOrEqual(vp.width);
      expect(box.y + box.height, `${id} is on the first screen`).toBeLessThanOrEqual(vp.height);
      expect(box.height, `${id} is a comfortable touch target`).toBeGreaterThanOrEqual(40);
    }
    // The search is one pill until it is tapped; then its fields open under it and it filters like the bar does.
    const pill = page.getByTestId("mk-search-pill");
    const go = page.getByTestId("mk-search-go");
    await expect(pill).toHaveText(/Anywhere · Any date · By the day/);
    await expect(pill).toHaveAttribute("aria-expanded", "false");
    await expect(go).toBeHidden();
    await pill.click();
    await expect(pill).toHaveAttribute("aria-expanded", "true");
    await expect(go).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.getByRole("search").getByLabel("Where").selectOption("Chiang Mai");
    await expect(pill).toHaveText(/Chiang Mai · Any date · By the day/);
    await go.click();
    await expect(go).toBeHidden();
    await expect(page.getByTestId("mk-listing")).toHaveCount(2);
    expect(await cityOf(page.getByTestId("mk-listing"))).toEqual(["Chiang Mai", "Chiang Mai"]);
    await expect(page.locator("#listings")).toBeInViewport();
    // One card per row on a phone.
    const [first, second] = await page.getByTestId("mk-listing").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    expect(first).toBe(second);
    await page.goto("/");
    expect(await page.locator(".mk-art img").evaluate((img: HTMLImageElement) => img.currentSrc)).toMatch(/street-tall-\d+\.(avif|webp|jpg)$/);
    // The header trades "Open the app" (it is the hero's third button) for a thumb-sized EN / 中文 switch.
    const header = page.getByRole("banner");
    await expect(header.getByTestId("mk-open-app")).toBeHidden();
    await expect(header.getByTestId("lang-both")).toBeHidden();
    for (const id of ["lang-en", "lang-zh", "theme-cycle"]) {
      const box = (await header.getByTestId(id).boundingBox())!;
      expect(box.height, `${id} is a comfortable touch target`).toBeGreaterThanOrEqual(40);
      expect(box.x + box.width, id).toBeLessThanOrEqual(vp.width);
    }
    await header.getByTestId("lang-zh").click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("护照留下");
    await header.getByTestId("lang-en").click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Keep your passport");

    // The board stands upright; its four steps are thumb-sized buttons and one caption follows them.
    const flow = page.getByTestId("mk-flow");
    await page.getByTestId("mk-flow-step-3").scrollIntoViewIfNeeded();
    await page.getByTestId("mk-flow-step-3").click();
    await expect(flow).toHaveAttribute("data-step", "3");
    await expect(flow.locator(".mk-flow-now")).toContainText("Ride. Rent is paid out on schedule");
    await expect(flow.locator(".mk-flow-now")).toBeVisible();
    for (const id of ["mk-flow-step-1", "mk-flow-step-4", "mk-flow-play", "mk-flow-damage"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(Math.min(box.width, box.height), `${id} is a comfortable touch target`).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width, id).toBeLessThanOrEqual(vp.width);
    }

    const cycle = page.getByTestId("theme-cycle");
    await expect(page.locator("html")).toHaveClass(/\blight\b/);
    await cycle.click(); // system -> light
    await cycle.click(); // light -> dark
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await loadAll(page);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(problems).toEqual([]);
  });
}

test("中文: the whole page reads in Chinese, on a laptop and on a phone", async ({ page }) => {
  const problems = watchProblems(page);
  await language(page, "zh");
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("护照留下");
  await expect(page.getByTestId("mk-cta-demo")).toHaveText("播放实时演示");
  await expect(page.getByTestId("mk-cta-box")).toHaveText("租我们的神秘盒子");
  await expect(page.getByTestId("mk-cta-app")).toHaveText("打开应用");
  await expect(page.getByTestId("mk-proof")).toHaveText([/已上线 BSC 测试网/, /合约 v2/, /305 项合约测试/, /ERC-8004 智能体 #2921/]);
  for (const name of ["挑一辆摩托车，押金进托管。", "你的押金如何受保护，一共四步。", "AI 提建议，人来做决定。", "发布你的摩托车。", "下一步去哪里。"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  // The search and the listings in Chinese: field labels, city names, the summary, the badge.
  const search = page.getByRole("search", { name: "找一辆摩托车" });
  await expect(search.getByLabel("地点").locator("option")).toHaveText(["泰国任何地方", "清迈", "曼谷", "普吉", "拜县"]);
  await expect(search.getByLabel("租多久").locator("option")).toHaveText(["按天", "按周", "按月"]);
  await expect(search.getByRole("button", { name: "搜索" })).toBeVisible();
  await expect(page.getByTestId("mk-listing-summary")).toHaveText("7 条演示租赁信息。");
  const zhClick = page.locator('[data-testid="mk-listing"][data-slug="honda-click-125i"]');
  await expect(zhClick).toContainText("Nimman, 清迈");
  await expect(zhClick).toContainText("押金由托管合约保护");
  await expect(zhClick.getByTestId("mk-listing-price")).toHaveText("฿250 每天");
  await search.getByLabel("地点").selectOption("Phuket");
  await search.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByTestId("mk-listing")).toHaveCount(2);
  await expect(page.getByTestId("mk-listing-summary")).toHaveText("2 条演示租赁信息，位于普吉。");
  await expect(page.getByTestId("mk-flow")).toContainText("护照：还在你口袋里");
  await expect(page.getByTestId("mk-phase").nth(1)).toContainText("计划中");
  await expect(page.getByTestId("mk-phase").nth(1)).toContainText("尚未上线");
  await expect(page.getByTestId("ai-translated")).toContainText("AI 翻译");
  await loadAll(page);
  expect(await sideways(page)).toBeLessThanOrEqual(0);

  await page.setViewportSize(PHONE);
  await page.goto("/");
  for (const id of CTAS) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x + box.width, id).toBeLessThanOrEqual(PHONE.width);
    expect(box.y + box.height, `${id} is on the first screen`).toBeLessThanOrEqual(PHONE.height);
  }
  await loadAll(page);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test("EN+中文: a Chinese line under the headlines and the steps, English everywhere else", async ({ page }) => {
  const problems = watchProblems(page);
  await language(page, "both");
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toContainText("Keep your passport.");
  await expect(h1.locator(".i18n-zh")).toHaveText("摩托车租走，护照留下。");
  await expect(page.locator("#listings-h .i18n-zh")).toHaveText("挑一辆摩托车，押金进托管。");
  await expect(page.locator("#how .i18n-zh")).toHaveText("你的押金如何受保护，一共四步。");
  await expect(page.getByTestId("mk-flow-step-2").locator(".i18n-zh")).toHaveText("租客向托管付款");
  await expect(page.locator("#shops-h .i18n-zh")).toHaveText("发布你的摩托车。");
  // The search and the cards stay English.
  await expect(page.getByRole("search").getByLabel("Where")).toBeVisible();
  await expect(page.getByTestId("mk-listing-summary")).toHaveText("7 demo listings.");
  // Body text and buttons stay English.
  await expect(page.getByTestId("mk-cta-box")).toHaveText("Rent our Mystery Box");
  await expect(page.getByTestId("mk-flow-step-2")).toContainText("goes into this rental's own contract");
  await loadAll(page);
  expect(await sideways(page)).toBeLessThanOrEqual(0);

  await page.setViewportSize(PHONE);
  await page.goto("/");
  await loadAll(page);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test("reduced motion: the street stands still and the board waits to be pressed", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const sel of [".mk-art", ".mk-art-pan", ".mk-glow"]) {
    expect(await page.locator(sel).evaluate((el) => getComputedStyle(el).animationName), sel).toBe("none");
  }
  expect(await page.locator(".mk-art").evaluate((el) => getComputedStyle(el, "::after").animationName), "the coins' glint").toBe("none");
  const flow = page.getByTestId("mk-flow");
  await flow.scrollIntoViewIfNeeded();
  // The active track is simply lit and its amount sits still.
  const track = flow.locator('.mk-track[data-flow="fwd"]');
  await expect(track).toHaveCount(1);
  expect(await track.evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("none");
  expect(await track.locator(".mk-track-tag").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(await flow.locator(".mk-dot-on").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await page.waitForTimeout(3200); // longer than one step of the autoplay
  await expect(flow).toHaveAttribute("data-step", "2");
  await expect(page.getByTestId("mk-flow-play")).toHaveText("Play the steps");
});

test.describe("screenshots", () => {
  test.skip(!!process.env.SKIP_SCREENSHOTS, "SKIP_SCREENSHOTS is set");
  for (const vp of [DESKTOP, PHONE]) {
    for (const theme of ["light", "dark"] as const) {
      for (const lang of ["en", "zh"] as const) {
        test(`${vp.width}x${vp.height} ${theme} ${lang}`, async ({ page }) => {
          await language(page, lang);
          await page.setViewportSize(vp);
          await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
          await page.goto("/");
          await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
          await loadAll(page);
          await page.evaluate(() => document.fonts.ready);
          const name = `landing-${vp.width}x${vp.height}-${theme}-${lang}`;
          await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
          await page.screenshot({ path: path.join(SHOTS, `${name}-full.png`), fullPage: true });
          // The signature moment on its own, mid-story: rent paid out, the deposit still in escrow.
          await page.getByTestId("mk-flow-step-3").click();
          await page.getByTestId("mk-flow").screenshot({ path: path.join(SHOTS, `${name}-board.png`) });
          expect(await sideways(page)).toBeLessThanOrEqual(0);
        });
      }
    }
  }
});
