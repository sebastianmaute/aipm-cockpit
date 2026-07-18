import AxeBuilder from "@axe-core/playwright";
import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";
import { readFileSync } from "node:fs";
import { HARBOR_DARK, HARBOR_LIGHT } from "../src/app/builtin-schemes";
import { resolveSchemeColors } from "../src/app/scheme-tokens";
import type { SchemeColorMap, SchemeStructuralMap } from "../src/app/scheme-apply";

const loadTheme = (f: string) =>
  JSON.parse(readFileSync(`public/themes/${f}`, "utf8")) as {
    light: SchemeColorMap;
    dark?: SchemeColorMap;
    structural: SchemeStructuralMap;
    supportsDark: boolean;
  };
const ICC_THEME = loadTheme("AIPM.json");
const MOCKUP_THEME = loadTheme("mockup.json");

// Accessibility gate: scan the critical views (with a DATA-SEEDED project, so
// colour-coded RAG/status states actually render) for WCAG 2.0/2.1 A & AA
// violations, failing on ANY `critical`/`serious` impact — structural (roles,
// names, labels, landmarks, ARIA) AND `color-contrast`, which now passes after
// the palette tuning, the status-chip rework (dark-blue text on the hue tint
// instead of same-hue text), and dropping the opacity-dim on completed rows.
const A11Y_VIEWS = ["Dashboard", "Open Points", "Gantt", "Resources", "Budget", "RAID", "Settings", "Stakeholders", "Changes", "Milestones", "Reports", "Activity", "Time bookings", "AI Assistant", "Next actions"] as const;

// Views reached by hash (not a top-level sidebar click): Dashboard sub-children
// whose sidebar entry may be collapsed at scan time. Navigating by hash mirrors
// the app's own deep-link path and lands the view deterministically.
const HASH_VIEW: Partial<Record<(typeof A11Y_VIEWS)[number], string>> = {
  "Next actions": "#actions",
};

// AIPM + Mockup are no longer built-in schemes: they ship as importable theme
// files (public/themes/*.json), read here at seed time and seeded as USER schemes
// (Harbor is the sole brand default / built-in). The style axis is the constant
// data-style="custom" and the active SCHEME drives the look. The 5-combo matrix
// scans the SAME visual coverage as before: AIPM (light+dark), Mockup (light-only),
// Harbor (light+dark, the fresh-install default). Represented as a scheme id + dark flag.
const COMBOS = [
  { scheme: "AIPM",    dark: false },
  { scheme: "AIPM",    dark: true  },
  { scheme: "mockup", dark: false },
  { scheme: "harbor", dark: false },
  { scheme: "harbor", dark: true  },
] as const;

// Per-scheme maps (AIPM/Mockup from the shipped theme JSON, Harbor imported; all
// resolved node-side at seed time — mirrors how the app persists them). Mockup is
// light-only (no dark map, supportsDark=0); AIPM/Harbor are dark-capable. Structural:
// AIPM reproduces the flat look, Mockup adds shadows/gradient, Harbor carries none ({}).
const SCHEME_SEED: Record<
  (typeof COMBOS)[number]["scheme"],
  { light: SchemeColorMap; dark?: SchemeColorMap; structural: SchemeStructuralMap; supportsDark: boolean }
> = {
  AIPM:    { light: ICC_THEME.light, dark: ICC_THEME.dark, structural: ICC_THEME.structural, supportsDark: true },
  mockup: { light: MOCKUP_THEME.light, structural: MOCKUP_THEME.structural, supportsDark: false },
  harbor: { light: HARBOR_LIGHT, dark: HARBOR_DARK, structural: {}, supportsDark: true },
};

const comboLabel = (combo: (typeof COMBOS)[number]): string =>
  `${combo.scheme}-${combo.dark ? "dark" : "light"}`;

// Build the pre-navigation localStorage seed for a combo. Every combo is now a
// scheme-driven "custom" style, so we seed the SAME keys the real boot script +
// use-style read: the constant style, the theme, the boot-readable dark-capable
// flag, the resolved color map, the structural map, AND the scheme store's
// activeId — the latter is essential because post-mount use-style.syncScheme
// re-resolves from aipm-cockpit:color-schemes and would otherwise snap back to the
// Harbor default, repainting the AIPM/Mockup scans. Built-in schemes come from
// reconcileBuiltins, so an empty schemes[] + the activeId selects them.
function seedScript(combo: (typeof COMBOS)[number]): string {
  const spec = SCHEME_SEED[combo.scheme];
  const useDark = combo.dark && spec.supportsDark;
  const map = resolveSchemeColors(useDark && spec.dark ? spec.dark : spec.light);
  // Harbor is a built-in (empty schemes[] + activeId selects it via reconcile);
  // AIPM/Mockup are shipped theme files -> seed them as user schemes so reconcile
  // keeps them and syncScheme doesn't snap back to Harbor.
  const store =
    combo.scheme === "harbor"
      ? { schemes: [], activeId: "harbor" }
      : {
          schemes: [
            {
              id: combo.scheme,
              name: combo.scheme,
              supportsDark: spec.supportsDark,
              light: spec.light,
              ...(spec.dark ? { dark: spec.dark } : {}),
              structural: spec.structural,
              branding: {},
            },
          ],
          activeId: combo.scheme,
        };
  return [
    `localStorage.setItem("aipm-cockpit-style", "custom");`,
    `localStorage.setItem("aipm-cockpit-theme", ${JSON.stringify(combo.dark ? "dark" : "light")});`,
    `localStorage.setItem("aipm-cockpit-scheme-supports-dark", ${JSON.stringify(spec.supportsDark ? "1" : "0")});`,
    `localStorage.setItem("aipm-cockpit-active-scheme-colors", ${JSON.stringify(JSON.stringify(map))});`,
    `localStorage.setItem("aipm-cockpit-active-scheme-structural", ${JSON.stringify(JSON.stringify(spec.structural))});`,
    `localStorage.setItem("aipm-cockpit:color-schemes", ${JSON.stringify(JSON.stringify(store))});`,
  ].join("\n");
}

for (const combo of COMBOS) {
  for (const name of A11Y_VIEWS) {
    test(`a11y: ${comboLabel(combo)} — ${name}`, async ({ page }) => {
      // Seed localStorage BEFORE the app navigates so the no-flash boot script
      // in layout.tsx reads the right style/theme and sets data-style/.dark.
      // addInitScript runs before every navigation, so this fires on the
      // page.goto("/") inside gotoApp — after the page fixture's favicon seed.
      await page.addInitScript(seedScript(combo));

      await gotoApp(page);
      const hash = HASH_VIEW[name];
      if (hash) {
        await page.evaluate((h) => { window.location.hash = h; }, hash);
        await waitForViewSettled(page);
      } else {
        await openView(page, name);
      }

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

// Kanban board is a MODE toggle inside Open Points (not a nav view), so it needs
// its own scan: open Open Points, switch to Board, then analyze.
for (const combo of COMBOS) {
  test(`a11y: ${comboLabel(combo)} — Open Points (Kanban board)`, async ({ page }) => {
    await page.addInitScript(seedScript(combo));

    await gotoApp(page);
    await openView(page, "Open Points");
    // DOM-click the Board toggle (mirrors openView) so the auto-launched guided
    // tour overlay can't intercept a real pointer click. Assert it was found so
    // a missing/renamed toggle fails loudly instead of silently scanning the
    // table view (which would make this a no-op duplicate of "Open Points").
    const clickedBoard = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => (b.textContent || "").trim() === "Board",
      );
      if (!btn) return false;
      (btn as HTMLElement).click();
      return true;
    });
    expect(clickedBoard, "Board toggle not found in Open Points").toBe(true);
    await waitForViewSettled(page);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    const summary = blocking
      .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      .join("\n");
    expect(blocking, `Kanban board a11y violations:\n${summary}`).toEqual([]);
  });
}
