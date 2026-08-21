import { test, expect } from "@playwright/test";

// The gallery's CI-side assertions. No screenshot here on purpose: Playwright
// baselines are per-platform and the `visual` project is opt-in, so anything
// that must run on every pipeline has to be a plain assertion.
//
// ★★ The stroke-width check is the ONLY proof the globals.css pin works. jsdom
// has no CSS, so no unit test in this repo can observe it, in either the CSS or
// the LucideProvider design.
test.describe("icon gallery", () => {
  test("renders every barrel icon", async ({ page }) => {
    await page.goto("/icon-gallery");
    await expect(page.locator("[data-icon-cell]")).toHaveCount(69);
  });

  test("★★ pins every icon to the heroicons stroke weight of 1.5", async ({ page }) => {
    await page.goto("/icon-gallery");
    const svg = page.locator("[data-icon-cell] svg").first();
    await expect(svg).toBeVisible();

    const widths = await page.locator("[data-icon-cell] svg").evaluateAll((nodes) =>
      Array.from(new Set(nodes.map((n) => getComputedStyle(n).strokeWidth))),
    );
    expect(widths).toEqual(["1.5px"]);
  });

  test("keeps every gallery glyph out of the accessibility tree", async ({ page }) => {
    await page.goto("/icon-gallery");
    const exposed = await page.locator("[data-icon-cell] svg").evaluateAll((nodes) =>
      nodes.filter((n) => n.getAttribute("aria-hidden") !== "true").length,
    );
    expect(exposed).toBe(0);
  });
});
