import AxeBuilder from "@axe-core/playwright";
import { test, expect, gotoApp, openView } from "./seed";

// Accessibility smoke gate: scan the critical views for WCAG 2.0/2.1 A & AA
// violations and fail on `critical`/`serious` STRUCTURAL issues (missing names,
// roles, labels, landmarks, etc.).
//
// `color-contrast` is computed and REPORTED but not gated: the palette is a hard
// brand constraint (only the 9 permitted AIPM colors — see the AIPM-color-palette
// note), so contrast is a design-level decision, not something a code change
// here can freely resolve. Track those findings separately; re-enable gating if
// the palette is ever adjusted for AA contrast.
const A11Y_VIEWS = ["Dashboard", "Open Points", "Gantt", "Resources", "Budget", "RAID", "Settings"] as const;
const UNGATED_RULES = new Set(["color-contrast"]);

for (const name of A11Y_VIEWS) {
  test(`a11y: ${name} has no critical/serious structural WCAG A/AA violations`, async ({ page }) => {
    await gotoApp(page);
    await openView(page, name);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );

    // Report (non-blocking) the brand-palette-constrained contrast findings.
    for (const v of serious.filter((v) => UNGATED_RULES.has(v.id))) {
      console.warn(`[a11y][${name}] ungated ${v.id}: ${v.nodes.length} node(s) — brand-palette constrained`);
    }

    const blocking = serious.filter((v) => !UNGATED_RULES.has(v.id));
    const summary = blocking
      .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      .join("\n");
    expect(blocking, `${name} structural a11y violations:\n${summary}`).toEqual([]);
  });
}
