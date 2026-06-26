import AxeBuilder from "@axe-core/playwright";
import { test, expect, gotoApp, openView } from "./seed";

// Accessibility gate: scan the critical views (with a DATA-SEEDED project, so
// colour-coded RAG/status states actually render) for WCAG 2.0/2.1 A & AA
// violations, failing on ANY `critical`/`serious` impact — structural (roles,
// names, labels, landmarks, ARIA) AND `color-contrast`, which now passes after
// the palette tuning, the status-chip rework (dark-blue text on the hue tint
// instead of same-hue text), and dropping the opacity-dim on completed rows.
const A11Y_VIEWS = ["Dashboard", "Open Points", "Gantt", "Resources", "Budget", "RAID", "Settings", "Stakeholders", "Changes", "Milestones", "Reports", "Activity", "Time bookings"] as const;

// Every shipped style/theme combo is scanned. Mockup is light-only.
const COMBOS = [
  { style: "AIPM",    theme: "light" },
  { style: "AIPM",    theme: "dark"  },
  { style: "mockup", theme: "light" },
] as const;

for (const combo of COMBOS) {
  for (const name of A11Y_VIEWS) {
    test(`a11y: ${combo.style}/${combo.theme} — ${name}`, async ({ page }) => {
      // Seed localStorage BEFORE the app navigates so the no-flash boot script
      // in layout.tsx reads the right style/theme and sets data-style/.dark.
      // addInitScript runs before every navigation, so this fires on the
      // page.goto("/") inside gotoApp — after the page fixture's favicon seed.
      await page.addInitScript(`
        localStorage.setItem("lop-style", ${JSON.stringify(combo.style)});
        localStorage.setItem("lop-theme", ${JSON.stringify(combo.theme)});
      `);

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
}
