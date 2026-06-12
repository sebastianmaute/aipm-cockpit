import AxeBuilder from "@axe-core/playwright";
import { test, expect, gotoApp, openView } from "./seed";

// Accessibility gate: scan the critical views for WCAG 2.0/2.1 A & AA
// violations and fail on any `critical`/`serious` impact — including
// `color-contrast`, which now passes after the palette was tuned for AA (a
// darker `--muted-foreground` and an `--AIPM-green-strong` for green text on
// light surfaces; see globals.css).
//
// NOTE: these run against a freshly-seeded EMPTY project, so data-dependent
// colour states (RAG amber/red text, completed-task greens, etc.) aren't
// exercised here. A data-seeded a11y pass would widen contrast coverage.
const A11Y_VIEWS = ["Dashboard", "Open Points", "Gantt", "Resources", "Budget", "RAID", "Settings"] as const;

for (const name of A11Y_VIEWS) {
  test(`a11y: ${name} has no critical/serious WCAG A/AA violations`, async ({ page }) => {
    await gotoApp(page);
    await openView(page, name);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    const summary = blocking
      .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      .join("\n");
    expect(blocking, `${name} a11y violations:\n${summary}`).toEqual([]);
  });
}
