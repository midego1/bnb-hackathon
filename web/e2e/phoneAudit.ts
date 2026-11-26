import type { Page } from "@playwright/test";

/** The phone audit of e2e/phone.spec.ts (see its file comment for the rules), shared with e2e/rental-page.spec.ts. */

type Finding = string;

/** Everything wrong with what is on screen now (see the file comment). Runs in the page. `min`: the smallest control, in px (44 on a phone, 40 on an unfolded foldable, e2e/fold.spec.ts). */
export async function audit(page: Page, min = 44): Promise<Finding[]> {
  const found = await page.evaluate((min) => {
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
      // A checkbox or radio is tapped through its label: the label's box counts.
      const r = (el.matches("[type='checkbox'], [type='radio']") ? (el.closest("label") ?? el) : el).getBoundingClientRect();
      const hit = el.hasAttribute("data-hit") ? 24 : 0; // the ::after hit area reaches 12 px out on each side
      const s = getComputedStyle(el);
      const textLink = el.tagName === "A" && s.backgroundColor === "rgba(0, 0, 0, 0)" && parseFloat(s.borderTopWidth) === 0;
      const [minW, minH] = textLink ? [0, 24] : [min, min];
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
  }, min);
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
