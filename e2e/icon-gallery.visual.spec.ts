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
  await expect(page.locator("[data-icon-cell]")).toHaveCount(70);
  await page.evaluate(() => document.fonts.ready);

  await expect(page).toHaveScreenshot("icon-gallery.png", {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    // ★★★ Zero tolerance, both weaker settings measured first. `maxDiffPixelRatio: 0.01` on this
    // 1280x1400 shot budgets ~17,900 px; repointing four icon rows moved 1154 px and PASSED.
    // `maxDiffPixels: 100` is also too loose: Bell -> BellRing at `h-6 w-6`, under Playwright's
    // default per-pixel `threshold: 0.2`, differs by SIX pixels — so the budget that catches the
    // loud swaps is blind to the quiet ones. ★ 0 is affordable because this render is
    // deterministic — verify with `--repeat-each=5` in ONE invocation rather than chaining runs
    // (see the `/icon-gallery` landmine in AGENTS.md). If it genuinely flakes,
    // re-baseline; do NOT loosen, and never back to a ratio — a ratio scales with the page, so
    // adding icons silently buys more slack.
    maxDiffPixels: 0,
  });
});
