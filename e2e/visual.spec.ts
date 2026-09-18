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
    // ★★★ SUPPRESS THE GUIDED TOUR, or this spec photographs the tour instead
    //   of the view. It auto-launches on a fresh device and drops a
    //   `fixed inset-0` overlay, so every capture here was a DIMMED page behind
    //   a "Welcome to the PM Tracker" modal — a ~0.71 whole-image delta that
    //   reads as a catastrophic layout regression and is nothing of the kind.
    //   ★★ Regenerating the baselines WITHOUT this is the trap: it bakes the
    //   modal in, hides the very UI these snapshots exist to guard, and goes
    //   red on any tour copy change. This spec predates the tour; the rest of
    //   e2e/ already suppresses it the same way (documents-images-interactive,
    //   meta-decode-loss, rich-text-toolbar-keyboard).
    //   ★ Settings are a SHALLOW merge over defaults, so this leaves
    //   storageConfig and everything else untouched. Must run BEFORE the goto
    //   inside gotoApp, which is why it is not folded into that helper.
    await page.addInitScript(() => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    });
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

// §557: the budget-history surfaces render only on Reports, and the stepped
// budget line and its change markers only in the CUMULATIVE orientation
// (`buildChartModel` skips `bacFields` for burn-down, the default). None of the
// whole-view snapshots above opens Reports, so this test photographs the Budget
// report block's chart (stepped line, markers, their labels) and its change table
// (rows and split rows), after switching orientation, from the history
// e2e/seed.ts authors. The Budget report puts the table full width BELOW its
// forecast row (card 30% beside chart 70% from `xl`, so side by side at this
// 1440px viewport), not inside `BurndownChartPanel` — the report sets its
// `detachChangeTable` and mounts `BurndownChangeTableBlock` under the row.
// ★ Element-scoped, so the rest of Reports cannot drift this baseline. Same
// determinism setup as the loop above (tour suppressed, frozen clock via
// gotoApp, fonts ready, animations off). `report-block-budget-report` is the
// test id Reports already stamps on every block (`testIdPrefix`).
test("visual: Reports budget history (cumulative)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
  await gotoApp(page);
  await openView(page, "Reports");
  const block = page.getByTestId("report-block-budget-report");
  await block
    .getByRole("radiogroup", { name: "Chart orientation", exact: true })
    .getByRole("radio", { name: "Cumulative", exact: true })
    .click();
  // Proves the switch landed before the capture: only the cumulative chart's
  // name carries the "Budget changes:" sentence.
  // ★ Built from `page`, not `block`: a `has:` locator is resolved RELATIVE to
  // each candidate, so a `block`-prefixed one looks for the block inside the
  // candidate and matches nothing (measured: the capture timed out).
  const chart = page.getByRole("img", { name: /Budget changes: / });
  const table = page.getByRole("table", { name: "Budget changes (€)", exact: true });
  await expect(block.locator(chart)).toHaveCount(1);
  // ★ TWO captures, each shorter than the block's scrolling body (497px
  // visible at this viewport, measured). An element capture is clipped to
  // that body: a single capture of the chart-and-table row showed a blank where
  // the table was, and the whole chart column (517px, with legend and notes)
  // lost its last caption line. So the chart capture is the INNERMOST `div`
  // holding the chart (`.last()`: a descendant follows its ancestors in
  // document order), i.e. the chart's caption and svg; the legend and notes
  // below it are not photographed.
  const chartFigure = block.locator("div").filter({ has: chart }).filter({ hasNot: table }).last();
  const changeTable = block.getByRole("region", { name: "Budget changes (€)", exact: true });
  await expect(changeTable.locator(table)).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);

  const options = { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.01 } as const;
  await expect(chartFigure).toHaveScreenshot("reports-budget-history.png", options);
  await expect(changeTable).toHaveScreenshot("reports-budget-changes.png", options);
});
