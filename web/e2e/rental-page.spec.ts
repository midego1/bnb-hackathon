import { expect, test, type Browser } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { encodeFunctionData, keccak256, toBytes, zeroAddress, type Address, type Hex } from "viem";
import { escrowFactoryAbi, rentalEscrowAbi } from "../lib/contracts/abis.generated";
import { restoreChainAfterEachTest, rpc } from "./chain";
import { E2E_DEPLOYMENT, E2E_WEB_PORT } from "./env";
import { audit } from "./phoneAudit";

/**
 * The rental page (/lease/<escrow>) in every status (awaiting funding, active with rent paid out, return proposal, in
 * dispute, settled) for every role (renter, owner, dispute desk), on a desktop (1470x830) and a phone (390x844), light
 * in English and dark in EN+中文. Each view is checked for its layout (two columns on the desktop, one on the phone with
 * the action as a bar at the bottom), the one timeline, the one money card, no sideways scroll and the phone audit of
 * e2e/phone.spec.ts, and saved as a full-page screenshot (RENTAL_SHOTS, default test-results/screenshots/rental).
 *
 * The states are made on the e2e anvil from its unlocked dev accounts (no UI clicks: e2e/lease-flow.spec.ts covers the
 * flows), each on a snapshot that is reverted afterwards. /api/risk is answered by a fixture, because the e2e server has
 * no CoinMarketCap key and the card would only say so; the last test checks that real answer.
 */
restoreChainAfterEachTest();

const SHOTS = process.env.RENTAL_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/rental");
mkdirSync(SHOTS, { recursive: true });
const ORIGIN = `http://127.0.0.1:${E2E_WEB_PORT}`;
const demo = JSON.parse(readFileSync(path.resolve(__dirname, "../../contracts/deployments/31337.demo.example.json"), "utf8")) as {
  lease: Address;
  disputedLease: Address;
  landlord: Address;
  tenant: Address;
  leaseHash: Hex;
};
const UNIT = BigInt(1_000_000);

async function send(from: Address, to: Address, data: Hex) {
  const hash = await rpc<Hex>("eth_sendTransaction", [{ from, to, data }]);
  // anvil answers with the hash before the block is mined: wait for the receipt instead of reading it once.
  for (let i = 0; i < 100; i++) {
    const receipt = await rpc<{ status: Hex } | null>("eth_getTransactionReceipt", [hash]);
    if (receipt?.status === "0x1") return;
    if (receipt) throw new Error(`transaction ${hash} reverted`);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`transaction ${hash} was not mined within 5 s`);
}
const escrow = (from: Address, lease: Address, functionName: "releaseRent" | "propose" | "accept", args: readonly unknown[] = []) =>
  send(from, lease, encodeFunctionData({ abi: rentalEscrowAbi, functionName, args } as Parameters<typeof encodeFunctionData>[0]));
const proposeAsRenter = (lease: Address) => escrow(demo.tenant, lease, "propose", [BigInt(150) * UNIT, keccak256(toBytes("e2e.rental-page.proposal"))]);

/** Each status, made from the seeded chain; returns the rental to open. */
const STATES: Record<string, { badge: string; ahead: number; make: () => Promise<Address> }> = {
  created: {
    badge: "Awaiting funding",
    ahead: 7,
    make: async () => {
      const p = { tenant: demo.tenant, arbiter: zeroAddress, rentAmount: BigInt(100) * UNIT, depositAmount: BigInt(200) * UNIT, termPeriods: 3, rentPeriod: 0, responseWindow: 0, arbiterWindow: 0, leaseHash: demo.leaseHash };
      const data = encodeFunctionData({ abi: escrowFactoryAbi, functionName: "createLease", args: [p] });
      const to = E2E_DEPLOYMENT.escrowFactory as Address;
      const address = `0x${(await rpc<Hex>("eth_call", [{ from: demo.landlord, to, data }, "latest"])).slice(-40)}` as Address;
      await send(demo.landlord, to, data);
      return address;
    },
  },
  active: {
    badge: "Active",
    ahead: 6,
    make: async () => {
      await escrow(demo.landlord, demo.lease, "releaseRent");
      return demo.lease;
    },
  },
  proposal: {
    badge: "Return proposal",
    ahead: 3,
    make: async () => {
      await proposeAsRenter(demo.lease);
      return demo.lease;
    },
  },
  disputed: { badge: "In dispute", ahead: 2, make: async () => demo.disputedLease },
  settled: {
    badge: "Settled",
    ahead: 0,
    make: async () => {
      await proposeAsRenter(demo.lease);
      await escrow(demo.landlord, demo.lease, "accept", [1]);
      return demo.lease;
    },
  },
};

const VIEWS = [
  { name: "desktop-light", viewport: { width: 1470, height: 830 }, lang: "en", theme: "light" },
  { name: "desktop-dark", viewport: { width: 1470, height: 830 }, lang: "both", theme: "dark" },
  { name: "phone-light", viewport: { width: 390, height: 844 }, lang: "en", theme: "light" },
  { name: "phone-dark", viewport: { width: 390, height: 844 }, lang: "both", theme: "dark" },
] as const;
const ROLES = { renter: "tenant", owner: "landlord", desk: "arbiter" } as const;

/** GET /api/risk as a server with a CoinMarketCap key answers it (lib/risk.ts RiskResponse), sized to the asked deposit. */
function riskFixture(url: URL) {
  const depositThb = Number(url.searchParams.get("depositThb"));
  const option = (asset: "USDT" | "BNB", dailyVol: number, buffer: number, thbPerToken: number) => ({
    asset, dailyVol, horizonDays: 30, cmcBuffer: buffer, cournotBuffer: 0, buffer, tier: buffer ? "high" : "stable", coverageFloorUsd: 0,
    explanation: [`${asset} daily volatility ≈ ${(dailyVol * 100).toFixed(2)} % (largest of CMC 24h, 7d/√7, 30d/√30 changes).`],
    depositThb: depositThb * (1 + buffer), depositTokens: (depositThb * (1 + buffer)) / thbPerToken,
  });
  const quote = (usd: number) => ({ usd, thb: usd * 34, percentChange24h: 0, percentChange7d: 0, percentChange30d: 0, lastUpdated: "2026-11-26T05:35:00.000Z" });
  return {
    cmc: { configured: true, ok: true, fetchedAt: "2026-11-26T05:35:00.000Z", cached: false, quotes: { USDT: quote(1), BNB: quote(560) } },
    rentalDays: Number(url.searchParams.get("days")),
    depositThb,
    options: { USDT: option("USDT", 0.0001, 0, 34), BNB: option("BNB", 0.0438, 0.31, 19_040) },
    cournot: { configured: true, live: "disabled", claim: "Will BNB fall below $430 at any time before the return date?", result: null },
  };
}

async function open(browser: Browser, view: (typeof VIEWS)[number], role: string, lease: Address) {
  const context = await browser.newContext({ viewport: view.viewport });
  await context.addCookies([{ name: "ke_lang", value: view.lang, url: ORIGIN }]);
  await context.addInitScript(([theme, r]) => (localStorage.setItem("keyescrow-theme", theme), localStorage.setItem("keyescrow.devRole", r)), [view.theme, role]);
  await context.route("**/api/risk?*", (route) => route.fulfill({ json: riskFixture(new URL(route.request().url())) }));
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  await page.goto(`${ORIGIN}/lease/${lease}`);
  return { context, page, problems };
}

for (const [state, { badge, ahead, make }] of Object.entries(STATES)) {
  test(`rental page, ${badge}: renter, owner and dispute desk on desktop and phone, light and dark`, async ({ browser }) => {
    test.setTimeout(240_000);
    const lease = await make();
    for (const [who, role] of Object.entries(ROLES)) {
      for (const view of VIEWS) {
        const label = `${state}-${who}-${view.name}`;
        const { context, page, problems } = await open(browser, view, role, lease);
        const banner = page.getByTestId("rental-banner");
        await expect(banner.getByTestId("status-badge"), label).toHaveText(badge);
        await expect(page.getByTestId(`dev-role-${role}`)).toHaveAttribute("aria-pressed", "true");
        // Everything that loads after the first paint: prices, the events and the risk answer.
        await expect(page.getByTestId("money-rate"), label).toBeVisible();
        if (state !== "created") await expect(page.getByTestId("timeline"), label).toBeVisible();
        if (state !== "settled") await expect(page.getByTestId("protection-summary"), label).toBeVisible();
        // In a dispute both parties' histories load into the side column.
        if (state === "disputed") await expect(page.getByTestId("party-histories").getByTestId("history-facts"), label).toHaveCount(2);
        await page.waitForLoadState("networkidle");

        // One banner, one money card, one timeline: what happened, then what is ahead with one step marked as now.
        await expect(banner).toHaveCount(1);
        await expect(page.getByTestId("price-source").and(page.locator("[data-testid='money-strip'] *"))).toHaveCount(1);
        await expect(page.getByTestId("return-plan").locator("li"), label).toHaveCount(ahead);
        await expect(page.getByTestId("return-plan").locator("[aria-current='step']"), label).toHaveCount(ahead ? 1 : 0);
        if (state === "settled") await expect(page.getByTestId("settlement")).toContainText("Got back");
        await expect(page.getByTestId("agreement")).toContainText("within 7 days");
        // No sideways scroll; if there is, name what sticks out.
        const wide = await page.evaluate(() =>
          document.documentElement.scrollWidth <= window.innerWidth
            ? []
            : [...document.querySelectorAll("body *")]
                .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
                .slice(0, 8)
                .map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute("data-testid") ?? e.className}] "${(e as HTMLElement).innerText?.slice(0, 40)}"`),
        );
        expect(wide, `${label}: sideways scroll`).toEqual([]);

        const box = async (id: string) => (await page.getByTestId(id).first().boundingBox())!;
        const [b, money] = [await box("rental-banner"), await box("money-strip")];
        const action = page.getByTestId("banner-action");
        const idle = (await action.getAttribute("data-kind")) === "idle";
        if (view.viewport.width > 1000) {
          expect(money.x, `${label}: money beside the banner`).toBeGreaterThanOrEqual(b.x + b.width);
          expect(money.y, `${label}: money starts level with the banner`).toBeLessThan(b.y + 8);
        } else {
          expect(money.y, `${label}: one column`).toBeGreaterThan(b.y + b.height - 1);
          expect(await audit(page), label).toEqual([]);
          if (!idle) {
            // The action is a bar at the bottom of the screen, wherever the page is scrolled, clear of the Ask AI bubble.
            for (const y of [0, 100_000]) {
              await page.evaluate((to) => window.scrollTo(0, to), y);
              const bar = (await action.boundingBox())!;
              expect(Math.round(bar.y + bar.height), `${label}: action bar at the bottom`).toBe(view.viewport.height);
              const [button, bubble] = [await box("banner-primary"), await box("assistant-bubble")];
              expect(button.x + button.width, `${label}: bar clear of the bubble`).toBeLessThanOrEqual(bubble.x);
              expect(button.height).toBeGreaterThanOrEqual(44);
            }
            // At the end of the page the bar covers nothing: the footer ends above it.
            const footer = (await page.locator("footer").last().boundingBox())!;
            expect(footer.y + footer.height, `${label}: page end above the bar`).toBeLessThanOrEqual((await action.boundingBox())!.y + 1);
            await page.evaluate(() => window.scrollTo(0, 0));
            // A full-page capture draws the fixed bar in the middle of the page: also save the first screen as it looks.
            await page.screenshot({ path: path.join(SHOTS, `${label}-first-screen.png`) });
          }
        }
        await page.screenshot({ path: path.join(SHOTS, `${label}.png`), fullPage: true });
        expect(problems, label).toEqual([]);
        await context.close();
      }
    }
  });
}

test("deposit protection: buffers at a glance, the full risk panel on demand; without a CoinMarketCap key it says so", async ({ browser, page }) => {
  const { context, page: withKey } = await open(browser, VIEWS[0], "tenant", demo.lease);
  const summary = withKey.getByTestId("protection-summary");
  await expect(summary.locator("[data-asset='USDT']")).toContainText("buffer 0%");
  await expect(summary.locator("[data-asset='BNB']")).toContainText("buffer 31%");
  await expect(withKey.getByTestId("cournot-panel")).toBeHidden();
  await summary.locator("summary").click();
  await expect(withKey.getByTestId("risk-BNB-buffer")).toHaveText("31%");
  await expect(withKey.getByTestId("cournot-panel")).toContainText("Will BNB fall below $430");
  await context.close();

  await page.goto(`/lease/${demo.lease}`);
  await expect(page.getByTestId("cmc-not-configured")).toBeVisible();
  await expect(page.getByTestId("protection-summary")).toHaveCount(0);
});
