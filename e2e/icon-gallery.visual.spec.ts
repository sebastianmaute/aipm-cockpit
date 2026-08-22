import { test, expect } from "@playwright/test";

// The permanent contact sheet. Opt-in (`npm run e2e:visual`), because Playwright
// baselines are per-platform — see the note at the top of visual.spec.ts.
//
// ★ A gallery is the most stable screenshot in this repo: no seeded data, no
// dates, no layout that depends on content. That is why it is a reasonable
// permanent baseline where the app-screen baselines have rotted.
test.use({ viewport: { width: 1280, height: 1400 } });

test("visual: icon gallery", async ({ page }) => {
  await page.goto("/icon-gallery");
  await expect(page.locator("[data-icon-cell]")).toHaveCount(69);
  await page.evaluate(() => document.fonts.ready);

  await expect(page).toHaveScreenshot("icon-gallery.png", {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    // ★★★ ZERO TOLERANCE, and both weaker settings were MEASURED before choosing.
    // This was `maxDiffPixelRatio: 0.01` — on a 1280x1400 full-page shot that is a
    // budget of ~17,900 pixels, and this sheet exists to catch a CHANGED GLYPH.
    // Repointing four icon rows at different lucide glyphs moved 1154 pixels and
    // the gate PASSED: it waved through precisely the class of change it is for.
    // ★★ The obvious repair, an absolute `maxDiffPixels: 100`, is ALSO too loose,
    // and only a mutant showed it. A gross swap costs ~290 pixels per glyph, but a
    // SUBTLE one costs far less: Bell -> BellRing at `h-6 w-6`, under Playwright's
    // default per-pixel `threshold: 0.2`, differs by SIX pixels. 6 < 100, so the
    // budget that catches the loud swaps is blind to the quiet ones — and the quiet
    // ones are the dangerous kind, since nobody spots them by eye either.
    // ★ 0 is affordable here because this render is deterministic: three clean runs
    // in a row at tolerance 0 passed, and the 6-pixel mutant failed. Do NOT trade it
    // back for a ratio — a ratio scales with the page, so adding icons silently buys
    // more slack. If this ever flakes on a new machine, re-baseline; do not loosen.
    maxDiffPixels: 0,
  });
});
