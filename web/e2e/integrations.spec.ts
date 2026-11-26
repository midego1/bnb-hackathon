import { expect, test } from "@playwright/test";

/**
 * Sponsor integrations with no keys (the e2e server blanks every sponsor env var): each one must say plainly
 * that it is not configured, and the risk engine must show no made-up numbers.
 */
test("integrations page shows honest not-configured states and no fake risk numbers", async ({ page }) => {
  await page.goto("/integrations");
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByTestId("cmc-not-configured")).toContainText("CMC_API_KEY");
  await expect(page.getByTestId("risk-BNB")).toHaveCount(0);
  await expect(page.getByTestId("cournot-panel")).toContainText("No Cournot answer is stored yet");
  await expect(page.getByTestId("cournot-ask")).toHaveCount(0); // live calls are off
  await expect(page.getByTestId("integration-cmc")).toHaveAttribute("data-state", "not-configured");
  await expect(page.getByTestId("integration-cournot")).toHaveAttribute("data-state", "off");
  await expect(page.getByTestId("integration-atlas")).toHaveAttribute("data-state", "not-configured");
  await expect(page.getByTestId("integration-livingbrain")).toHaveAttribute("data-state", "not-configured");
});

test("risk API refuses bad input and reports CMC as not configured", async ({ request }) => {
  expect((await request.get("/api/risk?depositThb=-1")).status()).toBe(400);
  const r = await (await request.get("/api/risk?depositThb=3000&days=30")).json();
  expect(r.cmc).toMatchObject({ configured: false });
  expect(r.options).toBeUndefined();
  const c = await request.post("/api/cournot", { data: { claim: "Will BNB fall below $450 at any time before 2026-12-26 00:00 UTC?", confirm: true } });
  expect(c.status()).toBe(409); // COURNOT_LIVE is off: no live call
});
