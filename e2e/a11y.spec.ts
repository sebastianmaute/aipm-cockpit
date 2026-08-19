import AxeBuilder from "@axe-core/playwright";
import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";
import {
  HARBOR_DARK, HARBOR_LIGHT,
  MERIDIAN_DARK, MERIDIAN_LIGHT,
  UMBER_DARK, UMBER_LIGHT,
  BEACON_LIGHT,
} from "../src/app/builtin-schemes";
import { resolveSchemeColors } from "../src/app/scheme-tokens";
import type { SchemeColorMap } from "../src/app/scheme-apply";
import { APP_VERSION } from "../src/app/version";

// Accessibility gate: scan the critical views (with a DATA-SEEDED project, so
// colour-coded RAG/status states actually render) for WCAG 2.0/2.1 A & AA
// violations, failing on ANY `critical`/`serious` impact — structural (roles,
// names, labels, landmarks, ARIA) AND `color-contrast`, which now passes after
// the palette tuning, the status-chip rework (dark-blue text on the hue tint
// instead of same-hue text), and dropping the opacity-dim on completed rows.
const A11Y_VIEWS = ["Dashboard", "Open Points", "Gantt", "Resources", "Budget", "RAID", "Settings", "Stakeholders", "Changes", "Milestones", "Reports", "Activity", "Time bookings", "AI Assistant", "Next actions", "Insights", "Documents"] as const;

// Views reached by hash (not a top-level sidebar click): Dashboard sub-children
// whose sidebar entry may be collapsed at scan time. Navigating by hash mirrors
// the app's own deep-link path and lands the view deterministically.
const HASH_VIEW: Partial<Record<(typeof A11Y_VIEWS)[number], string>> = {
  "Next actions": "#actions",
  Insights: "#insights",
};

// AIPM and Dashboard no longer exist in the app in any form — a theme is a file
// the user loads. The matrix runs on the four BUILT-IN schemes. Harbor/
// Meridian/Umber are dark-capable (Umber runs light-only here to hold the
// combo count down); Beacon is LIGHT-ONLY by design (the app's default) and
// has no dark combo to add — there is nothing to scan.
// ★ 6 combos × 17 views = 102, + the Kanban-board scan below (ONE PER COMBO,
// its own `for (const combo of COMBOS)` loop — it scales with the combo count,
// it is NOT a fixed 5) = 108, + 1 notes-window toolbar scan (harbor-light
// only, hardcoded — does NOT scale with combo count) = 109 scans, plus the one
// non-scan guard below = 110 tests. MEASURE it in the same commit that changes
// A11Y_VIEWS or adds a scan rather than deriving it — this comment said 85 for
// as long as the list said 16 views, and a beacon-added-combo draft of this
// very comment still said "108 scans / 109 tests" by carrying forward the
// pre-beacon "5 Kanban variants" instead of re-measuring. Reproduce (no
// browsers needed):
//   npx playwright test e2e/a11y.spec.ts --list   # 110 total
//   …then `grep -c "a11y:"` over that output       # 109 scans
const COMBOS = [
  { scheme: "harbor",   dark: false },
  { scheme: "harbor",   dark: true  },
  { scheme: "meridian", dark: false },
  { scheme: "meridian", dark: true  },
  { scheme: "umber",    dark: false },
  { scheme: "beacon",   dark: false },
] as const;

// Per-scheme maps, resolved node-side at seed time (mirrors how the app persists
// them). Built-ins carry no structural map.
const SCHEME_SEED: Record<
  (typeof COMBOS)[number]["scheme"],
  { light: SchemeColorMap; dark?: SchemeColorMap }
> = {
  harbor:   { light: HARBOR_LIGHT,   dark: HARBOR_DARK },
  meridian: { light: MERIDIAN_LIGHT, dark: MERIDIAN_DARK },
  umber:    { light: UMBER_LIGHT,    dark: UMBER_DARK },
  beacon:   { light: BEACON_LIGHT },
};

const comboLabel = (combo: (typeof COMBOS)[number]): string =>
  `${combo.scheme}-${combo.dark ? "dark" : "light"}`;

// The server under test must BE this checkout. playwright.config.ts sets
// reuseExistingServer outside CI, so a run can silently attach to a dev server
// left over from another worktree and report 85/85 about code that is not on
// this branch (open-followups §58). Necessary but NOT sufficient — two
// worktrees on the same version still agree — so keep pairing this with the
// PORT=3100 fresh-port convention AGENTS.md prescribes.
test("guard: the served app is this checkout", async ({ page }) => {
  await gotoApp(page);
  const served = await page.evaluate(
    () => document.documentElement.getAttribute("data-app-version"),
  );
  expect(
    served,
    `Served app reports version ${served ?? "(absent)"} but this checkout is ${APP_VERSION}. ` +
      `Playwright reused an existing server already answering on this port (a dev server from ` +
      `another worktree, or a leftover process in this one). Stop it, or run on a ` +
      `fresh port: PORT=3100 npm run dev (stop with PORT=3100 npm run stop). ` +
      `NOTE: a version MATCH does not prove the right server — two worktrees on the same ` +
      `version agree. The fresh-port convention still applies.`,
  ).toBe(APP_VERSION);
});

// Build the pre-navigation localStorage seed for a combo. Every combo is now a
// scheme-driven "custom" style, so we seed the SAME keys the real boot script +
// use-style read: the constant style, the theme, the boot-readable dark-capable
// flag, the resolved color map, the structural map, AND the scheme store's
// activeId — the latter is essential because post-mount use-style.syncScheme
// re-resolves from aipm-cockpit:color-schemes and would otherwise snap back to the
// default scheme, repainting a scan under the wrong palette.
function seedScript(combo: (typeof COMBOS)[number]): string {
  const spec = SCHEME_SEED[combo.scheme];
  const useDark = combo.dark && !!spec.dark;
  const map = resolveSchemeColors(useDark && spec.dark ? spec.dark : spec.light);
  // Every combo is a BUILT-IN now, so an empty schemes[] plus the activeId is
  // enough — reconcileBuiltins injects the scheme. Seeding aipm-cockpit:color-schemes
  // is still essential: post-mount, use-style.syncScheme re-resolves from it and
  // would otherwise overwrite the boot paint (scheme landmine 4).
  const store = { schemes: [], activeId: combo.scheme };
  return [
    `localStorage.setItem("aipm-cockpit-style", "custom");`,
    `localStorage.setItem("aipm-cockpit-theme", ${JSON.stringify(combo.dark ? "dark" : "light")});`,
    `localStorage.setItem("aipm-cockpit-scheme-supports-dark", ${JSON.stringify(spec.dark ? "1" : "0")});`,
    `localStorage.setItem("aipm-cockpit-active-scheme-colors", ${JSON.stringify(JSON.stringify(map))});`,
    `localStorage.setItem("aipm-cockpit-active-scheme-structural", ${JSON.stringify(JSON.stringify({}))});`,
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

// open-followups §144(b): seed one RichTextEditor toolbar into the a11y run.
// Every one of the app's 12 mounts sits behind a modal, an unscanned nav view,
// a non-default Settings section, or a closed <details> — none is reachable by
// the A11Y_VIEWS loop above. This is the cheapest reachable one: the floating
// notes window, opened from a seeded task's notes badge on Open Points.
// ★ A green scan here does NOT prove no duplicate accessible names exist —
// axe cannot see that at any seed size (open-followups §144, §126, AGENTS.md's
// a11y bullet). It only proves this ONE toolbar clears the structural rules.
test("a11y: harbor-light — Open Points (Notes window rich-text toolbar)", async ({ page }) => {
  await page.addInitScript(seedScript(COMBOS[0]));

  await gotoApp(page);
  await openView(page, "Open Points");
  // DOM-click the notes badge (mirrors the Kanban-board test above) so the
  // auto-launched guided tour overlay can't intercept a real pointer click.
  // Assert it was found so a missing/renamed button fails loudly instead of
  // silently scanning the Open Points table (a no-op duplicate of the
  // existing "Open Points" scan).
  const clickedNotesBadge = await page.evaluate(() => {
    const btn = document.querySelector(
      'button[aria-label="Notes log – Design SSO architecture"]',
    );
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  });
  expect(clickedNotesBadge, "Notes badge button not found on Open Points").toBe(true);
  await waitForViewSettled(page);

  // ★★★ `waitForViewSettled` IS STRUCTURALLY BLIND TO THIS WINDOW, so it cannot be
  // what gates the scan. It polls <main>'s innerHTML for stability, and
  // <NotesWindow> renders inside `modalsBlock` — a SIBLING of <ModernShell>,
  // whose <main> wraps only banners + content. It therefore returns after its
  // ~240 ms floor whether or not the window ever opened. Since the editor moved
  // behind `rich-text-editor-lazy.tsx` it also arrives over the NETWORK, against
  // a dev server that may compile the chunk on demand — so with no explicit wait
  // axe scans `RichTextEditorFallback` and reports GREEN over a toolbar that is
  // not in the DOM. That is the same silent no-op the badge assertion above
  // exists to prevent, one layer deeper. Locator matches the one
  // `rich-text-toolbar-keyboard.spec.ts` already drives on this surface.
  await expect(page.getByRole("button", { name: "Text style" }).first()).toBeVisible({
    timeout: 30_000,
  });

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const summary = blocking
    .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join("\n");
  expect(blocking, `Notes window a11y violations:\n${summary}`).toEqual([]);
});
