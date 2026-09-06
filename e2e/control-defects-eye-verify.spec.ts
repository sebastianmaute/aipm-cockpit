import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";

// Browser eye-verify for open-followups §414 (the control-defects batch). Each
// item there is a layout/hover/native-tooltip claim jsdom cannot observe. This
// spec converts the ones that CAN be driven headlessly into real assertions;
// items 5 and 6 stay owed (see the bottom of the file) because they need a
// Turso-backed seed that `./seed` does not provide.
//
// These are FINDINGS, not fixes — a failing assertion here is a legitimate
// result about the shipped code, not a bug in the test.

test.describe("control-defects eye-verify (§414)", () => {
  // Item 1 — the disabled Turso-hint buttons are reachable by pointer.
  //
  // `projects-panel.tsx` hangs the explanatory hint for "Load from Turso" and
  // "Move to Turso" on a wrapping `<span title=…>` and relies on
  // `disabled:pointer-events-none` on the button so a hovering pointer falls
  // through to the wrapper instead of stopping on the (non-hoverable-when-
  // disabled) button. Whether that hit test actually reaches the title
  // carrier is unverified by any unit test (jsdom has no layout).
  //
  // Both buttons render in FILE mode with no Turso integration configured —
  // `mode==="file"` skips the `isTurso` branch entirely and `tursoConfigured`
  // (`getTursoConfig(settings.integrations?.turso, …)`) is false, so both are
  // rendered disabled with a wrapper title. That is exactly the seeded
  // fixture's state, so this item is reachable without any extra setup.
  test("item 1: Turso disabled-button hints are reachable by pointer (Projects panel)", async ({ page }) => {
    // The guided tour auto-launches on this seeded (never-dismissed) fixture
    // and its full-screen backdrop (`div.fixed.inset-0.z-[60]`) sits on top of
    // everything, including the Projects panel — `openView`'s DOM `.click()`
    // punches through it for navigation, but a REAL pointer hit test (this
    // test's whole point) resolves to the backdrop, not the button. Seed
    // `tourSeen` so this test observes the button hit test itself, not the
    // tour overlaid on top of it — confirmed by hand: without this the
    // `elementFromPoint` walk terminates at the backdrop `<div>` every time.
    await page.addInitScript(() => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    });
    await gotoApp(page);
    await openView(page, "Projects");
    await waitForViewSettled(page);

    // Scoped to the Projects tabpanel and anchored on the exact mechanism the
    // followup names: a disabled button wired to a hint via aria-describedby,
    // riding `disabled:pointer-events-none` so the wrapper's `title` is what a
    // hovering pointer should land on.
    const hintButtons = page.locator("#panel-projects button[disabled][aria-describedby]");
    const count = await hintButtons.count();

    // Non-vacuity guard. If this is 0, the finding is "unreachable under a
    // file-mode seed", NOT "the hit test is broken" — see the report for which
    // one this run actually hit.
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const btn = hintButtons.nth(i);
      await expect(btn).toHaveClass(/disabled:pointer-events-none/);
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      const cx = box!.x + box!.width / 2;
      const cy = box!.y + box!.height / 2;

      // The real mechanism under test: does a pointer HOVERING the button's
      // own center actually resolve (via elementFromPoint, which follows the
      // same hit-testing path a real hover does) to an element carrying a
      // non-empty `title` — the button itself (if pointer-events reached it,
      // which would mean the fallthrough failed) or an ancestor wrapper?
      const titleCarrierReached = await page.evaluate(
        ([x, y]) => {
          let el = document.elementFromPoint(x, y) as HTMLElement | null;
          for (let hops = 0; el && hops < 6; hops++, el = el.parentElement) {
            if (el.getAttribute("title")) return true;
          }
          return false;
        },
        [cx, cy] as const,
      );
      expect(titleCarrierReached).toBe(true);
    }
  });

  // Item 2 — the Ask-Claude glyph sits inside its cell, not over the checkbox.
  //
  // `task-row.tsx`'s leading `<Td className="w-7" padding="tight">` only ever
  // mounts the inline "Ask Claude" trigger when `aiEditEnabled(task)` is true,
  // which requires the AI master switch ON *and* a non-blank API key
  // (`isAiEnabled` in settings-types.ts) — both OFF by default, and `./seed`
  // seeds no AI settings at all. So the control this item is about does not
  // mount under the plain fixture; a minimal settings seed (mirroring the
  // house pattern `installAssetByteStore` uses for Turso integration) is
  // added here to make the trigger reachable. This never calls the AI API —
  // the test only reads geometry, it never clicks the trigger.
  test("item 2: the Ask-Claude glyph sits inside its cell", async ({ page }) => {
    // Settings are a shallow merge over defaults (use-settings.ts), so writing
    // only `ai` here leaves everything else (incl. storageConfig) untouched.
    // Also seed `tourSeen` — see item 1's comment for why: the guided tour's
    // full-screen backdrop otherwise sits on top of the table, and while this
    // test only reads geometry (no clicks), keeping every test in this file on
    // the same "already onboarded" baseline avoids the tour's own animation
    // shifting layout mid-measurement.
    await page.addInitScript(() => {
      localStorage.setItem(
        "aipm-cockpit:settings",
        JSON.stringify({ tourSeen: true, ai: { enabled: true, apiKey: "e2e-eye-verify-key" } }),
      );
    });

    await gotoApp(page);
    await openView(page, "Open Points");
    await waitForViewSettled(page);

    // The trigger is also gated on `!task.jiraKey` (use-inline-ai-edit.ts), so
    // not every row carries it — take the first row that does, whichever task
    // that turns out to be, rather than assuming row order.
    const trigger = page.locator('tr[data-deeplink-row] button[title="Ask Claude"]').first();
    await expect(trigger).toHaveCount(1);

    const row = trigger.locator("xpath=ancestor::tr[1]");
    const leadingCell = row.locator("td").first();
    const glyph = trigger.locator("svg");

    const cellBox = await leadingCell.boundingBox();
    const glyphBox = await glyph.boundingBox();
    expect(cellBox).not.toBeNull();
    expect(glyphBox).not.toBeNull();

    const TOLERANCE_PX = 0.5;
    expect(glyphBox!.x).toBeGreaterThanOrEqual(cellBox!.x - TOLERANCE_PX);
    expect(glyphBox!.x + glyphBox!.width).toBeLessThanOrEqual(cellBox!.x + cellBox!.width + TOLERANCE_PX);
    expect(glyphBox!.y).toBeGreaterThanOrEqual(cellBox!.y - TOLERANCE_PX);
    expect(glyphBox!.y + glyphBox!.height).toBeLessThanOrEqual(cellBox!.y + cellBox!.height + TOLERANCE_PX);
  });

  // Item 3 — the ID-column badge run does not wrap.
  //
  // The ID cell (`<Td className="font-mono …">` in task-row.tsx) renders
  // `#<id>` plus zero or more of the Jira/RAID/document/changes badges, each
  // carrying `whitespace-nowrap`. `font-mono` is unique to that cell (the
  // Start Date cell also carries `whitespace-nowrap`, but not `font-mono`),
  // so scoping on it avoids picking up an unrelated column.
  test("item 3: the ID-column badge run stays on one line", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    });
    await gotoApp(page);
    await openView(page, "Open Points");
    await waitForViewSettled(page);

    const idCells = page.locator("tr[data-deeplink-row] td.font-mono");
    const cellCount = await idCells.count();
    expect(cellCount).toBeGreaterThan(0);

    let sawAnyBadge = false;
    for (let i = 0; i < cellCount; i++) {
      const badges = idCells.nth(i).locator(".whitespace-nowrap");
      const badgeCount = await badges.count();
      if (badgeCount === 0) continue;
      sawAnyBadge = true;

      const tops: number[] = [];
      for (let j = 0; j < badgeCount; j++) {
        const box = await badges.nth(j).boundingBox();
        expect(box).not.toBeNull();
        tops.push(Math.round(box!.y));
      }
      // Every badge in this cell sits on the same line — a wrap would put a
      // later badge at a larger `y`.
      expect(new Set(tops).size).toBe(1);
    }

    // Non-vacuity guard: at least one row in the seeded fixture must actually
    // carry a badge, or the loop above asserted nothing.
    expect(sawAnyBadge).toBe(true);
  });

  // Item 4 — the Documents body collapses on re-click and the panel reflows.
  //
  // `documents-panel.tsx` wraps the rendered document in
  // `<div hidden={bodyCollapsed}>` (Task 5, commit 16237df9); clicking the
  // OPEN document's own name toggles `bodyCollapsed` (`handleSelect`). The
  // seeded fixture carries exactly one document ("Steering update"), so it is
  // selected on load and its disclosure button is the only one on the page
  // carrying `aria-expanded` — a more robust anchor than the plan's
  // `[hidden] >> nth=0`, and than matching on the title text (the accessible
  // name is a disambiguated row token, not the raw title, per
  // documents-list.tsx). Real preview content ("Delivery is on track for the
  // March gate.", from the seeded document's first paragraph block) stands in
  // for "the panel reflows": a `hidden` ancestor makes it non-visible to
  // Playwright exactly as a real collapse would.
  test("item 4: Documents body collapses and expands on re-click", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    });
    await gotoApp(page);
    await openView(page, "Documents");
    await waitForViewSettled(page);

    // Scoped to the documents list rows — `button[aria-expanded]` alone
    // matches unrelated app-wide disclosure controls (nav groups, popovers:
    // measured 8 matches on this same seeded page) and is not what this item
    // is about.
    const toggle = page.locator("tr[data-deeplink-row] button[aria-expanded]");
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const bodyText = page.getByText("Delivery is on track for the March gate.");
    await expect(bodyText).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(bodyText).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(bodyText).toBeVisible();
  });
});

// Items 5 and 6 are deliberately NOT written here.
//
// Item 5 (keyboard-only operation of the Knowledge attach-to `SingleEntityPicker`)
// needs a real interactive keyboard walk (open/arrow/Enter/Escape) verified
// against the Escape/Tab dismissal protocol in docs/AGENTS/ui-shell.md — that
// is a genuine browser interaction question, not a geometry one, and nothing
// about it is blocked by the file-mode seed. It stays owed because writing it
// well needs its own pass, not because it cannot be automated; recorded here
// so it is not silently dropped.
//
// Item 6 (an asset's name reading as interactive) needs a REAL Turso project:
// `documents-asset-section.tsx` only passes `loadImage` (the prop gating the
// interactive vs. plain-text branch) when `tursoConfig !== null`, and
// `./seed`'s fixture is file-mode. A file-mode run can only ever exercise the
// inert branch, which cannot answer the question this item asks. Still owed.
