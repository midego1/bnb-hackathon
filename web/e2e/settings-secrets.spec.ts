import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2E_SECRETS } from "./env";

/**
 * Write-only secrets page against temp env files (e2e/env.ts points SECRETS_ENV_FILE / SECRETS_WEB_ENV_FILE at
 * test-results/e2e-secrets, never a real .env). Saves a value, checks the page shows SET and never the value, that
 * no response body carries it, that the file got exactly one new line, and clears it again. Screenshots light/dark.
 */

const SHOTS = path.resolve(__dirname, "../test-results/screenshots/settings-secrets");
const ROOT_TEXT = "# repo-root .env (temp copy)\nBSC_TESTNET_RPC_URL=https://bsc-testnet.example/rpc\nDEPLOYER_ADDRESS=0x0000000000000000000000000000000000000001\n";
const WEB_TEXT = "# web/.env.local (temp copy)\nNEXT_PUBLIC_DEV_ACCOUNTS=1\n\n# prices\nCMC_API_KEY=\n";
const VALUE = "3f1c2b8e-9d4a-4c7b-8e2f-0a1b2c3d4e5f";

function seed() {
  rmSync(E2E_SECRETS.dir, { recursive: true, force: true });
  mkdirSync(E2E_SECRETS.dir, { recursive: true });
  writeFileSync(E2E_SECRETS.root, ROOT_TEXT, { mode: 0o600 });
  writeFileSync(E2E_SECRETS.web, WEB_TEXT, { mode: 0o600 });
}

/** Records every /api/settings response body so the test can prove none carries the value. */
function recordBodies(page: Page) {
  const bodies: string[] = [];
  page.on("response", async (res) => {
    if (!res.url().includes("/api/settings/")) return;
    bodies.push(await res.text().catch(() => ""));
  });
  return bodies;
}

async function unlock(page: Page) {
  await page.goto("/settings/secrets");
  await expect(page.getByTestId("secrets-unlock")).toBeVisible();
  await page.getByTestId("secrets-passcode").fill("wrong-passcode");
  await page.getByTestId("secrets-unlock-submit").click();
  await expect(page.getByTestId("secrets-unlock").getByRole("alert")).toHaveText("Wrong passcode.");
  const passcode = readFileSync(path.join(E2E_SECRETS.state, "secrets", "settings-passcode"), "utf8").trim();
  await page.getByTestId("secrets-passcode").fill(passcode);
  await page.getByTestId("secrets-unlock-submit").click();
  await expect(page.getByTestId("secret-CMC_API_KEY")).toBeVisible();
  return passcode;
}

test.beforeAll(seed);

test("secrets page: set shows SET, never the value; clear empties it", async ({ page }) => {
  const bodies = recordBodies(page);
  await page.goto("/");
  await expect(page.getByTestId("footer-settings")).toBeVisible();
  await expect(page.getByTestId("header-settings")).toBeHidden(); // no room in the header at 1280 (projector)
  await page.setViewportSize({ width: 1470, height: 900 });
  await expect(page.getByTestId("header-settings")).toBeVisible();
  const passcode = await unlock(page);

  const row = page.getByTestId("secret-CMC_API_KEY");
  await expect(row.getByTestId("secret-status")).toHaveText("NOT SET");
  await expect(row.getByTestId("secret-where")).toContainText("web/.env.local");
  await expect(row.getByTestId("secret-where")).toContainText("keyescrow-web-testnet");
  await expect(page.getByTestId("secret-INSPECTOR_PRIVATE_KEY").getByTestId("secret-status")).toHaveCount(2); // both files
  await expect(page.getByTestId("secret-BSC_TESTNET_RPC_URL").getByTestId("secret-status")).toHaveText("SET");

  // A bad value is refused without being echoed.
  await row.getByTestId("secret-input").fill("not-a-uuid-SECRETBAD");
  await row.getByTestId("secret-save").click();
  await expect(row.getByTestId("secret-error")).toContainText("Invalid value");
  await expect(row.getByTestId("secret-error")).not.toContainText("SECRETBAD");

  await row.getByTestId("secret-input").fill(VALUE);
  await row.getByTestId("secret-save").click();
  await expect(row.getByTestId("secret-saved")).toContainText("Saved at");
  await expect(row.getByTestId("secret-status")).toHaveText("SET");
  await expect(row.getByTestId("secret-input")).toHaveValue("");

  // The value went into the temp web/.env.local only, as one rewritten line; everything else is byte for byte.
  expect(readFileSync(E2E_SECRETS.web, "utf8")).toBe(WEB_TEXT.replace("CMC_API_KEY=\n", `CMC_API_KEY=${VALUE}\n`));
  expect(readFileSync(E2E_SECRETS.root, "utf8")).toBe(ROOT_TEXT);
  const audit = readFileSync(path.join(E2E_SECRETS.state, "reports", "secrets-audit.log"), "utf8");
  expect(audit).toContain("\tCMC_API_KEY\tset\t");
  expect(audit).not.toContain(VALUE);

  // Nothing the browser got back holds the value or the passcode, and a reload does not bring it back.
  await page.reload();
  await expect(page.getByTestId("secret-CMC_API_KEY").getByTestId("secret-status")).toHaveText("SET");
  expect(await page.content()).not.toContain(VALUE);
  expect(bodies.length).toBeGreaterThan(3);
  for (const b of bodies) {
    expect(b).not.toContain(VALUE);
    expect(b).not.toContain(passcode);
  }
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "keyescrow_secrets_session");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Strict");

  // Screenshots for the report (light and dark).
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => localStorage.setItem("keyescrow-theme", t), theme);
    await page.reload();
    await expect(page.getByTestId("secret-CMC_API_KEY")).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `secrets-${theme}.png`), fullPage: true });
  }
  await page.evaluate(() => localStorage.removeItem("keyescrow-theme"));

  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("secret-CMC_API_KEY").getByTestId("secret-clear").click();
  await expect(page.getByTestId("secret-CMC_API_KEY").getByTestId("secret-status")).toHaveText("NOT SET");
  expect(readFileSync(E2E_SECRETS.web, "utf8")).toBe(WEB_TEXT);

  await page.getByTestId("secrets-lock").click();
  await expect(page.getByTestId("secrets-unlock")).toBeVisible();
});

test("secrets API: locked without a session, refuses cross-site posts and unknown names", async ({ request, baseURL }) => {
  const res = await request.get("/api/settings/secrets");
  expect(res.status()).toBe(401);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const cross = await request.post("/api/settings/secrets", {
    data: { name: "CMC_API_KEY", value: VALUE },
    headers: { origin: "http://evil.example" },
  });
  expect(cross.status()).toBe(403);
  const proxied = await request.get("/settings/secrets", { headers: { "cf-connecting-ip": "1.2.3.4" } });
  expect(proxied.status()).toBe(403);
  const otherHost = await request.get("/api/settings/secrets", { headers: { host: "keyescrow.example.com" } });
  expect(otherHost.status()).toBe(403);
  const unknown = await request.post("/api/settings/secrets", { data: { name: "NEXT_PUBLIC_CHAIN_ID", value: "97" }, headers: { origin: baseURL! } });
  expect([400, 401]).toContain(unknown.status()); // 401 first: no session
  expect(readFileSync(E2E_SECRETS.web, "utf8")).toBe(WEB_TEXT);
});
