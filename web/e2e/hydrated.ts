import { expect, type Locator } from "@playwright/test";

/**
 * Resolves once React has hydrated this element, so its event handlers are attached. A click or key that lands before
 * that is lost (the page is server-rendered, so the element is already visible and enabled); it happens under load,
 * e.g. --workers=2. Uses React DOM's internal `__reactProps$` key, which hydration sets on every host element.
 */
export async function hydrated(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))), { message: "React hydrated it" })
    .toBe(true);
}
