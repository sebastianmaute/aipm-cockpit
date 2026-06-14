import { test, expect, gotoApp, openView } from "./seed";

// Visual-regression snapshots for the most visual views. Determinism is the
// whole game here:
//   • seeded fixture  → fixed sample data (stable rows/colours)
//   • frozen clock    → "today"-dependent rendering (RAG, due-soon, "as of …")
//                       doesn't drift by run date
//   • fonts ready     → no glyph-swap flicker between baseline and run
//   • animations off  → toHaveScreenshot disables CSS animations/transitions
//   • masked version  → the sidebar version label changes every release
//
// NOTE ON BASELINES: Playwright snapshots are per-platform. Baselines committed
// here are generated on the maintainer's OS; CI runs the Linux Playwright
// container, which needs its own `*-linux.png` baselines — generate them once
// with `npm run e2e:visual:update` inside that container. This `visual` project
// is therefore NOT part of the default `npm run e2e` (functional) run.

const VISUAL_VIEWS = ["Dashboard", "Gantt", "Open Points"] as const;

test.use({ viewport: { width: 1440, height: 900 } });

for (const name of VISUAL_VIEWS) {
  test(`visual: ${name}`, async ({ page }) => {
    // gotoApp freezes the clock (see seed.ts FROZEN_NOW) for determinism.
    await gotoApp(page);
    await openView(page, name);

    // Wait for web fonts so text metrics match the baseline. No fixed sleep:
    // openView() already polls the DOM to a stable state, and toHaveScreenshot
    // auto-retries until two consecutive captures match — a fixed wait could
    // only ever scan mid-render (the flaky pattern fixed in seed.ts/a11y).
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(`${name.toLowerCase().replace(/\s+/g, "-")}.png`, {
      fullPage: false,
      animations: "disabled",
      caret: "hide",
      // The sidebar version label churns every release — exclude it.
      mask: [page.locator('button[title="Version history"]')],
      maxDiffPixelRatio: 0.01,
    });
  });
}
