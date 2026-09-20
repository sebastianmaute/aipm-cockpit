import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
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

// ★★★ THE HASH MUST STICK, OR THESE TWO VIEWS ARE SCANNED AS THE DASHBOARD AND
// NOTHING SAYS SO. `gotoApp` waits for <main> and the "Dashboard" nav entry,
// both gated on `i18nReady` — NOT on `hydrated`. `useHashView` is enabled only
// once `hydrated` is true, and its early return sits ABOVE the
// `addEventListener` calls, so its hashchange/popstate listeners do not exist
// before hydration. For `en-US` `loadI18n` resolves on a microtask while
// `hydrated` waits on the IndexedDB secret reads, so a bare
// `location.hash = h` can fire into a window with NO listener attached and be
// lost outright. The later cold apply then reads the view-only hash live,
// applies the stale-residue rule and lands on the DASHBOARD — and nothing
// downstream notices: `waitForViewSettled` polls <main>'s innerHTML for
// STABILITY, never for WHICH view, so axe passes on the Dashboard and
// `Next actions` / `Insights` go permanently unscanned on a green run.
//
// SELF-HEALING rather than merely loud: the loss is a race, and a red nobody
// can reproduce is worth less than a spec that repairs itself. Each round
// re-assigns the hash when the app has rewritten it away. Once a rewrite is
// observable the cold apply has necessarily already run, so the repair is
// heard.
//
// ★★ A ONE-SHOT `expect.poll(...).toBe(hash)` CANNOT DISCRIMINATE HERE, which
// is why this is a stability window instead. `location.hash = h` updates
// `location.hash` SYNCHRONOUSLY whether or not any listener heard it, so the
// first read after the assignment returns the expected value on BOTH the
// success and the failure path — a poll that stops at its first success just
// races the rewrite it exists to catch. Requiring the value to SURVIVE several
// consecutive reads spanning ~1 s outlasts the hydration window instead. That
// is the same stability heuristic `waitForViewSettled` already uses, applied to
// the one value that actually tells the two paths apart. Bounded on both axes,
// so a genuine regression (a disabled view, a broken parse) still fails red
// rather than spinning forever.
const HASH_STABLE_READS = 5;
const HASH_POLL_MS = 200;
const HASH_MAX_ROUNDS = 40; // ~8 s ceiling

async function settleHash(page: Page, hash: string, name: string): Promise<void> {
  let stable = 0;
  let rounds = 0;
  for (; rounds < HASH_MAX_ROUNDS && stable < HASH_STABLE_READS; rounds++) {
    // Read BEFORE repairing, and judge the streak on what was SEEN — a round
    // that had to repair must not count towards it, or the repair would
    // certify itself.
    const seen = await page.evaluate((h) => {
      const cur = window.location.hash;
      if (cur !== h) window.location.hash = h;
      return cur;
    }, hash);
    stable = seen === hash ? stable + 1 : 0;
    await page.waitForTimeout(HASH_POLL_MS);
  }
  expect(
    stable,
    `${name}: the hash never held at "${hash}" for ${HASH_STABLE_READS} consecutive reads ` +
      `(gave up after ${rounds} rounds x ${HASH_POLL_MS} ms). The app keeps rewriting it — ` +
      `almost certainly to "#dashboard", meaning the cold apply treated the view-only hash as ` +
      `stale session residue. Scanning now would have run axe against the Dashboard instead ` +
      `of ${name}, and passed.`,
  ).toBe(HASH_STABLE_READS);
}

// AIPM and Dashboard no longer exist in the app in any form — a theme is a file
// the user loads. The matrix runs on the four BUILT-IN schemes. Harbor/
// Meridian/Umber are dark-capable and ALL THREE run light AND dark. Umber-dark
// was MISSING from this matrix while `UMBER_DARK` was already imported above,
// already wired into SCHEME_SEED below, and BUILTIN_SCHEMES already marked
// umber `supportsDark: true` — so umber-dark was scanned in no view, ever,
// while everything around it read as covered. Beacon is LIGHT-ONLY by design
// (the app's default) and has no dark combo to add — there is nothing to scan.
// ★ 7 combos × 17 views = 119, + the Kanban-board scan below (ONE PER COMBO,
// its own `for (const combo of COMBOS)` loop — it scales with the combo count,
// it is NOT a fixed 5) = 126, + 1 notes-window toolbar scan + 1 Documents
// block-editor scan + 1 Reports cumulative-chart scan (all three harbor-light
// only, hardcoded — none scales with the combo count) = 129 `a11y:`-prefixed
// scans, + 1 chart-readout scan whose name does NOT carry that prefix (its
// name is asserted verbatim by the chart-hover-readout plan, so `grep -c
// "a11y:"` undercounts by exactly one) + the one non-scan guard below = 131
// tests.
// MEASURE it in the same commit that changes A11Y_VIEWS or adds a scan rather
// than deriving it — this comment said 85 for as long as the list said 16
// views, and a beacon-added-combo draft of this very comment still said "108
// scans / 109 tests" by carrying forward the pre-beacon "5 Kanban variants"
// instead of re-measuring. The 128/129 above were likewise MEASURED, not
// derived, in the commit that added the umber-dark combo, and 129/130
// re-measured when the Reports cumulative scan was added (§557). Reproduce
// (no browsers needed):
//   npx playwright test e2e/a11y.spec.ts --list   # 131 total
//   …then `grep -c "a11y:"` over that output       # 129 scans (+1 unprefixed)
const COMBOS = [
  { scheme: "harbor",   dark: false },
  { scheme: "harbor",   dark: true  },
  { scheme: "meridian", dark: false },
  { scheme: "meridian", dark: true  },
  { scheme: "umber",    dark: false },
  { scheme: "umber",    dark: true  },
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
        // Make the assignment STICK before scanning — see settleHash above.
        await settleHash(page, hash, name);
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
  // ★★★ THIS TEST NEEDS MORE THAN THE 60 s FILE DEFAULT, and the arithmetic is
  //   the reason rather than a hunch. The editor-chunk wait below is allowed
  //   30 s ON ITS OWN — half the whole budget — and it is the LAST thing this
  //   test does before scanning, after a cold first navigation (which
  //   `playwright.config.ts` documents as able to consume the 60 s by itself on
  //   a Turbopack compile), a view switch, a settle poll and the axe analyze.
  //   At the default, a run that is merely slow blows the budget and reports as
  //   "Test timeout of 60000ms exceeded" inside `page.evaluate` — a failure that
  //   names no rule and no impact, i.e. it reads exactly like a contention flake
  //   and nothing like the a11y violation it is not. Give the wait somewhere to
  //   fit so a red run here means a real finding.
  test.setTimeout(120_000);

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

// open-followups §184: the Documents block editor is a MODE toggle inside the
// Documents view, so the A11Y_VIEWS loop only ever scanned DocumentPreview.
// Every per-kind block editor and every gutter control was unscanned until
// this test.
// ★ A green scan here does NOT prove there are no duplicate accessible names —
// axe cannot see that in any view at any seed size (open-followups §144, §126,
// AGENTS.md's a11y bullet). Only a multi-row UNIT test can ever catch that
// class; document-block-gutter.test.tsx is where the gutter's names are pinned.
// ★★ WHICH document this opens is NOT the seeded 9001: documents-panel.tsx
// falls back to `selectionPool[0]`, and `selectionPool` is the UNSORTED
// `documents` array, so it lands on the sample master's id 1 — which already
// carries all six DocBlock kinds. e2e/seed.ts seeds all six on 9001 as well,
// so this scan covers every per-kind editor whichever one wins that fallback.
test("a11y: harbor-light — Documents (block editor)", async ({ page }) => {
  await page.addInitScript(seedScript(COMBOS[0]));

  await gotoApp(page);
  await openView(page, "Documents");
  // DOM-click the toggle (mirrors the two scans above) so the auto-launched
  // guided tour overlay cannot intercept a real pointer click. ★ The label is
  // PINNED to "Edit blocks" in BOTH states by design (documents-toolbar.tsx),
  // so matching on it is stable across the toggle flipping.
  const clickedEdit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "Edit blocks",
    );
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  });
  expect(clickedEdit, "Edit blocks toggle not found in Documents").toBe(true);
  await waitForViewSettled(page);

  // Assert the editor actually mounted — otherwise a broken toggle (or one
  // rendered `disabled`, which it is whenever no document is selected)
  // silently scans the preview and this becomes a no-op duplicate of the
  // existing "Documents" scan.
  expect(await page.locator("[data-block-row]").count()).toBeGreaterThan(1);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const summary = blocking
    .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join("\n");
  expect(blocking, `Documents block editor a11y violations:\n${summary}`).toEqual([]);
});

// §557: the Budget report's chart draws the recorded budget history (stepped
// line, change markers) only in the CUMULATIVE orientation, and the Reports
// scan in the A11Y_VIEWS loop sees the default burn-down. e2e/seed.ts seeds the
// history; this scan switches orientation and checks those surfaces too.
// ★ Same axe configuration as every scan above; harbor-light only, like the
// two scans before it.
test("a11y: harbor-light — Reports (budget chart, cumulative)", async ({ page }) => {
  await page.addInitScript(seedScript(COMBOS[0]));

  await gotoApp(page);
  await openView(page, "Reports");
  // DOM-click the radio (mirrors the scans above) so the auto-launched guided
  // tour overlay cannot intercept a real pointer click. Assert it was found so
  // a renamed control fails loudly instead of rescanning the burn-down chart.
  const clickedCumulative = await page.evaluate(() => {
    const group = document.querySelector('[role="radiogroup"][aria-label="Chart orientation"]');
    const radio = [...(group?.querySelectorAll('[role="radio"]') ?? [])].find(
      (r) => (r.textContent || "").trim() === "Cumulative",
    );
    if (!radio) return false;
    (radio as HTMLElement).click();
    return true;
  });
  expect(clickedCumulative, "Cumulative orientation radio not found in Reports").toBe(true);
  // Only the cumulative chart's name carries the recorded changes, so this
  // proves the stepped line and markers are on screen when axe runs.
  await expect(page.getByRole("img", { name: /Budget changes: / })).toHaveCount(1);
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
  expect(blocking, `Reports cumulative budget chart a11y violations:\n${summary}`).toEqual([]);
});

// Chart hover/keyboard readout (chart-hover-readout branch): the box and its
// SVG decorations (`[data-readout-guide]`/`[data-readout-dot]`) are taken out
// of the accessibility tree entirely (`TooltipSurface`'s `decorative` prop:
// `aria-hidden`, no `role`), so this scan is really checking the TRIGGER and
// the portaled box's STRUCTURE, not any content inside it — and it is what
// first caught `aria-tooltip-name`: the box used to keep `role="tooltip"`
// while hiding only its content, which left a nameless ARIA tooltip node in
// the tree. Re-adding that role here (without also re-adding an accessible
// name) must turn this scan red again — that is the mutation this test guards
// against, not merely renders beside.
// ★ Same axe configuration as every scan above; harbor-light only, like the
// two scans before it.
test("Reports with the chart readout open has no axe violations", async ({ page }) => {
  await gotoApp(page);
  await openView(page, "Reports");
  const trigger = page
    .getByTestId("report-block-budget-report")
    .getByRole("button", { name: /arrow keys/i });
  // `.focus()` auto-scrolls the trigger into view as part of Playwright's
  // actionability checks, unlike a raw `boundingBox()`/`mouse.move()` pair.
  await trigger.focus();
  await page.keyboard.press("ArrowRight");
  // Without this the scan can run before the box mounts and report GREEN over
  // markup that is not in the DOM — the silent no-op this file warns about.
  // The box carries no ARIA role, so its presence is checked via its own
  // `[data-readout-box]` hook, not `getByRole("tooltip")` — and not the
  // `[data-tooltip-portal]` hook every `TooltipSurface` sets, which would let
  // the scan pass with an unrelated tooltip up and the readout closed.
  await expect(page.locator("[data-readout-box]")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const summary = blocking
    .map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join("\n");
  expect(blocking, `Reports chart readout a11y violations:\n${summary}`).toEqual([]);
});
