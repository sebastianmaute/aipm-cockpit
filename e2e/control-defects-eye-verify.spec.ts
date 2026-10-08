import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";
import { join } from "node:path";
import type { Locator } from "@playwright/test";

// Browser eye-verify for open-followups §414 (the control-defects batch). Each
// item there is a layout/hover/native-tooltip claim jsdom cannot observe. This
// spec converts the ones that CAN be driven headlessly into real assertions;
// item 6 stays owed (see the bottom of the file) because it needs a
// Turso-backed seed that `./seed` does not provide.
//
// These are FINDINGS, not fixes — a failing assertion here is a legitimate
// result about the shipped code, not a bug in the test.
//
// The taste calls the owner signs off are saved as screenshots under the
// git-ignored eye-verify-output/batch-20/414/ (docs/eye-verify-batch-20.md lists them).
const shot = (target: Locator, name: string) =>
  target.screenshot({ path: join(process.cwd(), "eye-verify-output", "batch-20", "414", name) });

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

      // ★★★ HOP 0 IS THE WHOLE ASSERTION. The first cut of this test walked up
      //     to six ancestors looking for a `title` and asserted only that one
      //     was found — which is TRUE IN BOTH DIRECTIONS and therefore measured
      //     nothing: when `disabled:pointer-events-none` WORKS, elementFromPoint
      //     resolves straight through to the wrapper `<span title=…>`; when it
      //     FAILS, elementFromPoint returns the button and the very first
      //     `parentElement` hop lands on that SAME span, because the span is the
      //     button's direct parent (`projects-panel.tsx` — grep
      //     `title={loadFromTursoHint}`). That walk could only ever detect an
      //     occluding overlay OUTSIDE the button's subtree, which is a real but
      //     different claim from the one the test's name makes.
      //     What discriminates the fallthrough is whether the pointer reaches
      //     the BUTTON at all, so assert that first and separately.
      const hit = await btn.evaluate(
        (node, [x, y]) => {
          const top = document.elementFromPoint(x, y) as HTMLElement | null;
          let el = top;
          let titleCarrierReached = false;
          for (let hops = 0; el && hops < 6; hops++, el = el.parentElement) {
            if (el.getAttribute("title")) {
              titleCarrierReached = true;
              break;
            }
          }
          return {
            // `contains` covers a hit landing on a child of the button rather
            // than the button element itself.
            pointerReachedButton: !!top && (top === node || node.contains(top)),
            titleCarrierReached,
          };
        },
        [cx, cy] as const,
      );

      // The fallthrough itself: a pointer over the disabled button's centre
      // must NOT land on the button. Delete `disabled:pointer-events-none` and
      // this goes red — which the old single assertion did not.
      expect(hit.pointerReachedButton).toBe(false);
      // And what it DOES land on must carry the tooltip text.
      expect(hit.titleCarrierReached).toBe(true);
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
    await shot(row, "item2-row-with-ask-claude.png");
  });

  // Item 3, as first written: a smoke test only. ★★ SUPERSEDED for the claim by
  // "item 3b" below, which has the two-badge fixture this test lacks and MEASURED
  // the opposite of this test's title: two or more badges stack under the ID rather
  // than share a line. This one still passes only because no cell here holds two.
  //
  // The ID cell (`<Td className="font-mono …">` in task-row.tsx) renders
  // `#<id>` plus zero or more of the Jira/RAID/document/changes badges, each
  // carrying `whitespace-nowrap`.
  //
  // ★★ `font-mono` is NOT unique to that cell, and an earlier revision of this
  //    comment claimed it was. `grep -n "font-mono" src/app/task-row.tsx`
  //    returns THREE `<Td>` — the ID cell plus the right-aligned estimate and
  //    spent-hours cells. The selector therefore matches ~3x what the old
  //    comment implied. It is still CORRECT, but for a different reason: the
  //    other two hold plain text and no `.whitespace-nowrap` descendant, so
  //    `badgeCount === 0` skips them. Do not "tighten" this to the ID cell on
  //    the strength of the old claim without re-running that grep.
  test("item 3 (smoke, superseded by 3b): single badges in the ID cells render", async ({ page }) => {
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

    // ★★★ READ THIS BEFORE TRUSTING THIS TEST. `sawAnyBadge` proves the loop
    //     RAN; it does NOT prove the loop asserted the property under test.
    //     Measured against `sample-workspace-small.json` + `e2e/seed-workspace.ts`: the
    //     maximum number of `.whitespace-nowrap` badges in ANY task's ID cell
    //     under this seed is ONE — `RaidBadge` and `DocumentBadge` each render
    //     a single AGGREGATE badge rather than one per ref, and the Jira badge
    //     needs `settings.jira.siteUrl`, which no seed writes. So
    //     `new Set(tops).size` is a one-element Set on every iteration and the
    //     wrap assertion above CANNOT go red under this fixture.
    //     An earlier revision of this comment called `sawAnyBadge` a
    //     "non-vacuity guard", which is a false-coverage claim: seven
    //     single-badge rows satisfy it. It is kept because it still catches a
    //     seed that stops rendering badges at all.
    //     The two-badge fixture this needed is "item 3b" (2026-10-08), which
    //     sets `settings.jira.siteUrl` so the seed's Jira tasks show a second
    //     badge, and which found that such badges stack (§414).
    expect(sawAnyBadge).toBe(true);
  });

  // Item 4 — the Documents body collapses on re-click and the panel reflows.
  //
  // `documents-panel.tsx` wraps the rendered document in
  // `<div hidden={bodyCollapsed}>` (Task 5, commit 16237df9); clicking the
  // OPEN document's own name toggles `bodyCollapsed` (`handleSelect`).
  // ★ The fixture carries TWO documents, not one — `e2e/seed-workspace.ts` spreads
  // `SAMPLE_WORKSPACE.documents` and appends "Kickoff pack" (an earlier
  // revision of this comment said "exactly one document", which is false).
  // The anchor below is unaffected, and for a reason that does not depend on
  // the count at all: only the OPEN row carries `aria-expanded` (it is
  // `undefined` on every other row, per documents-list.tsx), so the
  // `toHaveCount(1)` holds at any number of seeded documents — a more robust
  // anchor than the plan's
  // `[hidden] >> nth=0`, and than matching on the title text (the accessible
  // name is a disambiguated row token, not the raw title, per
  // documents-list.tsx). Real preview content ("Delivery is on track for the
  // October go-live gate.", from the seeded document's first paragraph block,
  // which the 1.11.0 demo refresh rewrote from "…the March gate.") stands in
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

    const bodyText = page.getByText("Delivery is on track for the October go-live gate.");
    await expect(bodyText).toBeVisible();
    const panel = page.locator("#panel-documents");
    await shot(panel, "item4-documents-expanded.png");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(bodyText).toBeHidden();
    await shot(panel, "item4-documents-collapsed.png");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(bodyText).toBeVisible();
  });

  // Item 3, with the fixture the test above lacks (2026-10-08). The seed's Jira
  // tasks show their Jira badge once `settings.jira.siteUrl` is set, beside the
  // badge they already carry, so a cell holds two.
  // ★★ MEASURED 2026-10-08: the badges do NOT share a line, even at the default
  // width. They are inline siblings in a plain <td>, so with two or more they stack
  // under the ID, one per line. What `whitespace-nowrap` guarantees, and what this
  // pins, is that no single badge breaks inside itself. Whether the stack is
  // acceptable is the owner's call, from the two screenshots this writes (default
  // width, and after dragging the ID column's resize handle as far left as it goes).
  test("item 3b: with two badges in one ID cell, no badge breaks inside itself, also at the narrowest width", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "aipm-cockpit:settings",
        JSON.stringify({ tourSeen: true, jira: { siteUrl: "https://example.atlassian.net", email: "", apiToken: "", projectKey: "" } }),
      );
    });
    await gotoApp(page);
    await openView(page, "Open Points");
    await waitForViewSettled(page);

    // The seed's Jira tasks carry a second badge too (e.g. a change link), once the
    // Jira badge renders. The badges are the ID cell's children AFTER the `#id`
    // button, found by STRUCTURE: selecting them by `.whitespace-nowrap`, the class
    // under test, would make a dropped class read as "no badges" rather than a break.
    const cells = page.locator("tr[data-deeplink-row] td.font-mono");
    const index = await cells.evaluateAll((tds) => tds.findIndex((td) => td.children.length - 1 >= 2));
    expect(index, "no ID cell with two badges").toBeGreaterThanOrEqual(0);
    const cell = cells.nth(index);
    // A badge that broke inside itself is taller than one line of its own text.
    const brokenBadges = () =>
      cell.evaluate((td) => {
        const out: string[] = [];
        const kids = [...td.children].slice(1) as HTMLElement[];
        for (const el of kids) {
          // The Jira badge sits in a wrapper <span>; measure the badge itself.
          const badge = (el.children.length === 1 && el.tagName === "SPAN" ? el.firstElementChild : el) as HTMLElement;
          const cs = getComputedStyle(badge);
          const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
          const rects = badge.getClientRects().length;
          const height = badge.getBoundingClientRect().height;
          if (rects > 1 || height > line * 1.6 + 8) out.push(`${(badge.textContent ?? "").trim()} (${Math.round(height)}px, ${rects} boxes)`);
        }
        return { n: kids.length, broken: out };
      });
    // ANTI-VACUITY: the property needs at least two badges in the one cell.
    const atDefault = await brokenBadges();
    expect(atDefault.n, "badges in the ID cell").toBeGreaterThanOrEqual(2);
    expect(atDefault.broken, "a badge broke inside itself at the default width").toEqual([]);
    await shot(cell, "item3b-id-cell-default.png");

    // Drag the ID header's resize handle to the left, past any minimum.
    const idHeader = page.locator("thead th").filter({ hasText: /^ID/ }).first();
    const handle = idHeader.locator(".cursor-col-resize");
    const before = (await idHeader.boundingBox())!.width;
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x - 600, h.y + h.height / 2, { steps: 10 });
    await page.mouse.up();
    const after = (await idHeader.boundingBox())!.width;
    expect(after, "the drag did not narrow the ID column").toBeLessThan(before);
    expect((await brokenBadges()).broken, `a badge broke inside itself at the narrowest width (${Math.round(after)}px)`).toEqual([]);
    await shot(cell, "item3b-id-cell-narrowest.png");
  });

  // Item 5: the Knowledge "Attach to" picker by keyboard alone (2026-10-08). Open,
  // arrow, Enter commits; then Escape closes the list WITHOUT dismissing the add
  // panel around it, and focus stays in the field (docs/AGENTS/ui-shell.md, dismissal).
  test("item 5: the Knowledge attach-to picker works by keyboard alone", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    });
    await gotoApp(page);
    await openView(page, "Knowledge");
    await waitForViewSettled(page);

    await page.getByRole("button", { name: "+ Add link", exact: true }).click();
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    await expect(cancel).toBeVisible();
    const search = page.getByRole("combobox", { name: "Attach to", exact: true });
    await search.focus();

    await page.keyboard.type("*");
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await expect(search).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const activeId = await search.getAttribute("aria-activedescendant");
    expect(activeId, "no active option after ArrowDown").toBeTruthy();
    const picked = ((await page.locator(`[id="${activeId}"]`).textContent()) ?? "").trim();
    expect(picked).not.toBe("");
    await page.keyboard.press("Enter");
    await expect(list).toBeHidden();
    // The committed value shows above the field as "<Kind>: <name>"; the option
    // carries the same two parts without the separator.
    // The label row is the picker root's first child: walk up from the input to
    // the box whose previous sibling holds it (`single-entity-picker.tsx`).
    const selectedText = () =>
      search.evaluate((input) => {
        for (let el: Element | null = input; el; el = el.parentElement) {
          const prev = el.previousElementSibling;
          if (prev && prev.classList.contains("mb-1")) return prev.textContent ?? "";
        }
        return null;
      });
    await expect.poll(selectedText).not.toContain("Standalone");
    expect(((await selectedText()) ?? "").replace(": ", "").replace(/\s+/g, " ").trim()).toBe(picked.replace(/\s+/g, " "));

    // Escape closes the list, and only the list.
    await page.keyboard.type("*");
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(search).toBeFocused();
    await expect(cancel).toBeVisible();
    await expect(page.getByRole("tabpanel").filter({ has: search })).toHaveCount(1);
    // A second Escape, with the list already closed, still leaves the add panel open.
    await page.keyboard.press("Escape");
    await expect(cancel).toBeVisible();
  });
});

// Item 6 is deliberately NOT written here. (Item 5, once listed here too, is the
// keyboard test above since 2026-10-08.)
//
// Item 6 (an asset's name reading as interactive) needs a REAL Turso project:
// `documents-asset-section.tsx` only passes `loadImage` (the prop gating the
// interactive vs. plain-text branch) when `tursoConfig !== null`, and
// `./seed`'s fixture is file-mode. A file-mode run can only ever exercise the
// inert branch, which cannot answer the question this item asks. Still owed.
