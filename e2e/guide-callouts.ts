import type { Locator, Page } from "@playwright/test";

// Highlight boxes for the install guide's screenshots (§713). A callout is an
// outline drawn ON the target element, not an overlay beside it: the views
// scroll inside their own containers, and an overlay placed at the target's
// page position drifts off it as soon as the crop scrolls. Brand token only
// (--ui-pink), no shadow, so the pictures stay on-palette.

const CALLOUT_ATTR = "data-guide-callout";

/** Outline `target` in the brand pink. Throws if it is not rendered. */
export async function markCallout(target: Locator): Promise<void> {
  await target.evaluate((el, attr) => {
    const style = (el as HTMLElement).style;
    el.setAttribute(attr, `${style.outline}|${style.outlineOffset}`);
    style.outline = "3px solid var(--ui-pink)";
    style.outlineOffset = "3px";
  }, CALLOUT_ATTR);
}

/** Remove every callout markCallout drew, restoring the element's own outline. */
export async function clearCallouts(page: Page): Promise<void> {
  await page.evaluate((attr) => {
    for (const el of document.querySelectorAll<HTMLElement>(`[${attr}]`)) {
      const [outline = "", offset = ""] = (el.getAttribute(attr) ?? "").split("|");
      el.style.outline = outline;
      el.style.outlineOffset = offset;
      el.removeAttribute(attr);
    }
  }, CALLOUT_ATTR);
}
