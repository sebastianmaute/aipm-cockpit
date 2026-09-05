import type { Page } from "@playwright/test";
import { test, expect, gotoApp, openView } from "../e2e/seed";

/**
 * CROSS-ENGINE popover focus behaviour — `src/app/popover-panel.tsx`.
 *
 * ★★★ WHY THIS FILE IS NOT IN `e2e/`, AND NOT IN THE UNIT SUITE.
 * jsdom's element-removal focus semantics are FIREFOX's: neither dispatches
 * `focusout` when a focused element is removed from the document. CHROMIUM
 * does, synchronously, with `relatedTarget === null` — before `remove()`
 * returns and therefore before React's passive effect cleanup runs. The panel's
 * unmount guard records "is focus inside me?" eagerly via `focusin`/`focusout`
 * and reads that recorded answer in its cleanup, so a handler that treats a
 * null `relatedTarget` as "focus left" clears the flag in Chromium ONLY and the
 * restore silently becomes a no-op in the browser most users are on. Every one
 * of the 96 jsdom tests over this component stays green through that, because
 * jsdom cannot reach the branch at all.
 *
 * So the ONLY measurement that can tell the two engines apart is a real browser
 * in each. That is what this file is, and it is run by
 * `playwright.crossengine.config.ts` (`npm run e2e:crossengine`), never by the
 * `e2e` job — see that config's header for why the projects are not merged into
 * `playwright.config.ts`.
 *
 * ★★ WHICH TEST IS THE DIVERGENT ONE, because they are NOT interchangeable and
 * three of the four here would pass with the fix reverted:
 *
 *   - "restores focus … when the panel unmounts" is THE one. It closes the
 *     panel through the UNMOUNT GUARD (a width resize — one of the three paths
 *     that guard covers, alongside ancestor-scroll and a consumer closing from
 *     an item's own handler), which is the only path whose correctness depends
 *     on the null-`relatedTarget` line.
 *   - "restores focus … on Escape" pins a DIFFERENT mechanism:
 *     `closeRestoringFocus` focuses the anchor BEFORE calling `onClose`, so the
 *     unmount guard is not what saves that path and the test is insensitive to
 *     the null-`relatedTarget` line by construction. Kept because it is real
 *     behaviour worth pinning cross-engine, NOT because it detects §297.
 *   - "does not yank focus back after an outside click" pins the §146
 *     OBSERVABLE, and — MEASURED, see its own comment — pins NO line: deleting
 *     the explicit `focusInsideRef.current = false` from the outside-mousedown
 *     listener leaves it GREEN in both engines.
 *   - "keeps Tab inside the portaled panel" pins §100 and is not about focusout
 *     at all.
 *
 * Anyone adding a case here: say in its own comment which line of
 * `popover-panel.tsx` it would go red for, and MUTATE that line to prove it —
 * three mutants were run against the four tests below and the results are
 * recorded on each. One of the three killed nothing, which is the reason this
 * paragraph is not a formality: the case it was supposed to cover had already
 * been written up here as covered before anyone ran it.
 */

/** U+2013 EN DASH — the app's accessible-name separator (`rowLabel` in
 *  `src/app/row-tokens.ts`; the names below are hand-built to the same shape).
 *  An escape, so the codepoint is explicit and no editing tool can corrupt it. */
const NDASH = "\u2013";

/** `export-menu.tsx` — the top-bar trigger's `aria-label`, `t(lang, "exportTitle")`. */
const EXPORT_TRIGGER = "Export tasks";
/** `modal-field-controls.tsx` — `` `${tierLabel} – ${configureFields}` ``. The
 *  tier is the visible label and leads the accessible name (WCAG 2.5.3); with
 *  nothing seeded into `fieldVisibility`, `tierOf` falls back to
 *  `DEFAULT_TIER` ("advanced" — `field-visibility.ts`), so the tier reads
 *  "Advanced". Seeding that slice would change this string. */
const FIELDS_TRIGGER = `Advanced ${NDASH} Configure fields`;

/**
 * Suppress the auto-launched guided tour, whose `fixed inset-0` overlay
 * intercepts real pointer clicks — and this file's whole subject is what real
 * pointer and keyboard input do, so a DOM-click workaround is not available to
 * it the way it is to the a11y spec.
 *
 * ★ Settings are a SHALLOW merge over defaults (`use-settings.ts`), so writing
 * this single key leaves `storageConfig` and everything else at its default and
 * the workspace still loads from the IndexedDB seed.
 *
 * Call BEFORE gotoApp — the init script has to land before the app boots.
 */
async function seedTourSeen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
}

/** Is `document.activeElement` the button carrying this accessible label?
 *  ★ Both tag and label are checked: the export PANEL is a `role="dialog"`
 *  carrying the SAME `aria-label` as its trigger, so a label-only test would
 *  not distinguish "focus went back to the trigger" from "focus is on the still
 *  open panel". */
function activeIsTrigger(page: Page, label: string): Promise<boolean> {
  return page.evaluate((name) => {
    const el = document.activeElement;
    return el?.tagName === "BUTTON" && el.getAttribute("aria-label") === name;
  }, label);
}

/** Is `document.activeElement` inside the panel with this accessible label? */
function activeIsInPanel(page: Page, label: string): Promise<boolean> {
  return page.evaluate((name) => {
    const panel = document.querySelector(`[role="dialog"][aria-label="${name}"]`);
    const el = document.activeElement;
    return !!panel && !!el && panel.contains(el);
  }, label);
}

/** Open the top-bar export popover and leave focus where `autoFocus` put it.
 *  Returns once focus is provably INSIDE the panel — every test below is
 *  vacuous otherwise, since the unmount guard only ever acts on focus it
 *  recorded as inside. */
async function openExportPopover(page: Page): Promise<void> {
  await page.getByRole("button", { name: EXPORT_TRIGGER, exact: true }).click();
  await expect(page.getByRole("dialog", { name: EXPORT_TRIGGER, exact: true })).toBeVisible();
  // `autoFocus` (default true) focuses the panel's first control on open.
  await expect
    .poll(() => activeIsInPanel(page, EXPORT_TRIGGER), { timeout: 5_000 })
    .toBe(true);
}

test.describe("PopoverPanel focus, in a real engine", () => {
  test("restores focus to the trigger when the panel unmounts with focus inside", async ({ page }) => {
    // ★★★ THE DIVERGENT TEST. Everything else in this file passes with the
    // null-`relatedTarget` guard deleted; this one does not, in Chromium.
    //
    // The close path is a WIDTH RESIZE, which `popover-panel.tsx` handles by
    // calling `onClose()` and nothing else — so the ONLY thing that can put
    // focus back on the trigger is the effect cleanup's
    // `if (focusInsideRef.current) focusAnchor()`. Delete
    // `if (e.relatedTarget === null) return;` from `onOut` and Chromium's
    // removal-time `focusout` clears that flag first, so the restore never
    // fires and focus is left on `<body>`.
    //
    // ★ Escape would NOT do: it routes through `closeRestoringFocus`, which
    // moves focus to the anchor before closing and therefore hides the defect.
    // That is a real trap — the obvious spelling of this test is green under
    // the mutant.
    //
    // MEASURED with that mutant applied (`npm run e2e:crossengine`, both
    // projects, one worker): [chromium] FAILED here — "Timeout 5000ms exceeded
    // while waiting on the predicate", focus left on `<body>` — while
    // [firefox] PASSED, and so did the other three tests in BOTH engines. That
    // 1-of-8 asymmetry IS the engine divergence, and it is the only thing in
    // this repo that can show it.
    await seedTourSeen(page);
    await gotoApp(page);
    await openExportPopover(page);

    const before = page.viewportSize();
    expect(before).not.toBeNull();
    // ★ A modest shrink (120px off ~1280). The trigger has to stay MOUNTED and
    // visible: `.focus()` on a `display:none` element is a silent no-op, so a
    // narrow-enough viewport to collapse the top bar would turn a passing
    // restore into a phantom failure.
    await page.setViewportSize({ width: before!.width - 120, height: before!.height });

    await expect(page.getByRole("dialog", { name: EXPORT_TRIGGER, exact: true })).toHaveCount(0);
    await expect
      .poll(() => activeIsTrigger(page, EXPORT_TRIGGER), { timeout: 5_000 })
      .toBe(true);
  });

  test("restores focus to the trigger on Escape", async ({ page }) => {
    // Pins `closeRestoringFocus`, NOT the unmount guard — see this file's
    // header. Insensitive to the null-`relatedTarget` line by construction.
    await seedTourSeen(page);
    await gotoApp(page);
    await openExportPopover(page);

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog", { name: EXPORT_TRIGGER, exact: true })).toHaveCount(0);
    await expect
      .poll(() => activeIsTrigger(page, EXPORT_TRIGGER), { timeout: 5_000 })
      .toBe(true);
  });

  test("does not yank focus back to the trigger after an outside click", async ({ page }) => {
    // The complement of the two above (§146): an outside click is a deliberate
    // move AWAY, so restoring focus to the trigger would steal it from whatever
    // the user just clicked.
    //
    // ★★★ THIS TEST PINS THE OBSERVABLE AND NO LINE, AND THE FIRST VERSION OF
    // THIS COMMENT CLAIMED OTHERWISE. It said the outside-mousedown listener's
    // explicit `focusInsideRef.current = false` was what it detects. MEASURED
    // by deleting exactly that line: 8/8 still passed, in BOTH engines. What
    // actually keeps focus off the trigger here is the click's own
    // default-action blur, which lands BEFORE React commits the close and
    // leaves the recorded containment answer false on its own.
    // ★★ That does NOT make the line redundant — `popover-panel.tsx`'s own
    // comment is explicit that the point of setting it is to stop depending on
    // React's passive-flush scheduling relative to a browser default action.
    // It makes the line's effect UNOBSERVABLE from here, which is a different
    // thing and worth saying plainly rather than leaving a false coverage
    // claim standing over it.
    await seedTourSeen(page);
    await gotoApp(page);
    await openExportPopover(page);

    // Bottom-right corner of the main region: reliably outside both the anchor
    // and the (top-right, `w-72`) panel. The assertion is "NOT the trigger", so
    // it holds whether this lands on empty padding or on some other control.
    const main = page.locator("main").first();
    const box = await main.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width - 6, box!.y + box!.height - 6);

    await expect(page.getByRole("dialog", { name: EXPORT_TRIGGER, exact: true })).toHaveCount(0);
    // Give any (incorrect) restore a chance to happen before asserting it did
    // not: `expect.poll` on a negative would pass on the first sample.
    await page.waitForTimeout(300);
    expect(await activeIsTrigger(page, EXPORT_TRIGGER)).toBe(false);
  });

  test("keeps Tab inside the portaled panel when it is opened from a modal", async ({ page }) => {
    // §100. `PopoverPanel` portals to `document.body`, so an enclosing Modal's
    // Tab trap — which guards on `container.contains(active)` — reads false for
    // EVERY element in the panel, not merely at its boundary, and its "focus
    // escaped" branch used to throw the user straight back into the modal on
    // the first Tab. The fix is the panel declaring `kind: "modal"` to the
    // dismissal stack (so `isTopmostOfKind` makes the modal beneath defer) plus
    // its own Tab cycle.
    //
    // ★★ MUTATION-PROVED, and engine-INDEPENDENT (unlike the first test in this
    // file): flipping that one token — `kind: "modal"` → `kind: "layer"` in the
    // `useDismissable` call — fails this test in BOTH [chromium] and [firefox]
    // with "focus escaped the popover after 1 Tab press(es)", which is exactly
    // the symptom §100 describes. The other three tests stayed green under it.
    await seedTourSeen(page);
    await gotoApp(page);
    await openView(page, "Open Points");

    // ★ `.first()` is REQUIRED, not defensive: `tasks-section.tsx` renders TWO
    // controls whose accessible name is exactly "Add task" — the toolbar
    // `AddButton` (`addTaskButton`) and the table's trailing add row
    // (`addTask`), two distinct i18n keys that both resolve to "Add task" in
    // EN. Without it this is a strict-mode violation, and it is a real
    // duplicate-accessible-name collision in a shipped view.
    await page.getByRole("button", { name: "Add task", exact: true }).first().click();

    const trigger = page.getByRole("button", { name: FIELDS_TRIGGER, exact: true });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const panel = page.getByRole("dialog", { name: "Configure fields", exact: true });
    await expect(panel).toBeVisible();
    await expect
      .poll(() => activeIsInPanel(page, "Configure fields"), { timeout: 5_000 })
      .toBe(true);

    // Press past the last focusable so the cycle has to WRAP — a fixed small
    // count would never leave the panel even with the trap deleted, and the
    // test would pass for the wrong reason.
    const focusables = await panel.evaluate(
      (el) =>
        el.querySelectorAll(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ).length,
    );
    expect(focusables).toBeGreaterThan(1);

    for (let i = 0; i < focusables + 2; i++) {
      await page.keyboard.press("Tab");
      expect(
        await activeIsInPanel(page, "Configure fields"),
        `focus escaped the popover after ${i + 1} Tab press(es)`,
      ).toBe(true);
    }
  });
});
