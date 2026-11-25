import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
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
  await page.goto("/app");
  await expect(page.getByTestId("footer-settings")).toBeVisible();
  // The sidebar's Settings row: in the expanded sidebar at 1280 (projector) and in the icon rail on /demo.
  const settings = page.getByTestId("sidebar-settings");
  await expect(settings).toBeVisible();
  await expect(settings).toHaveAttribute("href", "/settings/secrets");
  await page.goto("/demo");
  await expect(page.locator("html")).toHaveAttribute("data-sidebar", "collapsed");
  await expect(settings).toBeVisible();
  await expect(settings).toHaveAccessibleName("Settings");
  await page.setViewportSize({ width: 1470, height: 900 });
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
  // The page itself: not found through a proxy or from another Host; security headers from next.config.ts. The page
  // streams (Cache Components), so a refusal is the not-found page with noindex in a 200, never the secrets view; the
  // API below answers real 403s.
  const page = await request.get("/settings/secrets");
  expect(page.status()).toBe(200);
  expect(page.headers()["x-frame-options"]).toBe("DENY");
  expect(page.headers()["referrer-policy"]).toBe("no-referrer");
  expect(await page.text()).toContain('data-testid="secrets-page"');
  for (const headers of [{ "cf-connecting-ip": "1.2.3.4" }, { host: "keyescrow.example.com" }] as Record<string, string>[]) {
    const refused = await (await request.get("/settings/secrets", { headers })).text();
    expect(refused).not.toContain('data-testid="secrets-page"');
    expect(refused).toMatch(/<meta name="robots" content="noindex"/);
  }
  const otherHost = await request.get("/api/settings/secrets", { headers: { host: "keyescrow.example.com" } });
  expect(otherHost.status()).toBe(403);
  const unknown = await request.post("/api/settings/secrets", { data: { name: "NEXT_PUBLIC_CHAIN_ID", value: "97" }, headers: { origin: baseURL! } });
  expect([400, 401]).toContain(unknown.status()); // 401 first: no session
  expect(readFileSync(E2E_SECRETS.web, "utf8")).toBe(WEB_TEXT);
});

// ---------------------------------------------------------------------------------------------------------
// Key tests: every outside API goes to a local stub (SETTINGS_SECRETS_TEST_ORIGIN), so nothing leaves the machine.
// ---------------------------------------------------------------------------------------------------------

const GOOD_KEY = `sk-ant-api03-${"g".repeat(36)}good`;
const BAD_KEY = `sk-ant-api03-${"b".repeat(36)}baad`;

/** Stub of api.anthropic.com (/v1/models: 3 models for the good key, 401 otherwise) and a chain 97 RPC at /rpc. */
function startStub(): Promise<{ server: http.Server; hits: string[] }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/api.anthropic.com/v1/models")) {
      const ok = req.headers["x-api-key"] === GOOD_KEY && req.headers["anthropic-version"];
      res.statusCode = ok ? 200 : 401;
      res.end(JSON.stringify(ok ? { data: [{ id: "a" }, { id: "b" }, { id: "c" }] } : { type: "error", error: { type: "authentication_error" } }));
      return;
    }
    if (req.url === "/rpc" && req.method === "POST") {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x61" }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  return new Promise((resolve) => server.listen(E2E_SECRETS.stubPort, "127.0.0.1", () => resolve({ server, hits })));
}

test("key tests: Test checks the stored value, Test before saving checks the typed one without saving", async ({ page }) => {
  seed();
  const stub = await startStub();
  try {
    const bodies = recordBodies(page);
    await page.setViewportSize({ width: 1470, height: 900 });
    await unlock(page);
    const row = page.getByTestId("secret-ANTHROPIC_API_KEY");
    await expect(row.getByTestId("secret-test")).toBeDisabled(); // nothing stored yet

    // Test before saving: a wrong key is Invalid and nothing is written.
    await row.getByTestId("secret-input").fill(BAD_KEY);
    await row.getByTestId("secret-test-typed").click();
    const result = row.getByTestId("secret-test-result");
    await expect(result).toHaveAttribute("data-status", "invalid");
    await expect(result).toContainText("401 unauthorized");
    await expect(result).toContainText("typed value, not saved");
    expect(readFileSync(E2E_SECRETS.web, "utf8")).toBe(WEB_TEXT);

    // Save the good key, then Test checks the stored value.
    await row.getByTestId("secret-input").fill(GOOD_KEY);
    await row.getByTestId("secret-save").click();
    await expect(row.getByTestId("secret-status")).toHaveText("SET");
    await row.getByTestId("secret-test").click();
    await expect(result).toHaveAttribute("data-status", "valid");
    await expect(result).toContainText("3 models listed");
    await expect(result).toContainText("stored value");

    // An RPC URL typed in the field: chainId 97 from the stub.
    const rpcRow = page.getByTestId("secret-BSC_TESTNET_RPC_URL");
    await rpcRow.getByTestId("secret-input").fill(`http://127.0.0.1:${E2E_SECRETS.stubPort}/rpc`);
    await rpcRow.getByTestId("secret-test-typed").click();
    await expect(rpcRow.getByTestId("secret-test-result")).toHaveAttribute("data-status", "valid");
    await expect(rpcRow.getByTestId("secret-test-result")).toContainText("chainId 97");
    expect(readFileSync(E2E_SECRETS.root, "utf8")).toBe(ROOT_TEXT);

    // No free test for Cournot: Can't test, and the stub is never asked.
    const cournot = page.getByTestId("secret-COURNOT_API_KEY");
    await cournot.getByTestId("secret-input").fill("ck_live_abcdefgh1234");
    await cournot.getByTestId("secret-test-typed").click();
    await expect(cournot.getByTestId("secret-test-result")).toHaveAttribute("data-status", "untestable");
    await expect(cournot.getByTestId("secret-test-result")).toContainText("without spending credits");

    expect(stub.hits.filter((h) => h.includes("anthropic")).length).toBe(2);
    expect(stub.hits.some((h) => h.includes("cournot"))).toBe(false);
    for (const b of bodies) for (const v of [GOOD_KEY, BAD_KEY, "ck_live_abcdefgh1234"]) expect(b).not.toContain(v);
    const audit = readFileSync(path.join(E2E_SECRETS.state, "reports", "secrets-audit.log"), "utf8");
    expect(audit).toContain("\tANTHROPIC_API_KEY\ttested\ttyped:invalid\t");
    expect(audit).toContain("\tANTHROPIC_API_KEY\ttested\tstored:valid\t");
    expect(audit).not.toContain(GOOD_KEY);

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((t) => localStorage.setItem("keyescrow-theme", t), theme);
      await page.reload();
      await row.getByTestId("secret-test").click();
      await expect(result).toHaveAttribute("data-status", "valid");
      await page.getByTestId("secret-INSPECTOR_PRIVATE_KEY").scrollIntoViewIfNeeded();
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, `key-test-${theme}.png`) });
    }
    await page.evaluate(() => localStorage.removeItem("keyescrow-theme"));
  } finally {
    await new Promise((r) => stub.server.close(r));
  }
});
