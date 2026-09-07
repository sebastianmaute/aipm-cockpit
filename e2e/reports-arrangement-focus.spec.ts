import { test, expect, gotoApp, openView } from "./seed";
import { REPORTS_LAYOUT_KEY } from "../src/app/report-blocks";

/**
 * The `focusAfterMove` / `triggerRefs` probe that `docs/open-followups.md` owed
 * — and the measurement that REFUTES the reason it was owed.
 *
 * ★★★ THE REGISTER SAID "only a Playwright probe could cover it". IT DOES NOT.
 * Measured 2026-09-07 in Chromium against a live dev server, one mutant at a
 * time, whole file each run:
 *   - clean tree                                    → 1 passed
 *   - delete `setFocusAfterMove({ id })`            → **1 passed — SURVIVES**
 *   - delete `arrangement.move(id, visibleIds[j])`  → 1 failed, at the order
 *     poll below
 * The third line is a POSITIVE CONTROL and it is the reason the second one can
 * be believed: it proves an edit to `reports.tsx` actually reaches the served
 * bundle, so the surviving mutant is a real absence of a detector and not a
 * stale `.next` serving pre-mutation output. Without it the second line is
 * indistinguishable from broken plumbing — the failure mode that wears the
 * gate's name.
 *
 * ★★★ SO THERE IS NO DETECTOR FOR THIS MECHANISM AT ANY LAYER — not jsdom, not
 * a real browser — and the hypothesis that predicted one was wrong. The
 * reasoning recorded in `reports.test.tsx` runs: `PopoverPanel` restores focus
 * to its anchor on unmount, React reorders a keyed list by MOVING the existing
 * DOM nodes so that anchor is still connected, and jsdom therefore cannot tell
 * the machinery from its absence — but a real browser BLURS a moved element,
 * which would make the restore insufficient. The first three clauses hold. The
 * conclusion does not: the blur (if any) happens before the primitive's restore
 * runs, and the restore then re-focuses a node that is live and correctly
 * positioned. The primitive covers this path in Chromium exactly as it does in
 * jsdom.
 *
 * ★★ WHAT THAT DOES AND DOES NOT LICENCE. It does NOT say `focusAfterMove` is
 * dead code — it says nothing here exercises a path where the popover is not
 * the focus owner, and `moveByDelta` has no other caller today. A surviving
 * mutant is a QUESTION ("equivalent mutant" and "missing test" look identical
 * from the harness), and answering it needs an input this suite does not have.
 * Do NOT delete the machinery on the strength of this file; do NOT cite this
 * file as coverage for it either.
 *
 * ★★ WHY IT IS KEPT ANYWAY: it pins a real OUTCOME that nothing else pins in a
 * browser — after a KEYBOARD move, focus is on the moved block's own ⋮ trigger
 * at its new position rather than on `<body>` — and the positive control proves
 * that assertion is non-vacuous about the outcome. That is worth having; it is
 * simply not the mechanism guard the register asked for.
 *
 * ★★ THE ASSERTION IS ON `document.activeElement`, NOT A LOCATOR-SCOPED
 * `toBeFocused()`, and the difference is load-bearing. The failure mode is focus
 * landing on `<body>`; a locator assertion says only that one specific button is
 * not focused, while reading the active element back NAMES where focus went, so
 * a red run distinguishes "no focus at all" from "focus on the wrong block".
 */

/** Tailwind `xl`: the four-column board, so the seeded row renders as authored. */
const XL = 1600;

/**
 * A board seeded so the move is unambiguous, and so the ORDER assertions below
 * cannot be satisfied by an accident of the default layout.
 *
 * ★ All three are BUILT-IN blocks, which `isRenderable` never gates — they read
 * from `tasks`, which the seed always provides. An addable report (raid/budget/
 * resource/stakeholder) depends on `settings.reports.extra` and would render an
 * empty board here.
 * ★★ Every other catalogue id is HIDDEN, not merely omitted: `reconcile`
 * re-inserts any catalogue block absent from BOTH lists, next to its nearest
 * present neighbour, which would silently rewrite this order. The four addable
 * ids are listed too — they are catalogue members like the rest.
 * ★ Every span is inside its own min/max so `reconcile` cannot clamp it and
 * change what renders.
 */
const FOCUS_LAYOUT = {
  v: 1,
  board: [
    { id: "openByStatus", w: 2, h: 2 },
    { id: "byPriority", w: 2, h: 1 },
    { id: "stats", w: 4, h: 1 },
  ],
  hidden: [
    "groupHealth",
    "completionOutcomes",
    "inquiries",
    "byAssignee",
    "byGroup",
    "byLabel",
    "raid-report",
    "budget-report",
    "resource-report",
    "stakeholder-report",
  ],
};

/** The block this test moves. Index 1, so "Move earlier" is enabled. */
const MOVED_TITLE = "By priority";

/**
 * The ⋮ trigger's accessible name, built the way `arrangement-tile.tsx` builds
 * it: `${actionMoreActions} – ${title}`. ★ The separator is an EN DASH (U+2013),
 * the repo's row-qualifier convention — a hyphen here matches nothing and the
 * test fails on a missing element rather than on focus.
 */
const triggerName = (title: string) => `More actions – ${title}`;

/** DOM order of the rendered blocks, which IS the board order. */
async function blockOrder(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-testid^='report-block-']")].map((e) =>
      e.getAttribute("data-testid"),
    ),
  );
}

test.describe("reports arrangement keyboard focus", () => {
  test.beforeEach(async ({ page }) => {
    // ★ `e2e-1` is the project id the registry seed in seed.ts installs, and
    // workspace-section passes `currentProjectId ?? "default"` straight through
    // — a layout stored under any other key is loaded by nothing and this test
    // would silently measure the DEFAULT arrangement instead.
    await page.addInitScript(
      ([key, layout]) => {
        localStorage.setItem(key as string, JSON.stringify({ "e2e-1": layout }));
      },
      [REPORTS_LAYOUT_KEY, FOCUS_LAYOUT] as const,
    );
    await page.setViewportSize({ width: XL, height: 1000 });
    await gotoApp(page);
    await openView(page, "Reports");
  });

  test("returns focus to the moved block's own menu trigger", async ({ page }) => {
    // Guard: the seed has to have taken. If `reconcile` rewrote the board, the
    // hidden blocks would still be on it and the order assertions below would be
    // comparing the wrong things.
    await expect(page.getByTestId("report-block-byAssignee")).toHaveCount(0);
    expect(await blockOrder(page)).toEqual([
      "report-block-openByStatus",
      "report-block-byPriority",
      "report-block-stats",
    ]);

    // ★★ `press` focuses the element and then dispatches a REAL key event, which
    // is the path under test — a `.click()` would exercise the pointer path,
    // where landing on `<body>` afterwards costs a mouse user nothing and the
    // whole mechanism is pointless.
    const trigger = page.getByRole("button", { name: triggerName(MOVED_TITLE), exact: true });
    await expect(trigger).toHaveCount(1);
    await trigger.press("Enter");

    const moveEarlier = page.getByRole("button", { name: "Move earlier", exact: true });
    await expect(moveEarlier).toHaveCount(1);
    await moveEarlier.press("Enter");

    // The move committed — without this the focus assertion below could pass
    // over a board where nothing happened at all.
    await expect.poll(() => blockOrder(page)).toEqual([
      "report-block-byPriority",
      "report-block-openByStatus",
      "report-block-stats",
    ]);

    // …and focus is on the moved block's own trigger, at its NEW position.
    const active = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? null,
      label: document.activeElement?.getAttribute("aria-label") ?? null,
    }));
    expect(active.tag).toBe("BUTTON");
    expect(active.label).toBe(triggerName(MOVED_TITLE));
  });
});
