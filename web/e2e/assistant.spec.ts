import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Ask AI with the demo model (no key: the e2e server blanks ANTHROPIC_API_KEY) on the e2e anvil: the bubble bottom
 * right and Cmd/Ctrl+J open the floating chat window; read a rental, create one through an approval card signed by
 * the dev wallet, decline, Stop, and the edge-light states. Screenshots (light + dark, 1470x830) go to ASSISTANT_SHOTS (default test-results/screenshots/ask-ai).
 */

const SHOTS = process.env.ASSISTANT_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/ask-ai");
mkdirSync(SHOTS, { recursive: true });

/** Seed.s.sol's demo rental on a fresh anvil: Active, owner = dev #1, renter = dev #2. */
const SEEDED_LEASE = "0x9f1ac54BEF0DD2f6f3462EA0fa94fC62300d3a8e";
const DEV_RENTER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const CREATE = `Create a rental for 3,400 baht a month with a 6,800 deposit for ${DEV_RENTER}`;

test.use({ viewport: { width: 1470, height: 830 } });

async function actAs(page: Page, role: "landlord" | "tenant" | "arbiter") {
  await page.getByTestId(`dev-role-${role}`).click();
  await expect(page.getByTestId(`dev-role-${role}`)).toHaveAttribute("aria-pressed", "true");
}

/** Ctrl/Cmd+J, again until it lands: the shortcut listener only exists once the page has hydrated. */
async function pressOpen(page: Page) {
  const opened = page.locator("html[data-assistant-open]");
  await expect(async () => {
    if ((await opened.count()) === 0) await page.keyboard.press("ControlOrMeta+j");
    await expect(opened).toHaveCount(1, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

async function openPanel(page: Page) {
  await pressOpen(page);
  await expect(page.getByTestId("assistant-panel")).toBeVisible();
  await expect(page.getByTestId("assistant-mock-badge")).toBeVisible();
}

async function ask(page: Page, text: string) {
  const input = page.getByTestId("assistant-input");
  await input.fill(text);
  await input.press("Enter");
}

const edge = (page: Page) => page.getByTestId("assistant-edge");

/** Hold the next Ask AI request for `ms` so a state that is normally brief can be checked. */
async function holdNextRun(page: Page, ms: number) {
  let held = false;
  await page.route("**/api/assistant", async (route) => {
    if (!held && route.request().method() === "POST") {
      held = true;
      await new Promise((r) => setTimeout(r, ms));
    }
    await route.fallback();
  });
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => localStorage.setItem("keyescrow-theme", t), theme);
}

test("Cmd+J opens Ask AI; 'Where is my deposit?' on a rental shows the server's rental card", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  await page.goto(`/lease/${SEEDED_LEASE}`);
  await actAs(page, "tenant");
  await expect(edge(page)).toHaveAttribute("data-assistant-state", "idle");
  await openPanel(page);
  await expect(page.getByTestId("assistant-suggestions")).toContainText("Where is my deposit?");

  await holdNextRun(page, 1500);
  await page.getByTestId("assistant-suggestions").getByRole("button", { name: "Where is my deposit?" }).click();
  // Reading / thinking: blue light, status line.
  await expect(edge(page)).toHaveAttribute("data-assistant-state", "reading");
  await expect(page.getByTestId("assistant-status")).toHaveAttribute("data-state", "reading");

  // The server's card sits inside Ask AI's chat bubble (left), the question in the person's (right).
  const card = page.getByTestId("assistant-turn").getByTestId("assistant-card-lease");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-status", "Active");
  await expect(card).toContainText("฿"); // baht first
  await expect(card).toContainText("mUSDT");
  await expect(page.getByTestId("assistant-answer").last()).toContainText("Your deposit");
  await expect(edge(page)).toHaveAttribute("data-assistant-state", "idle");

  // Slash command: /next expands to a prompt.
  await ask(page, "/next");
  await expect(page.getByTestId("assistant-user").last()).toHaveText("What happens next?");
  await expect(page.getByTestId("assistant-answer").last()).toContainText(/next/i);
  expect(problems).toEqual([]);

  const user = (await page.getByTestId("assistant-user").last().boundingBox())!;
  const turn = (await page.getByTestId("assistant-turn").last().boundingBox())!;
  expect(user.x, "the person's message is on the right").toBeGreaterThan(turn.x);

  // Ctrl+J again closes it.
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByTestId("assistant-panel")).toBeHidden();
});

test("create a rental: approval card -> approve -> dev wallet signs -> done card, the page follows to the new rental", async ({ page }) => {
  await page.goto("/landlord");
  await actAs(page, "landlord");
  await openPanel(page);
  await ask(page, CREATE);

  const approval = page.getByTestId("assistant-approval");
  await expect(approval).toBeVisible();
  await expect(approval).toHaveAttribute("data-state", "waiting");
  await expect(approval).toHaveAttribute("data-action", "prepare_create_lease");
  const changes = page.getByTestId("assistant-approval-changes");
  await expect(changes).toContainText("฿3,400");
  await expect(changes).toContainText("฿6,800");
  await expect(changes).toContainText("Awaiting funding");
  // Waiting for approval: steady violet edge, the tab title says so.
  await expect(edge(page)).toHaveAttribute("data-assistant-state", "waiting");
  await expect(page).toHaveTitle(/^\(Approval needed\) /);
  await expect(page.getByTestId("assistant-panel")).toHaveAttribute("data-assistant-state", "waiting");
  // Closed, the bubble keeps a violet dot until the change is approved or declined.
  await page.getByTestId("assistant-bubble").click();
  await expect(page.getByTestId("assistant-panel")).toBeHidden();
  await expect(page.getByTestId("assistant-bubble")).toHaveAttribute("data-dot", "waiting");
  await page.getByTestId("assistant-bubble").click();
  await expect(approval).toBeVisible();

  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
    await page.evaluate((t) => document.documentElement.classList.toggle("light", t === "light"), theme);
    await page.screenshot({ path: path.join(SHOTS, `approval-${theme}.png`) });
  }
  await setTheme(page, "light");
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  });

  // Approve: amber while the change is signed and confirmed.
  await holdNextRun(page, 1500);
  await page.getByTestId("assistant-approve").click();
  await expect(edge(page)).toHaveAttribute("data-assistant-state", "changing");
  const done = page.getByTestId("assistant-card-done");
  await expect(done).toBeVisible({ timeout: 30_000 });
  await expect(done).toContainText("1 transaction confirmed");
  await expect(page.getByTestId("assistant-applied")).toHaveText("1 change applied");
  // Follow along: the page went to the new rental.
  await page.waitForURL(/\/lease\/0x[0-9a-fA-F]{40}$/);
  await expect(page.getByTestId("status-badge").first()).toHaveText("Awaiting funding");
  await expect(page.getByTestId("assistant-answer").last()).toContainText("Done");
  await expect(edge(page)).toHaveAttribute("data-assistant-state", "idle");
  await expect(page).not.toHaveTitle(/Approval needed/);
  await page.screenshot({ path: path.join(SHOTS, "done-light.png") });
  await setTheme(page, "dark");
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("light");
  });
  await page.screenshot({ path: path.join(SHOTS, "done-dark.png") });
});

test("decline: nothing is signed and the model is told it was not done", async ({ page }) => {
  await page.goto("/landlord");
  await actAs(page, "landlord");
  await openPanel(page);
  await ask(page, CREATE);
  await expect(page.getByTestId("assistant-approval")).toHaveAttribute("data-state", "waiting");
  await page.getByTestId("assistant-decline").click();
  await expect(page.getByTestId("assistant-approval")).toHaveAttribute("data-state", "declined");
  await expect(page.getByTestId("assistant-approval-outcome")).toHaveText("Declined, not done");
  await expect(page.getByTestId("assistant-answer").last()).toContainText("did not create the rental");
  await expect(page.getByTestId("assistant-applied")).toHaveCount(0);
  await expect(page).toHaveURL(/\/landlord$/);
  await expect(edge(page)).toHaveAttribute("data-assistant-state", "idle");
});

test("Stop ends the run; follow along off shows a 'go there' link instead of moving the page", async ({ page }) => {
  await page.goto("/tenant");
  await actAs(page, "tenant");
  await openPanel(page);
  await holdNextRun(page, 4000);
  await ask(page, "Find my rental");
  await expect(edge(page)).toHaveAttribute("data-assistant-state", "reading");
  await page.getByTestId("assistant-stop").click();
  await expect(page.getByTestId("assistant-notice").last()).toHaveText("Stopped.");
  await expect(edge(page)).toHaveAttribute("data-assistant-state", "idle");
  await page.unrouteAll({ behavior: "ignoreErrors" });

  await page.getByTestId("assistant-follow").click();
  await expect(page.getByTestId("assistant-follow")).toHaveAttribute("aria-pressed", "false");
  await ask(page, "Go to the dispute desk");
  await expect(page.getByTestId("assistant-go-there")).toBeVisible();
  await expect(page).toHaveURL(/\/tenant$/);
  await page.getByTestId("assistant-go-there").click();
  await expect(page).toHaveURL(/\/arbiter$/);

  // The choice is kept (localStorage); New chat clears the conversation.
  await page.reload();
  await openPanel(page);
  await expect(page.getByTestId("assistant-follow")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("assistant-follow").click();
  await ask(page, "Find my rental");
  await expect(page.getByTestId("assistant-card-list")).toBeVisible();
  await page.getByTestId("assistant-new").click();
  await expect(page.getByTestId("assistant-suggestions")).toBeVisible();
});

test("light + dark: a rental card and the panel on the renter's rental", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/lease/${SEEDED_LEASE}`);
    await setTheme(page, theme);
    await page.reload();
    await actAs(page, "tenant");
    await openPanel(page);
    await ask(page, "Where is my deposit?");
    await expect(page.getByTestId("assistant-card-lease")).toBeVisible();
    await expect(page.getByTestId("assistant-answer").last()).toContainText("Your deposit");
    await page.screenshot({ path: path.join(SHOTS, `lease-card-${theme}.png`) });
  }
  await setTheme(page, "light");
});

test("the bubble opens a floating window: no reflow, no page scroll at 1470x830, a full-height sheet on a phone", async ({ page }) => {
  await page.goto("/app");
  const bubble = page.getByTestId("assistant-bubble");
  const panel = page.getByTestId("assistant-panel");
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveAccessibleName("Ask AI");
  await expect(bubble).toHaveAttribute("title", /Ask AI/);
  await expect(page.getByTestId("sidebar").getByRole("button", { name: "Ask AI" })).toHaveCount(0); // one entry point
  const b = (await bubble.boundingBox())!;
  expect(Math.round(b.width)).toBe(56);
  expect(b.x + b.width, "bottom right").toBeGreaterThan(1470 - 24);
  expect(b.y + b.height).toBeGreaterThan(830 - 24);
  const main = (await page.locator("main").boundingBox())!;

  await bubble.click();
  await expect(panel).toBeVisible();
  await expect(panel).toBeInViewport({ ratio: 1 });
  await expect(bubble).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("assistant-input")).toBeFocused();
  const w = (await panel.boundingBox())!;
  expect(Math.round(w.width)).toBe(400);
  expect(w.y + w.height, "the window sits above the bubble").toBeLessThanOrEqual(b.y);
  expect((await page.locator("main").boundingBox())!.width, "the page does not reflow").toBe(main.width);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth), "no sideways scroll").toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(SHOTS, "bubble-window-light.png") });

  // The bubble closes it again (focus goes back to the bubble); the window is kept, hidden, for the next open.
  await bubble.click();
  await expect(panel).toBeHidden();
  await expect(bubble).toBeFocused();
  await expect(page.locator("html[data-assistant-open]")).toHaveCount(0);

  // Phone: a full-height sheet; the bubble steps aside while it is open; close comes back to the bubble.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(bubble).toBeInViewport({ ratio: 1 });
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    await page.reload();
    await page.screenshot({ path: path.join(SHOTS, `phone-bubble-${theme}.png`) });
    await bubble.click();
    await expect(panel).toBeVisible();
    const sheet = (await panel.boundingBox())!;
    expect([sheet.x, sheet.y, sheet.width, sheet.height].map(Math.round)).toEqual([0, 0, 390, 844]);
    await expect(bubble).toBeHidden();
    await expect(page.getByTestId("assistant-input")).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(SHOTS, `phone-sheet-${theme}.png`) });
    await page.getByTestId("assistant-close").click();
    await expect(panel).toBeHidden();
    await expect(bubble).toBeVisible();
  }
  await setTheme(page, "light");
});

test("a reply that lands while the window is closed puts a dot on the bubble", async ({ page }) => {
  await page.goto(`/lease/${SEEDED_LEASE}`);
  await actAs(page, "tenant");
  await openPanel(page);
  await holdNextRun(page, 1500);
  await ask(page, "Where is my deposit?");
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByTestId("assistant-panel")).toBeHidden();
  await expect(page.getByTestId("assistant-bubble")).toHaveAttribute("data-dot", "unread", { timeout: 20_000 });
  await page.getByTestId("assistant-bubble").click();
  await expect(page.getByTestId("assistant-card-lease")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByTestId("assistant-bubble")).not.toHaveAttribute("data-dot", /.*/);
});

test("model picker: only Sonnet 5.5 and Haiku 5.5, per chat; /model; the server refuses anything else", async ({ page }) => {
  await page.goto("/tenant");
  await openPanel(page);
  const picker = page.getByTestId("assistant-model");
  await expect(picker).toContainText("Demo model");
  await expect(picker).toHaveAttribute("data-model", "claude-sonnet-5-5");
  await picker.click();
  const menu = page.getByTestId("assistant-model-menu");
  // shadcn DropdownMenu radio items: the check mark is an icon, the current model is aria-checked.
  await expect(menu.getByRole("menuitemradio")).toHaveText(["Claude Sonnet 5.5", "Claude Haiku 5.5"]);
  await expect(menu.getByRole("menuitemradio").first()).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("assistant-model-haiku").click();
  await expect(picker).toHaveAttribute("data-model", "claude-haiku-5-5");
  await expect(page.getByTestId("assistant-note")).toContainText("demo model answers");
  await ask(page, "/model sonnet");
  await expect(picker).toHaveAttribute("data-model", "claude-sonnet-5-5");
  await ask(page, "/model opus");
  await expect(page.getByTestId("assistant-note")).toContainText("only offers Claude Sonnet 5.5 and Claude Haiku 5.5");
  await expect(picker).toHaveAttribute("data-model", "claude-sonnet-5-5");
  // New chat: back to the default.
  await ask(page, "/model haiku");
  await page.getByTestId("assistant-new").click();
  await expect(picker).toHaveAttribute("data-model", "claude-sonnet-5-5");

  // The server never uses a model outside the allowlist (here: says so in run_started).
  const res = await page.request.post("/api/assistant", {
    data: { chatId: "e2emodelcheck01", message: "Explain KeyScrow simply", model: "claude-opus-5-5", context: { path: "/", address: null, chainId: 31337 } },
  });
  const body = await res.text();
  expect(body).toContain('"refusedModel":"claude-opus-5-5"');
  expect(body).not.toContain('"model":"claude-opus-5-5"');
});

test("history: New chat keeps the chat; open it read-only, rename, continue, delete; old approvals are expired", async ({ page }) => {
  await page.goto("/landlord");
  await actAs(page, "landlord");
  await openPanel(page);
  await ask(page, CREATE);
  await expect(page.getByTestId("assistant-approval")).toHaveAttribute("data-state", "waiting");
  // New chat instead of answering: the old chat goes to the history; its change can never be applied.
  await page.getByTestId("assistant-new").click();
  await expect(page.getByTestId("assistant-suggestions")).toBeVisible();
  await expect(edge(page)).toHaveAttribute("data-assistant-state", "idle");
  await ask(page, "Explain KeyScrow simply");
  await expect(page.getByTestId("assistant-answer").last()).toContainText("Nobody can take the deposit alone");

  await page.getByTestId("assistant-history").click();
  const items = page.getByTestId("assistant-history-item");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("Explain KeyScrow simply");
  await expect(items.nth(1)).toContainText("Create a rental for 3,400 baht");
  await page.getByTestId("assistant-history-search").fill("rental 3,400");
  await expect(items).toHaveCount(1);
  await page.getByTestId("assistant-history-search").fill("");

  // Open read-only: steps and cards as they were, the approval expired, no Approve button, no composer.
  await items.nth(1).getByTestId("assistant-history-open").click();
  const ro = page.getByTestId("assistant-panel");
  await expect(page.getByTestId("assistant-readonly")).toBeVisible();
  await expect(ro.getByTestId("assistant-approval")).toHaveAttribute("data-state", "expired");
  await expect(ro.getByTestId("assistant-approval-outcome")).toHaveText("Expired, not done");
  await expect(ro.getByTestId("assistant-approve")).toHaveCount(0);
  await expect(page.getByTestId("assistant-input")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, "history-readonly-light.png") });
  await page.getByRole("button", { name: "Back to the history" }).click();

  // Rename, then continue that chat: it becomes the open chat with fresh approvals only.
  await items.nth(1).getByTestId("assistant-history-rename").click();
  await page.getByTestId("assistant-history-title-input").fill("Rental for the demo renter");
  await page.getByTestId("assistant-history-title-input").press("Enter");
  await expect(items.filter({ hasText: "Rental for the demo renter" })).toHaveCount(1);
  await page.screenshot({ path: path.join(SHOTS, "history-list-light.png") });
  await items.filter({ hasText: "Rental for the demo renter" }).getByTestId("assistant-history-open").click();
  await page.getByTestId("assistant-continue").click();
  await expect(page.getByTestId("assistant-user").first()).toContainText("Create a rental for 3,400 baht");
  await expect(page.getByTestId("assistant-approval")).toHaveAttribute("data-state", "expired");
  await ask(page, CREATE);
  await expect(page.getByTestId("assistant-approval").last()).toHaveAttribute("data-state", "waiting");
  await page.getByTestId("assistant-approval").last().getByTestId("assistant-decline").click();
  await expect(page.getByTestId("assistant-answer").last()).toContainText("did not create the rental");

  // Delete with a confirmation; history is per wallet (the renter's list is separate).
  await page.getByTestId("assistant-history").click();
  await expect(items).toHaveCount(2);
  await items.first().getByTestId("assistant-history-delete").click();
  await items.first().getByTestId("assistant-history-confirm-delete").click();
  await expect(items).toHaveCount(1);
  await actAs(page, "tenant");
  await expect(page.getByText("No earlier chats in this browser yet.")).toBeVisible();
  await actAs(page, "landlord");
  await expect(items).toHaveCount(1);
});

test("on the one-screen stages the bubble is small and clear of the stage controls", async ({ page }) => {
  for (const [url, ids] of [
    ["/pitch?autoplay=0", ["pitch-back", "pitch-play", "pitch-next", "pitch-dot"]],
    ["/how-it-works?autoplay=0", ["eli5-back", "eli5-play", "eli5-next", "eli5-dot"]],
    ["/demo", ["demo-play", "demo-speed-fast", "demo-mode-step"]],
  ] as const) {
    await page.goto(url);
    const bubble = page.getByTestId("assistant-bubble");
    await expect(bubble).toBeInViewport({ ratio: 1 });
    const b = (await bubble.boundingBox())!;
    expect(Math.round(b.width), `small bubble on ${url}`).toBe(32);
    for (const id of ids) {
      await expect(page.getByTestId(id).first()).toBeVisible();
      for (const el of await page.getByTestId(id).all()) {
        const c = (await el.boundingBox())!;
        const apart = c.x + c.width <= b.x || b.x + b.width <= c.x || c.y + c.height <= b.y || b.y + b.height <= c.y;
        expect(apart, `${id} is not under the bubble on ${url}`).toBe(true);
      }
    }
    await page.screenshot({ path: path.join(SHOTS, `stage-bubble-${url.split("?")[0].slice(1)}.png`) });
  }
});
