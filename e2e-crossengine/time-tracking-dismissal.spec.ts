import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoApp, openView } from "../e2e/seed";
import { FOCUSABLE_SELECTOR } from "../src/app/focusables";

/**
 * CROSS-ENGINE dismissal behaviour of the Time tracking dialog
 * (`src/app/task-time-tracking-modal.tsx`), which STACKS over the task form
 * modal (`src/app/task-form-modal.tsx`).
 *
 * ★★★ WHY THIS FILE IS NOT IN THE UNIT SUITE, AND WHY IT IS NOT IN `e2e/`.
 * Both surfaces run their Escape and Tab handlers as `document` keydown
 * listeners, arbitrated by `dismissal-stack.ts`. Two properties of that design
 * are only observable in a real engine:
 *
 *   - Tab CONTAINMENT is a browser DEFAULT ACTION. The trap in `modal.tsx`
 *     intervenes only at the two EDGES of its focusable list; every non-edge
 *     Tab is handled by the engine's own sequential-navigation algorithm, which
 *     jsdom does not implement at all. A jsdom test therefore cannot observe
 *     where a non-edge Tab actually lands — only whether a handler ran.
 *   - The dialog is PORTALED to `document.body` (0.283.x), so it is NOT a DOM
 *     descendant of the task form. Sequential navigation order and the form's
 *     `container.contains(active)` test both turn on that real DOM position.
 *
 * ★★★ WHAT DISCRIMINATES, AND WHAT IS STRUCTURALLY BLIND.
 * `docs/AGENTS/ui-shell.md` states it and this file obeys it: ANY assertion
 * about FINAL focus after a Tab is blind to the `isTopmostOfKind` gate. Both
 * traps are `document` keydown listeners firing in REGISTRATION order, and the
 * dialog registers SECOND (it opens later), so it runs LAST and silently
 * corrects whatever an ungated form trap just did — focus ends up back inside
 * the dialog either way. The shape that survives that is a NON-EDGE Tab whose
 * assertion names the EXACT control focus must reach: with the gate deleted the
 * form's trap fires `first.focus()` on the form, the dialog's trap then fires
 * `first.focus()` on itself, and focus lands on the dialog's FIRST control
 * rather than on the next one. "Still inside the dialog" is true in both worlds;
 * "landed on index i+1" is not. Both are asserted below — the first as the
 * WCAG 2.4.3 statement, the second as the thing that can actually go red.
 *
 * ★★ MUTATION-PROVED. Two one-line mutants in `src/app/modal.tsx`, applied and
 * reverted one at a time, each run over both projects at one worker:
 *
 *   (1) Escape: `if (!claimsEscape(e, token)) return;` → the guard removed, so
 *       every open Modal acts on Escape. The task form's listener is registered
 *       FIRST and closes the form; "the task form is still open" goes RED.
 *       MEASURED 2026-09-05: 2 failed / 4 passed — the Escape test FAILED in
 *       BOTH engines ("Error: Escape reached the task form beneath"), and both
 *       Tab tests stayed green.
 *   (2) Tab: `if (!isTopmostOfKind(token, "modal")) return;` removed, so the
 *       form beneath keeps trapping while the dialog is open. MEASURED: 4
 *       failed / 2 passed — both Tab tests FAILED in BOTH engines, the Escape
 *       test stayed green. ★★ WHICH ASSERTION FAILED IS THE WHOLE POINT: the
 *       red was "Tab did not advance to the next control — Expected 2,
 *       Received 0", and the containment assertion IMMEDIATELY ABOVE IT never
 *       fired, i.e. focus really was still inside the dialog. That is the
 *       blindness described above, measured rather than argued. (Shift+Tab
 *       landed on the dialog's LAST control instead — received 6 in chromium
 *       and 5 in firefox. ★ THOSE TWO NUMBERS PREDATE THE MIC SUPPRESSION and
 *       have not been re-measured under a mutant since; they differed only
 *       because the dialog header then rendered a `VoiceCommandButton`, which
 *       is focusable in one engine and `disabled` in the other. The dialog's
 *       header no longer renders one at all, so the engine divergence is gone
 *       — see the measurement in the Tab test below. The reason no assertion
 *       here depends on the focusable total, or on any absolute index but the
 *       non-edge start, is unchanged and is why this file stayed green.)
 *
 * ★★ TWO MUTANTS THE BRIEF FOR THIS FILE SUGGESTED AND WHICH DO NOT WORK, kept
 * here so nobody re-derives them:
 *   - Removing `zIndex={50}` from the dialog changes NO dismissal behaviour.
 *     Escape and Tab are routed by the dismissal stack, never by paint order,
 *     and the dialog is portaled to the END of `<body>` so it still paints on
 *     top at the inherited z-index of 40. It is a purely visual knob.
 *   - Mounting the dialog UNCONDITIONALLY (`open={open}` instead of
 *     `{open && …}`) does not invert the stack either: `Modal`'s push effect is
 *     `if (!open) return` keyed on `[open]`, so an `open={false}` instance
 *     pushes nothing and the push still happens on the click, after the form's.
 *     That guard is load-bearing for STATE freshness (both `EffortField`s seed
 *     their text once via a lazy `useState`), which is a different property and
 *     is pinned by the unit tests.
 *
 * ★ No `data-testid` and no faked internal state: every locator below is a
 * role + accessible name a user's AT would use, and the dialog is reached by
 * the same two clicks a person makes.
 */

/** U+2013 EN DASH — the app's accessible-name separator (`rowLabel` in
 *  `src/app/row-tokens.ts`; the names below are hand-built to the same shape).
 *  An escape, so the codepoint is explicit and no editing tool can corrupt it. */
const NDASH = "\u2013";

/** `task-form-modal.tsx` — `ariaLabel` for the CREATE case, `t(lang,
 *  "tabNewTask")`. The dialog under test stacks over this one, and every
 *  assertion here is ultimately about which of the two a key reaches. */
const TASK_FORM = "New task";

/** `task-time-tracking-modal.tsx` — the dialog's `ariaLabel`,
 *  `t(lang, "taskTimeTracking")`. Also the `role="group"` name of the field
 *  that holds its trigger; the two never collide because the roles differ. */
const TIME_TRACKING = "Time tracking";

/** `task-time-tracking-button.tsx` — `t(lang, "taskTimeTrackingButton",
 *  effortCaption(...))`, i.e. `"Time tracking: {0}"` filled with the caption the
 *  bar prints. A brand-new task has no estimate, so `effortCaption` returns
 *  `t(lang, "taskEffortNoEstimate")`.
 *  ★ Deliberately the FULL name rather than a substring: Playwright's
 *  `getByRole` `name` defaults to `exact: false` (a case-insensitive
 *  SUBSTRING), the opposite of testing-library, and every locator in this file
 *  passes `exact: true`. */
const TT_TRIGGER = `${TIME_TRACKING}: No estimate set`;

/** `task-time-tracking-modal.tsx` `qualifyWithTitle` — the dialog's Cancel is
 *  name-qualified because the task form beneath renders an unqualified one
 *  (WCAG 2.4.6 / speech input). Asserted below so a regression that drops the
 *  qualification is caught by the surface that motivated it. */
const TT_CANCEL = `Cancel ${NDASH} ${TIME_TRACKING}`;

/** `task-time-tracking-modal.tsx` — the ✕, `alertModalClose` qualified the same
 *  way. */
const TT_CLOSE = `Close ${NDASH} ${TIME_TRACKING}`;

/**
 * Suppress the auto-launched guided tour, whose `fixed inset-0` overlay
 * intercepts real pointer clicks. Every interaction in this file is a real
 * pointer or keyboard event by design, so the DOM-click workaround the a11y
 * spec uses is not available here.
 *
 * ★ Settings are a SHALLOW merge over defaults (`use-settings.ts`), so this one
 * key leaves `storageConfig` and — load-bearing for this file —
 * `fieldVisibility` at their defaults. `DEFAULT_TIER` is `"advanced"`
 * (`field-visibility.ts`) and the `timeSpent` field is `tier: "advanced"`
 * (`modal-fields.ts`), so the Time tracking control is visible with NO tier cog
 * interaction at all. Seeding `fieldVisibility` at a lower tier would hide it.
 *
 * Call BEFORE gotoApp — the init script has to land before the app boots.
 */
async function seedTourSeen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
}

/** The task form modal and the Time tracking dialog, as locators. */
function taskForm(page: Page): Locator {
  return page.getByRole("dialog", { name: TASK_FORM, exact: true });
}
function timeTrackingDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: TIME_TRACKING, exact: true });
}

/**
 * Open a new task in the task form modal, then open the Time tracking dialog
 * stacked over it. Returns once BOTH are provably on screen.
 *
 * ★★ ANTI-VACUITY. Every test below is worthless if it never reached the
 * dialog, and a green run over a dialog that never opened is worse than no
 * spec: `toHaveCount(0)` after Escape would pass trivially, and a Tab
 * assertion would fail for an unrelated reason and be "fixed" by relaxing it.
 * So this asserts the dialog is visible AND that the task form is STILL open
 * underneath — the stacked state is the premise of the whole file.
 */
async function openTimeTrackingDialog(page: Page): Promise<void> {
  await seedTourSeen(page);
  await gotoApp(page);
  await openView(page, "Open Points");

  // ★ `.first()` is REQUIRED, not defensive: `tasks-section.tsx` renders TWO
  // controls whose accessible name is exactly "Add task" (the toolbar
  // `AddButton` and the table's trailing add row). Both now use ONE key
  // (`addTaskButton`) at two sites — the trailing row used to be mis-keyed to
  // `addTask`, the modal's SUBMIT verb — so the count is unchanged and this is
  // still a strict-mode violation without `.first()`. The repeat is deliberate
  // and WCAG 2.4.6-conformant: identical purpose, identical handler. The
  // modal's submit no longer joins them; it is qualified as "Add task – New
  // task", which also keeps THIS locator from matching it once the form opens.
  await page.getByRole("button", { name: "Add task", exact: true }).first().click();
  await expect(taskForm(page)).toBeVisible();

  const trigger = page.getByRole("button", { name: TT_TRIGGER, exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();

  await expect(timeTrackingDialog(page)).toBeVisible();
  // The stack premise: the dialog is layered OVER a form that is still open.
  await expect(taskForm(page)).toBeVisible();
}

/**
 * Tag every focusable in the dialog with its index and return the tags.
 *
 * ★★ THE SELECTOR IS IMPORTED FROM THE APP, not retyped. `modal.tsx`'s Tab trap
 * enumerates with `FOCUSABLE_SELECTOR`; computing "the next control" from a
 * hand-copied selector would make this test's notion of order silently diverge
 * from the trap's on any future edit to that constant, and the test would then
 * be asserting something the product never claimed.
 *
 * ★ A `data-*` attribute is inert for focus: it is not `[tabindex]`, so tagging
 * cannot change which elements the selector matches or their order.
 */
const INDEX_ATTR = "data-tt-focus-index";

async function tagFocusables(dialog: Locator): Promise<string[]> {
  return dialog.evaluate((root, selector) => {
    const els = [...root.querySelectorAll<HTMLElement>(selector)];
    els.forEach((el, i) => el.setAttribute("data-tt-focus-index", String(i)));
    return els.map(
      (el) =>
        el.getAttribute("aria-label") ??
        el.getAttribute("placeholder") ??
        el.textContent?.trim() ??
        el.tagName,
    );
  }, FOCUSABLE_SELECTOR);
}

/** The tagged index of `document.activeElement`, or null when focus is on
 *  something outside the tagged set (which includes the task form beneath). */
function activeFocusIndex(page: Page): Promise<number | null> {
  return page.evaluate((attr) => {
    const raw = document.activeElement?.getAttribute(attr);
    return raw === null || raw === undefined ? null : Number(raw);
  }, INDEX_ATTR);
}

/** Is `document.activeElement` inside the dialog with this accessible label?
 *  ★ Asked of the LIVE DOM rather than of a locator: the question is about
 *  `document.activeElement`, which no locator can express. */
function activeIsInDialog(page: Page, label: string): Promise<boolean> {
  return page.evaluate((name) => {
    const dialog = document.querySelector(`[role="dialog"][aria-label="${name}"]`);
    const el = document.activeElement;
    return !!dialog && !!el && dialog.contains(el);
  }, label);
}

test.describe("Time tracking dialog dismissal, in a real engine", () => {
  test("Escape closes the dialog and leaves the task form open", async ({ page }) => {
    // ★★★ THE ROUTING ASSERTION. Escape is a DISMISSAL and exactly one layer
    // must act on it (`dismissal-stack.ts`). The task form's `document`
    // listener is registered FIRST and therefore RUNS first; what stops it
    // closing is `claimsEscape` answering "the dialog owns this key", not
    // listener phase and not `stopPropagation`. Routing Escape to the wrong
    // layer here does not merely close the wrong thing — it discards the
    // user's whole in-progress task edit.
    //
    // MUTATION-PROVED — see this file's header, mutant (1): removing the
    // `claimsEscape` guard fails the second assertion below in BOTH engines.
    await openTimeTrackingDialog(page);

    await page.keyboard.press("Escape");

    await expect(timeTrackingDialog(page)).toHaveCount(0);
    await expect(taskForm(page), "Escape reached the task form beneath").toBeVisible();
  });

  test("a non-edge Tab lands on the dialog's next control", async ({ page }, testInfo) => {
    // ★★★ THE SHAPE THAT DISCRIMINATES — see this file's header. The index
    // assertion is the one that can go red; the containment assertion beside it
    // is the WCAG 2.4.3 statement and is BLIND to the gate on its own.
    await openTimeTrackingDialog(page);

    const dialog = timeTrackingDialog(page);
    const labels = await tagFocusables(dialog);

    // ★★ REPORTED, NOT ASSERTED — asserting a COUNT or a POSITION here would
    // pin the machine rather than the product, and that stays true even now
    // that the two engines agree.
    // MEASURED 2026-09-05, AFTER the nested-header mic suppression: BOTH
    // engines enumerate the same SIX focusables in the same order — ✕, Time
    // spent, the remaining box's hint trigger, Time remaining, Cancel, Save.
    // ★★ THIS USED TO DIVERGE and the divergence is what the suppression
    // removed. The dialog's `ModalHeader` previously rendered a
    // `VoiceCommandButton` at index 0, `disabled={!supported}` off a probe of
    // `window.SpeechRecognition`; firefox has none, so it rendered disabled and
    // `FOCUSABLE_SELECTOR`'s `button:not([disabled])` skipped it — seven in
    // chromium against six in firefox, from an identical DOM under an identical
    // selector, differing only by feature detection. `hideVoiceCommand` on this
    // dialog's header removed the control on both, because a second mic
    // collided with the task form's on an unqualified shared name.
    // ★★★ Nothing below may still be rewritten to name a control by index. The
    // engines agreeing today is not a guarantee: any control whose rendering
    // turns on a feature probe re-opens exactly this gap, and this file asserts
    // only that Tab moves ONE STEP from a NON-EDGE start.
    const summary = JSON.stringify({ project: testInfo.project.name, labels }, null, 2);
    console.log(`[time tracking dismissal] dialog focusables:\n${summary}`);
    await testInfo.attach("time-tracking-dialog-focusables", {
      body: summary,
      contentType: "application/json",
    });

    // ★ A non-edge start needs at least three focusables, and index 1 is then
    // neither `first` nor `last` — the two cases `modal.tsx`'s trap acts on. A
    // test starting at an EDGE would exercise the wrap, which is a different
    // (and engine-independent) property.
    expect(labels.length, `dialog focusables: ${JSON.stringify(labels)}`).toBeGreaterThanOrEqual(3);

    // The names the dialog qualifies to avoid colliding with the task form's
    // own Close/Cancel — asserted here because this is the one surface in the
    // app where those two names are rendered twice at once.
    expect(labels, "the dialog's Close is not title-qualified").toContain(TT_CLOSE);
    expect(labels, "the dialog's Cancel is not title-qualified").toContain(TT_CANCEL);

    // Position focus explicitly rather than relying on the modal's open-time
    // autofocus: `gotoApp` installs a fake clock, and that focus rides a
    // `requestAnimationFrame`. The assertion is about where a REAL Tab keypress
    // moves focus, so only the starting point is set programmatically.
    await dialog.locator(`[${INDEX_ATTR}="1"]`).focus();
    expect(await activeFocusIndex(page), "focus did not reach the non-edge start").toBe(1);

    await page.keyboard.press("Tab");

    // (a) WCAG 2.4.3 — focus never escapes into the disabled form beneath.
    //     ★★ TRUE UNDER THE GATE MUTANT TOO (measured); it is stated, not relied on.
    expect(
      await activeIsInDialog(page, TIME_TRACKING),
      "Tab escaped the Time tracking dialog",
    ).toBe(true);
    // (b) THE DISCRIMINATOR: the engine's own sequential navigation ran, so
    //     focus advanced by exactly one. Under the mutant this reads 0 — the
    //     form's trap wrapped to its own first control and the dialog's trap
    //     then wrapped to ITS first, which is inside the dialog and passes (a).
    expect(await activeFocusIndex(page), "Tab did not advance to the next control").toBe(2);
  });

  test("a non-edge Shift+Tab lands on the dialog's previous control", async ({ page }) => {
    // The mirror of the test above, and NOT redundant: `modal.tsx`'s trap has a
    // separate `e.shiftKey` branch with its own edge test and its own wrap
    // target, so a defect can live in one branch alone.
    await openTimeTrackingDialog(page);

    const dialog = timeTrackingDialog(page);
    const labels = await tagFocusables(dialog);
    expect(labels.length, `dialog focusables: ${JSON.stringify(labels)}`).toBeGreaterThanOrEqual(3);

    // Index 1 again: non-edge in BOTH directions, so neither branch of the trap
    // should act and the engine's own backwards navigation is what runs.
    await dialog.locator(`[${INDEX_ATTR}="1"]`).focus();
    expect(await activeFocusIndex(page), "focus did not reach the non-edge start").toBe(1);

    await page.keyboard.press("Shift+Tab");

    expect(
      await activeIsInDialog(page, TIME_TRACKING),
      "Shift+Tab escaped the Time tracking dialog",
    ).toBe(true);
    // Under the gate mutant this reads `labels.length - 1`: the form's trap
    // wraps to its own last control and the dialog's trap then wraps to ITS
    // last, which is still inside the dialog.
    expect(await activeFocusIndex(page), "Shift+Tab did not step back one control").toBe(0);
  });
});
