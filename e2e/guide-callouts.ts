import type { Locator, Page } from "@playwright/test";

// Highlight boxes for the install guide's screenshots (§713). A callout is a
// plain overlay div drawn over a control's bounding box in the page, so the
// screenshot shows it; it is removed again with clearCallouts. Brand token
// only (--ui-pink), no shadow, so the pictures stay on-palette.

const CALLOUT_ATTR = "data-guide-callout";

/** Draw a box over `target`, with an optional number in a round marker at its top-left. */
export async function markCallout(page: Page, target: Locator, n?: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("markCallout: the target has no bounding box (is it visible?)");
  await page.evaluate(
    ({ box, n, attr }) => {
      const pad = 4;
      const frame = document.createElement("div");
      frame.setAttribute(attr, "");
      Object.assign(frame.style, {
        position: "absolute",
        left: `${box.x + window.scrollX - pad}px`,
        top: `${box.y + window.scrollY - pad}px`,
        width: `${box.width + pad * 2}px`,
        height: `${box.height + pad * 2}px`,
        border: "3px solid var(--ui-pink)",
        borderRadius: "6px",
        pointerEvents: "none",
        zIndex: "2147483647",
        boxSizing: "border-box",
      });
      document.body.appendChild(frame);
      if (n === undefined) return;
      const marker = document.createElement("div");
      marker.setAttribute(attr, "");
      marker.textContent = String(n);
      Object.assign(marker.style, {
        position: "absolute",
        left: `${box.x + window.scrollX - pad - 11}px`,
        top: `${box.y + window.scrollY - pad - 11}px`,
        width: "22px",
        height: "22px",
        borderRadius: "50%",
        background: "var(--ui-pink)",
        color: "#ffffff",
        font: "bold 12px/22px sans-serif",
        textAlign: "center",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      document.body.appendChild(marker);
    },
    { box, n, attr: CALLOUT_ATTR },
  );
}

/** Remove every callout markCallout drew. */
export async function clearCallouts(page: Page): Promise<void> {
  await page.evaluate((attr) => {
    for (const el of document.querySelectorAll(`[${attr}]`)) el.remove();
  }, CALLOUT_ATTR);
}
