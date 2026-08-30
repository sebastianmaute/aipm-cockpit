# Shared-primitive a11y Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `docs/open-followups.md` §146 (popover focus restore), §246 (accessible-name collisions in two shared primitives) and §289 (milestones stamp `localModifiedAt`).

**Architecture:** Three of the four fixes live INSIDE a shared primitive, so no call-site sweep is needed and no consumer can drift out of step. The fourth (§246 budget) is a deletion: the repeated per-cell tooltip is removed and stated once, panel-wide. §289 is a two-line change with a load-bearing ORDER.

**Tech Stack:** Next.js 16 / React / TypeScript, vitest + @testing-library/react (jsdom), Playwright + axe for e2e.

---

## Read this before Task 1

★★★ **THE AXE GATE CANNOT SEE ANY DEFECT IN THIS PLAN.** AGENTS.md carries the
measurement: of axe 4.12.1's rules carrying one of the four tags `e2e/a11y.spec.ts`
requests, NOT ONE flags two controls sharing an accessible name, and none checks focus
restoration. A green `npm run e2e` says nothing about this work, in any view, at any
seed size. **The unit tests ARE the deliverable.** Do not treat them as evidence for a
fix that is "really" the source change.

★★ **Collision assertions go through `src/test/row-unique-names.ts`**, never a
hand-rolled enumeration. Read its header comment before using it. Two facts govern
every use here:

- `minControls` proves ONLY that the scope is non-empty. It counts CONTROLS of the
  requested roles over the WHOLE DOCUMENT unless `scope` is passed — a panel toolbar
  alone satisfies any plausible floor. It does NOT make a one-row fixture unreachable.
- `requireCollisionSeed: true` is the guard that does. Turn it ON for any test claiming
  to cover a collision; leave it OFF for a distinct-name regression pin.

★★ **Gate exit codes.** `npx tsc --noEmit` exits **2** on diagnostics, not 1. NEVER
read a gate's exit code through a pipe — you get the pipe's status. Redirect, echo the
status unpiped, then read the file:

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"; head -30 /tmp/tsc.log
```

★★ **Never run two vitest processes at once.** A vitest red carrying
`Failed to start forks worker` is machine CONTENTION, not a test failure — re-run with
`--maxWorkers=4` before believing it.

★★★ **`src/app/*.ts(x)` are CRLF.** The `Write` tool RE-LINES a CRLF file to LF; `Edit`
does not. Use `Edit` for every source change in this plan. `docs/**` and `CHANGELOG.md`
are LF and may be written either way.

★★★ **`src/app/i18n.de.ts` must NOT be touched with the `Edit` tool** — it corrupts
umlauts and curls double quotes. Task 2 gives the node UTF-8 write pattern.

---

## File Structure

| File | Change | Task |
|---|---|---|
| `src/app/popover-panel.tsx` | Escape-only focus restore, internal | 1 |
| `src/app/popover-panel.test.tsx` | 1 positive + 3 negative focus cases | 1 |
| `src/app/i18n.ts` | 2 new EN keys | 2 |
| `src/app/i18n.de.ts` | 2 new DE keys (node write only) | 2 |
| `src/app/roles-editor.tsx` | `/d` columns get their own hints | 2 |
| `src/app/roles-editor.test.tsx` | collision pin | 2 |
| `src/app/budget-panel-totals.tsx` | delete both per-cell `InfoTooltip`s | 3 |
| `src/app/budget-panel.tsx` | panel-wide legend; qualify bucket controls | 3, 4 |
| `src/app/budget-panel-cards.tsx` | `Cci` gains `scopeName` | 4 |
| `src/app/budget-panel.test.tsx` | one-instance + collision pins | 3, 4 |
| `src/app/report-table.tsx` | `SortResizeTh` gains `nameContext` | 5 |
| `src/app/report-table.test.tsx` | append + containment pins | 5 |
| `src/app/reports-tables.tsx` | both table components take a required `nameContext` | 5 |
| `src/app/reports.tsx` | three call sites pass their section heading | 5 |
| `src/app/reports.test.tsx` | collision pin; existing name queries updated | 5 |
| `src/app/milestones-panel.tsx` | stamp on apply, then on bulk undo | 6 |
| `src/app/milestones-panel.test.tsx` | apply stamps; undo stamps | 6 |
| `docs/open-followups.md` | close §146, §246, §289 | 7 |
| `CHANGELOG.md`, `src/app/version.ts` | release | 7 |

---

### Task 1: §146 — `PopoverPanel` restores focus on Escape only

**Files:**
- Modify: `src/app/popover-panel.tsx`
- Test: `src/app/popover-panel.test.tsx`

**Context you need.** `PopoverPanel` portals its panel to `document.body` and closes on
four separate signals. It already receives `anchorRef` (the trigger `<button>`) and
holds `panelRef` (the portaled `<span>`), so it can restore focus itself — §146's own
prescription (a reason union threaded to 19 consumers) is unnecessary and is documented
in the spec as a deliberate deviation.

Enumerate the four dismiss paths before editing:

```bash
grep -n "onClose()\|onDismiss: onClose" src/app/popover-panel.tsx
```

Expect four hits: the ancestor-`scroll` listener, the `resize` listener, the
`useDismissable` call (Escape), and the outside-`mousedown` listener.

**Only the `useDismissable` one restores focus.** Scroll and resize did not come from
the user asking to leave. Outside-click means the user has deliberately gone elsewhere,
and pulling focus back would be a worse bug than the one being fixed.

- [ ] **Step 1: Write the four failing tests**

Append inside the existing top-level `describe("PopoverPanel", …)` in
`src/app/popover-panel.test.tsx`. The file already has a `Harness` component (a
`<button>trigger</button>` plus a `PopoverPanel` containing `<input aria-label="field" />`)
and a `withRects` helper — reuse `Harness` as-is.

```tsx
  // ★★★ THE THREE NEGATIVES ARE THE POINT. A fix that restores focus from all
  // four dismiss paths passes the Escape case alone, and that is exactly the
  // regression §146 warns about: yanking focus back to the trigger when the
  // user has deliberately clicked somewhere else. Named mutant for this block:
  // route `onDown`/`onResize`/`onScroll` through the restoring wrapper too.
  it("returns focus to the trigger on Escape", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    fireEvent.click(trigger);
    // autoFocus lands on the panel's first control, so focus starts INSIDE.
    expect(screen.getByLabelText("field")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("does NOT return focus to the trigger on an outside mousedown", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(trigger).not.toHaveFocus();
  });

  it("does NOT return focus to the trigger on a width resize", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    fireEvent.click(trigger);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    fireEvent(window, new Event("resize"));
    expect(trigger).not.toHaveFocus();
  });

  it("does NOT return focus to the trigger when an ancestor scroller moves", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    fireEvent.click(trigger);
    fireEvent.scroll(document.body);
    expect(trigger).not.toHaveFocus();
  });
```

- [ ] **Step 2: Run them and confirm the FIRST fails and the other three pass**

```bash
npx vitest run src/app/popover-panel.test.tsx > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests |✓|×" /tmp/t1.log | tail -25
```

Expected: `returns focus to the trigger on Escape` FAILS (focus is on `document.body`,
not the trigger). The three negatives PASS — they are green before the change and must
stay green after it. That is what makes them a mutation detector rather than
decoration.

- [ ] **Step 3: Implement the restore inside the primitive**

In `src/app/popover-panel.tsx`, add the wrapper immediately above the existing
`useDismissable` call and pass it as `onDismiss`. `useCallback` keeps it stable, which
the component's own docblock requires of `onClose`.

Add `useCallback` to the existing `react` import if it is not already there.

```tsx
  // ★★★ ESCAPE ONLY. `onClose` is invoked from FOUR places here — this dismiss
  // hook, the outside-click `mousedown` listener, the `resize` listener and the
  // capture-phase ancestor-`scroll` listener. Restoring focus from all four
  // would YANK the user back to the trigger after they deliberately clicked
  // somewhere else, which is worse than the gap this closes (open-followups
  // §146). Scroll and resize are not the user asking to leave either: the
  // layout moved out from under the panel.
  // ★★ The panel is PORTALED to document.body, so on Escape the browser leaves
  // focus on `body` and the toolbar the user came from goes arrow-dead — its
  // roving-tabindex guard correctly refuses to act from outside the row.
  // ★ Guarded on focus still being INSIDE the panel: any future path reaching
  // this hook while focus sits elsewhere must not steal it.
  // ★ Focus the anchor BEFORE closing. The anchor is outside the portal so it
  // survives the unmount either way; restoring first avoids a frame in which
  // `document.activeElement` is `body`.
  const closeRestoringFocus = useCallback(() => {
    if (panelRef.current?.contains(document.activeElement)) {
      anchorRef.current?.focus({ preventScroll: true });
    }
    onClose();
  }, [anchorRef, onClose]);

  // Escape goes through the dismissal stack — see `use-popover-dismiss` for
  // why this is no longer a capture-phase listener.
  useDismissable({ open, kind: "layer", onDismiss: closeRestoringFocus });
```

Replace the existing `useDismissable({ open, kind: "layer", onDismiss: onClose });`
line with the block above, keeping its comment. Leave `onDown`, `onResize` and
`onScroll` calling bare `onClose()`.

- [ ] **Step 4: Run the tests and confirm all four pass**

```bash
npx vitest run src/app/popover-panel.test.tsx > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t1.log
```

Expected: `EXIT=0`, all tests in the file passing.

- [ ] **Step 5: Prove the negatives are not vacuous (mutation)**

In the outside-click `mousedown` listener, temporarily replace its `onClose()` call with
`closeRestoringFocus()`. That is the exact over-reach §146 warns about, so it is the
mutant worth naming: its token span is the single identifier `onClose` inside `onDown`.
Re-run the file.

Expected: `does NOT return focus to the trigger on an outside mousedown` turns RED.
Revert the mutant with an inverse anchored `Edit` (never `git checkout --`, which is
deny-blocked here), then prove the tree is clean:

```bash
git diff --stat src/app/popover-panel.tsx
```

Expected: only the intended change is listed.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"; head -20 /tmp/tsc.log
git add src/app/popover-panel.tsx src/app/popover-panel.test.tsx
git commit -m "fix: restore focus to the trigger when a popover is dismissed by Escape"
```

---

### Task 2: §246 — the roles-editor `/d` columns get their own hints

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/roles-editor.tsx`
- Test: `src/app/roles-editor.test.tsx`

**Context you need.** The rate card is asymmetric. The `/h` columns pass specific hints
through `SortResizeTh`'s `hint` prop; the two `/d` columns and the Basis column are
plain `<th>`s each carrying a bare `InfoTooltip` with the generic `rolesRateBasisHint`.
`InfoTooltip` renders `<span role="button" tabIndex={0} aria-label={label ?? text}>`, so
those three are named CONTROLS with one identical name. Confirm:

```bash
grep -n "rolesRateBasisHint\|InfoTooltip" src/app/roles-editor.tsx
```

- [ ] **Step 1: Write the failing collision test**

Append to `src/app/roles-editor.test.tsx`. Use the existing render helper in that file
if it has one; otherwise render `RolesEditor` the way its neighbouring tests do.

```tsx
  // §246: the two /d columns and Basis all carried `rolesRateBasisHint`, so
  // three InfoTooltip triggers shared one accessible name. This is a
  // DISTINCT-NAME regression pin, so `requireCollisionSeed` stays OFF — there
  // is deliberately no collision left to seed.
  it("gives each rate-card header tooltip its own accessible name", () => {
    const { container } = renderRolesEditor();
    expectRowUniqueNames({ minControls: 5, scope: container, roles: ["button"] });
  });
```

Import the helper at the top of the file:

```tsx
import { expectRowUniqueNames } from "../test/row-unique-names";
```

★ `minControls: 5` is a MEASURED floor for this scope, not a guess. If the render
throws on it, read the number the error reports and use that — the error prints the
actual control count. Do NOT lower it to 1 to make the test pass; a loose floor is what
lets a silently narrowed `roles` array back in.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/roles-editor.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests |AssertionError|share" /tmp/t2.log | head
```

Expected: FAIL naming three controls sharing the `rolesRateBasisHint` text.

- [ ] **Step 3: Add the two EN keys**

In `src/app/i18n.ts`, immediately after the existing `rolesExternalRateHint` line, add:

```ts
  rolesInternalRateDayHint: "Daily internal cost rate (EUR). Calculated from the hourly rate unless Days is the entry basis.",
  rolesExternalRateDayHint: "Daily external/billing rate (EUR). Calculated from the hourly rate unless Days is the entry basis.",
```

- [ ] **Step 4: Add the two DE keys with a node UTF-8 write**

★★★ Do NOT use the `Edit` tool on `i18n.de.ts` — it corrupts umlauts and curls double
quotes. The file is CRLF, so the anchor MUST use `\r\n` or the replace silently no-ops.
DE must use real umlauts; the `i18n-encoding` test bans `ue`/`ae`/`oe` substitutions and
also bans `\u00XX` escapes.

```bash
node -e "
const fs = require('fs');
const p = 'src/app/i18n.de.ts';
const s = fs.readFileSync(p, 'utf8');
const anchor = s.match(/^.*rolesExternalRateHint:.*\r\n/m);
if (!anchor) { console.error('ANCHOR NOT FOUND'); process.exit(1); }
const add =
  '  rolesInternalRateDayHint: \"Interner Tagessatz (EUR). Wird aus dem Stundensatz berechnet, sofern nicht Tage als Eingabebasis gewählt ist.\",\r\n' +
  '  rolesExternalRateDayHint: \"Externer Tagessatz bzw. Abrechnungssatz (EUR). Wird aus dem Stundensatz berechnet, sofern nicht Tage als Eingabebasis gewählt ist.\",\r\n';
const out = s.replace(anchor[0], anchor[0] + add);
if (out === s) { console.error('REPLACE NO-OP'); process.exit(1); }
fs.writeFileSync(p, out, 'utf8');
console.log('OK');
"
```

Then verify the bytes survived and the file is still CRLF:

```bash
grep -c "rolesInternalRateDayHint\|rolesExternalRateDayHint" src/app/i18n.de.ts   # expect 2
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log('bare-LF',(s.match(/(?<!\r)\n/g)||[]).length,'umlaut-ok',/gewählt/.test(s))"
git ls-files --eol src/app/i18n.de.ts   # expect i/lf w/crlf
```

Expected: `2`, then `bare-LF 0 umlaut-ok true`, then `i/lf w/crlf`.

- [ ] **Step 5: Point the two `/d` columns at their own hints**

In `src/app/roles-editor.tsx`, change the `InfoTooltip` inside the `rolesInternalRateDay`
header cell to:

```tsx
                    <InfoTooltip text={t(lang, "rolesInternalRateDayHint")} />
```

and the one inside the `rolesExternalRateDay` header cell to:

```tsx
                    <InfoTooltip text={t(lang, "rolesExternalRateDayHint")} />
```

Leave the Basis column's `InfoTooltip` on `rolesRateBasisHint` — that column is what the
hint actually describes. Leave the `title={t(lang, "rolesRateBasisHint")}` occurrence
further down the file alone: `title` is not an accessible name and collides with nothing.

- [ ] **Step 6: Run the test and the i18n gate**

```bash
npx vitest run src/app/roles-editor.test.tsx src/app/i18n-encoding.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t2.log
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"; head -20 /tmp/tsc.log
```

Expected: `EXIT=0` from both. `tsc` is what enforces EN/DE key parity, so a missing DE
key fails here and nowhere else.

- [ ] **Step 7: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/roles-editor.tsx src/app/roles-editor.test.tsx
git commit -m "fix: give the rate card's daily-rate columns their own hints"
```

---

### Task 3: §246 — delete the repeated per-cell budget tooltips, state them once

**Files:**
- Modify: `src/app/budget-panel-totals.tsx`, `src/app/budget-panel.tsx`
- Test: `src/app/budget-panel.test.tsx`

**Context you need.** `HoursCell` renders TWO `InfoTooltip`s per cell — one on the
"Budget" label, one on "Actual" — and `HoursTd` wraps one `HoursCell` per period column
per role row. A six-period, eight-role bucket therefore puts ~96 extra TAB STOPS in one
table, each announcing one of two identical sentences.

★★★ **THE LEGEND MUST BE PANEL-WIDE, NOT PER-BUCKET.** Buckets render in a list. A
legend inside each bucket table would render once PER BUCKET and re-create the exact
collision at two buckets — the state §246 measured. The only placement that is
genuinely singular is above the bucket list.

★ `HoursTd`'s own signature does not change: it supplies the hints to `HoursCell`
internally, so removing them touches no call site.

- [ ] **Step 1: Write the failing one-instance test**

Append to `src/app/budget-panel.test.tsx`, using whatever render helper that file
already uses for a multi-bucket, multi-period fixture. The fixture MUST have at least
two buckets and at least two periods, or the test cannot distinguish the fix from the
defect.

```tsx
  // §246: these two hints used to render once per period per role row, i.e.
  // ~2 x periods x roles tab stops all announcing one of two identical
  // sentences. The binding constraint is ONE instance of each in the whole
  // rendered panel — which is why the legend is panel-wide and not per-bucket:
  // a per-bucket legend would re-create the collision at two buckets.
  it("states each hours hint exactly once across the whole panel", () => {
    renderBudgetPanel({ buckets: twoBucketsTwoPeriods });
    expect(screen.getAllByLabelText(t("en-US", "budgetBudgetHoursHint"))).toHaveLength(1);
    expect(screen.getAllByLabelText(t("en-US", "budgetActualHoursHint"))).toHaveLength(1);
  });
```

- [ ] **Step 2: Run it and confirm it fails with a count well above 1**

```bash
npx vitest run src/app/budget-panel.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests |toHaveLength|Found multiple" /tmp/t3.log | head
```

Expected: FAIL reporting many elements, not one. Record the number — it is the
before-reading this task exists to move.

- [ ] **Step 3: Delete the two per-cell tooltips**

In `src/app/budget-panel-totals.tsx`:

(a) Remove `budgetHint` and `actualHint` from `HoursCell`'s destructured parameters and
from its type literal (the `budgetHint: string;` and `actualHint: string;` lines).

(b) Delete the two `<InfoTooltip … />` elements inside `HoursCell`, leaving the label
spans as bare text:

```tsx
        <span className="flex w-14 items-center gap-0.5 text-[10px] text-muted-foreground">
          {t(lang, "budgetCellBudget")}
        </span>
```

and

```tsx
        <span className="flex w-14 items-center gap-0.5 text-[10px] text-muted-foreground">
          {t(lang, "budgetCellActual")}
        </span>
```

(c) Delete the two lines in `HoursTd` that pass the hints down:

```tsx
        budgetHint={t(lang, "budgetBudgetHoursHint")}
        actualHint={t(lang, "budgetActualHoursHint")}
```

(d) Remove the now-unused `InfoTooltip` import from this file IF nothing else in it
uses one. Check first — `npm run lint` runs at `--max-warnings=0`, so an unused import
is FATAL, and so is deleting one that is still needed:

```bash
grep -c "InfoTooltip" src/app/budget-panel-totals.tsx
```

(e) ★★ Update the `w-14` comment directly above the `return` in `HoursCell`. It
currently reads that both label spans are `w-14` rather than `w-10` because "Actual"
plus its tooltip overflowed the narrower box. The tooltip is gone, so that justification
no longer describes the code. Replace it with:

```tsx
  // Both label spans share ONE width so the inputs beside them stay aligned —
  // change them together or the Budget and Actual rows drift apart. `w-14` is
  // inherited from when each label also carried an InfoTooltip; the tooltips
  // moved to a panel-wide legend (open-followups §246) and the width was left
  // as-is deliberately, since narrowing it would move every input in the table
  // and jsdom has no layout to check the result against.
```

- [ ] **Step 4: Add the panel-wide legend**

In `src/app/budget-panel.tsx`, inside the bucket-list `<section className="flex flex-col gap-3">`,
add the legend immediately BEFORE the existing `{report.buckets.length > 0 && (…filters…)}`
block, gated on the same condition so an empty panel shows no legend:

```tsx
        {/* ★★★ PANEL-WIDE, NOT PER-BUCKET. These two hints used to render inside
            every period cell of every role row (open-followups §246). Rendering
            them once per BUCKET table would re-create the same collision the
            moment a second bucket exists, so the legend lives here — outside the
            bucket map — where it is rendered exactly once however many buckets
            there are. Pinned by "states each hours hint exactly once across the
            whole panel" in budget-panel.test.tsx. */}
        {report.buckets.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {t(lang, "budgetCellBudget")}
              <InfoTooltip text={t(lang, "budgetBudgetHoursHint")} />
            </span>
            <span className="flex items-center gap-1">
              {t(lang, "budgetCellActual")}
              <InfoTooltip text={t(lang, "budgetActualHoursHint")} />
            </span>
          </div>
        )}
```

`InfoTooltip` is already imported in `budget-panel.tsx`; do not add a second import.

- [ ] **Step 5: Run the test and confirm it passes**

```bash
npx vitest run src/app/budget-panel.test.tsx src/app/budget-panel-people-rows.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t3.log
```

Expected: `EXIT=0`. `budget-panel-people-rows.test.tsx` imports `HoursTd` directly, so
it is the regression check that `HoursTd`'s public signature did not change.

- [ ] **Step 6: Lint and typecheck (the unused-import trap)**

```bash
npx eslint --max-warnings=0 src/app/budget-panel-totals.tsx src/app/budget-panel.tsx; echo "EXIT=$?"
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"; head -20 /tmp/tsc.log
```

Expected: `EXIT=0` from both. Do not pipe the eslint call — a `| grep` returns grep's
status, which reads as failure when eslint passed.

- [ ] **Step 7: Commit**

```bash
git add src/app/budget-panel-totals.tsx src/app/budget-panel.tsx src/app/budget-panel.test.tsx
git commit -m "fix: state the budget hours hints once instead of in every cell"
```

---

### Task 4: §246 — qualify the bucket-scoped budget controls with the bucket name

**Files:**
- Modify: `src/app/budget-panel-cards.tsx`, `src/app/budget-panel.tsx`
- Test: `src/app/budget-panel.test.tsx`

**Context you need.** Two families collide once a second bucket exists, and unlike Task
3 these genuinely DIFFER per bucket — each reports a different bucket's number — so they
are qualified rather than deleted:

- the four `Cci` hints, rendered once at project level and once per bucket;
- the three per-bucket `Button`s, which carry **no `aria-label` at all** and take their
  accessible name from their rendered CONTENT. An attribute-matching grep cannot see
  them: that is leg (2) of AGENTS.md's three-leg enumeration rule.

Confirm both:

```bash
grep -n "<Cci " src/app/budget-panel.tsx | wc -l
grep -n "budgetEditBucket\|budgetClose\|budgetReopen\|budgetRemoveBucket" src/app/budget-panel.tsx
```

★ Use the EN DASH `–` (U+2013) as the separator, matching the repo's existing row-token
format.

- [ ] **Step 1: Write the failing collision test**

```tsx
  // §246: with two buckets, the four CCI hints render 2x each (plus the
  // project-total copies) and the three bucket buttons render 2x each, all
  // colliding on name. requireCollisionSeed is ON here because this test
  // CLAIMS to cover a collision — without it, a fixture cut to one bucket
  // would still pass and certify nothing.
  it("gives every bucket-scoped control a bucket-unique accessible name", () => {
    const { container } = renderBudgetPanel({ buckets: twoBucketsTwoPeriods });
    expectRowUniqueNames({
      minControls: 12,
      scope: container,
      roles: ["button"],
      requireCollisionSeed: true,
    });
  });
```

★★ Write this test FIRST, run it, and read what `requireCollisionSeed` reports. On the
UNFIXED code it must throw the DUPLICATE-NAME error, not the "no collision seeded" one.
If it reports no seed, the fixture has one bucket and the test is vacuous — fix the
fixture before touching source.

★ `minControls: 12` is a MEASURED floor. Take the real number from the error message on
first run and use that value; do not leave a loose floor.

- [ ] **Step 2: Run it and confirm it fails on DUPLICATE names**

```bash
npx vitest run src/app/budget-panel.test.tsx -t "bucket-unique" > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests |share|duplicate|collision" /tmp/t4.log | head
```

Expected: FAIL naming the shared names. If it fails saying no collision was seeded, the
fixture is wrong — see Step 1.

- [ ] **Step 3: Give `Cci` a `scopeName`**

In `src/app/budget-panel-cards.tsx`, add the prop and use it as the tooltip's accessible
name. `InfoTooltip` already accepts `label` to override `aria-label`, so nothing changes
in that primitive.

Change the signature to add `scopeName`:

```tsx
export function Cci({ label, hint, scopeName, value, currency, locale, lang, rag, primary = "amount", unknown = false }: { label: string; hint?: string; scopeName?: string; value: CciValue; currency: string; locale: string; lang: Lang; rag?: Health | null; primary?: "amount" | "percent"; unknown?: boolean }) {
```

and the tooltip render to:

```tsx
          {/* ★ APPENDED, never prefixed or replaced. The tooltip trigger has no
              visible text of its own, so WCAG 2.5.3 does not bind here — but the
              same append rule is used across this slice so one convention covers
              every qualified name (open-followups §246). `scopeName` is the
              bucket name; the project-total cards pass nothing and keep the bare
              hint as their name. */}
          {hint ? <InfoTooltip text={hint} label={scopeName ? `${hint} – ${scopeName}` : undefined} /> : null}
```

- [ ] **Step 4: Pass the bucket name at the four per-bucket `Cci` call sites**

In `src/app/budget-panel.tsx`, add `scopeName={bucket.name}` to each of the four `<Cci …>`
elements rendered INSIDE the bucket map. Leave the four project-level `<Cci …>` elements
unqualified — there is only ever one project-total block, so it has nothing to collide
with and a qualifier there would be noise.

- [ ] **Step 5: Name the three bucket buttons**

Still in `src/app/budget-panel.tsx`, add an `aria-label` to each of the three per-bucket
`Button`s. The visible text is unchanged and stays CONTAINED in the accessible name,
which is what WCAG 2.5.3 requires.

```tsx
                <Button
                  variant="secondary"
                  size="xs"
                  aria-label={`${t(lang, "budgetEditBucket")} – ${bucket.name}`}
                  onClick={() => setEditingBucketId(bucket.id)}
                >
                  {t(lang, "budgetEditBucket")}
                </Button>
```

```tsx
                <Button
                  variant="secondary"
                  size="xs"
                  aria-label={`${t(lang, bucket.status === "open" ? "budgetClose" : "budgetReopen")} – ${bucket.name}`}
                  onClick={() => updateBucket(bucket.id, bucket.status === "open"
                    ? { status: "closed", closedDate: props.today }
                    : { status: "open", closedDate: undefined })}
                >
                  {t(lang, bucket.status === "open" ? "budgetClose" : "budgetReopen")}
                </Button>
```

```tsx
                <Button
                  variant="destructive"
                  size="xs"
                  aria-label={`${t(lang, "budgetRemoveBucket")} – ${bucket.name}`}
                  onClick={() => removeBucket(bucket.id)}
                  title={t(lang, "budgetRemoveBucket")}
                >
                  {t(lang, "budgetRemoveBucket")}
                </Button>
```

★ Two buckets can legitimately share a NAME. If the collision test still fails after
this step because two fixture buckets are identically named, that is the same
free-text-repeats problem `buildRowTokens` exists for — thread a token from
`src/app/row-tokens.ts` instead of the bare name, exactly as the RAID and Documents
surfaces do. Do NOT fall back to the bucket id: uuids and bare numbers read as
character-salad aloud.

- [ ] **Step 6: Run the test and confirm it passes**

```bash
npx vitest run src/app/budget-panel.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t4.log
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"; head -20 /tmp/tsc.log
```

Expected: `EXIT=0` from both.

- [ ] **Step 7: Prove the collision test is not vacuous (mutation)**

Temporarily revert ONE `aria-label` — the Edit button's — and re-run.

Expected: RED, naming the Edit button. Restore it with an inverse anchored `Edit`, then
confirm `git diff --stat src/app/budget-panel.tsx` lists only the intended change.

- [ ] **Step 8: Commit**

```bash
git add src/app/budget-panel-cards.tsx src/app/budget-panel.tsx src/app/budget-panel.test.tsx
git commit -m "fix: give bucket-scoped budget controls bucket-unique accessible names"
```

---

### Task 5: §246 — `SortResizeTh` gains an appended name context

**Files:**
- Modify: `src/app/report-table.tsx`, `src/app/reports.tsx`
- Test: `src/app/report-table.test.tsx`, `src/app/reports.test.tsx`

**Context you need.** `reports.tsx` embeds three tables — Assignee, Group, Labels —
whose headers reuse generic labels ("Open", "Cancelled", "Overdue", "Total",
"Inquiries", "Completed"). These are NOT same-purpose controls: "Open" in the Assignee
table sorts a different table from "Open" in the Group table, so WCAG 2.4.6 is
genuinely failed. Every sortable header in the app flows through `SortResizeTh`.

★★★ **APPEND, never prefix, never replace.** WCAG 2.5.3 requires the visible label to be
CONTAINED in the accessible name — containment, not prefix. AGENTS.md records that
reading a prefix rule into 2.5.3 flags conformant code, and this repo already has a
conformant control that fails a prefix test. Front-position is a best practice living in
a NOTE attached to the SC, not in its normative text; do not enforce it as the rule.

★★ `SortHeaderButton` today has NO `aria-label` — its name comes from CONTENT (`{label}`
plus an `aria-hidden` sort glyph). Adding an `aria-label` changes the accessible name
but NOT `textContent`, so the existing glyph assertions that read `textContent` are
unaffected. Queries that select a header BY NAME are affected, and only in `reports.tsx`
— see Step 6.

- [ ] **Step 1: Write the failing primitive tests**

Append to `src/app/report-table.test.tsx`:

```tsx
  // §246. Two assertions, and the second is the one that stops a future
  // "just use the context as the name" simplification: 2.5.3 requires the
  // VISIBLE label to be contained in the accessible name.
  it("appends nameContext to the header button's accessible name", () => {
    render(
      <table><thead><tr>
        <SortResizeTh
          label="Open" sortCol="open" sortKey={null} sortDir="off"
          onSort={() => {}} nameContext="By assignee"
        />
      </tr></thead></table>,
    );
    expect(screen.getByRole("button", { name: "Open – By assignee" })).toBeInTheDocument();
  });

  it("keeps the visible label inside the accessible name and unchanged on screen", () => {
    render(
      <table><thead><tr>
        <SortResizeTh
          label="Open" sortCol="open" sortKey={null} sortDir="off"
          onSort={() => {}} nameContext="By assignee"
        />
      </tr></thead></table>,
    );
    const btn = screen.getByRole("button", { name: "Open – By assignee" });
    expect(btn.textContent).toBe("Open");
    expect(btn.getAttribute("aria-label")).toContain("Open");
  });

  it("leaves the accessible name bare when no nameContext is given", () => {
    render(
      <table><thead><tr>
        <SortResizeTh label="Open" sortCol="open" sortKey={null} sortDir="off" onSort={() => {}} />
      </tr></thead></table>,
    );
    const btn = screen.getByRole("button", { name: "Open" });
    expect(btn.getAttribute("aria-label")).toBeNull();
  });
```

★ The third case is load-bearing: every other `SortResizeTh` call site in the app passes
no context, and this pins that they keep a bare content-derived name rather than
acquiring an `aria-label` that merely repeats it.

- [ ] **Step 2: Run and confirm the first two fail**

```bash
npx vitest run src/app/report-table.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Unable to find" /tmp/t5.log | head
```

Expected: the first two FAIL (`Unable to find … name: "Open – By assignee"`); the third
PASSES already.

- [ ] **Step 3: Thread the prop through both components**

In `src/app/report-table.tsx`, add `nameContext` to `SortHeaderButton`'s parameters and
type:

```tsx
  /** Appended to the button's accessible name to disambiguate a label reused by
   *  a sibling table in the same view (open-followups §246). The VISIBLE label
   *  is unchanged, and stays contained in the name — WCAG 2.5.3 requires
   *  containment, not a prefix. */
  nameContext?: string;
```

and set the attribute on the `<button>`:

```tsx
      aria-label={nameContext ? `${label} – ${nameContext}` : undefined}
```

★ `undefined` and not `""`: an empty `aria-label` would blank the name entirely rather
than falling back to content.

Add the same `nameContext?: string;` to `SortResizeTh`'s parameters and type, with a
one-line doc comment pointing at `SortHeaderButton`, and forward it:

```tsx
      <SortHeaderButton
        label={label}
        active={active}
        dir={sortDir}
        onClick={() => onSort(sortCol)}
        hint={hint}
        title={title}
        nameContext={nameContext}
      />
```

- [ ] **Step 4: Run the primitive tests**

```bash
npx vitest run src/app/report-table.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t5.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Write the failing reports collision test**

Append to `src/app/reports.test.tsx`:

```tsx
  // §246: three embedded tables reusing generic column labels. The names are
  // NOT same-purpose — "Open" in the assignee table sorts a different table
  // from "Open" in the group table — so this is a genuine 2.4.6 failure.
  it("gives every sortable header a table-unique accessible name", () => {
    const { container } = renderReports();
    expectRowUniqueNames({
      minControls: 15,
      scope: container,
      roles: ["button"],
      requireCollisionSeed: true,
    });
  });
```

★ Take `minControls` from the error on first run and pin the MEASURED value.

- [ ] **Step 6: Thread the context from the three call sites**

★ `reports.tsx` contains ZERO `SortResizeTh` — all four live in `reports-tables.tsx`.
Confirm before editing:

```bash
grep -c "<SortResizeTh" src/app/reports.tsx src/app/reports-tables.tsx
```

Expected: `0` and `4`.

(a) In `src/app/reports-tables.tsx`, add a **required** `nameContext: string` to BOTH
`AssigneeTable` and `GroupOrLabelTable`, and forward it to every `SortResizeTh` they
render:

```tsx
  /** The table's own visible heading, appended to each sortable header's
   *  accessible name. REQUIRED rather than optional so `tsc` is the completeness
   *  check: these two components are the only tables in the app rendered as
   *  siblings of another table of the same shape, and a missed call site is
   *  exactly the §246 defect. */
  nameContext: string;
```

★★ Required, not optional, is deliberate — it makes `npx tsc --noEmit` enumerate every
call site for you instead of leaving one silently un-updated. Run tsc immediately after
adding the prop and before touching `reports.tsx`; the errors ARE the call-site list.

(b) In `src/app/reports.tsx`, pass each table's own `<Section title>` string, so the
announced context is exactly the heading a sighted user reads above it:

```tsx
        <AssigneeTable
          nameContext={t(lang, "reportsByAssignee")}
```

```tsx
        <GroupOrLabelTable
          nameContext={t(lang, "reportsByGroup")}
```

```tsx
        <GroupOrLabelTable
          nameContext={t(lang, "reportsByLabel")}
```

★ Do NOT derive the context from `GroupOrLabelTable`'s existing `headerKey` prop. It is
`"group" | "labels"`, a raw column key rather than the section heading, and `AssigneeTable`
has no equivalent — deriving from it would give two tables a context in one vocabulary
and the third in another.

(c) Then find every test that selected one of these headers by name and update it:

```bash
grep -rn 'getByRole("button", { name: "Open"' src/app/reports.test.tsx
grep -rn "getByRole(\"button\"" src/app/reports.test.tsx | head -20
```

★★ RTL's string `name` is a WHOLE-STRING match with no `exact` option, so a query for
`"Open"` no longer matches `"Open – By assignee"` and fails loudly rather than silently
selecting the wrong control. That is the good direction. Update each to the qualified
name. Do NOT reach for a regex to make the old queries pass — that reintroduces the
ambiguity this task removes.

★★ This rule is TESTING-LIBRARY ONLY. Playwright's `getByRole` has an `exact` option
DEFAULTING TO FALSE, so a bare name there is a case-insensitive SUBSTRING. If any
`e2e/` spec selects one of these headers, pass `exact: true`:

```bash
grep -rn "Overdue\|Inquiries" e2e/ | head
```

- [ ] **Step 7: Run both suites and typecheck**

```bash
npx vitest run src/app/reports.test.tsx src/app/report-table.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t5.log
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"; head -20 /tmp/tsc.log
```

Expected: `EXIT=0` from both. `tsc` is what catches a test-only type error — `next build`
does not typecheck `*.test.tsx` and vitest never typechecks at all.

- [ ] **Step 8: Commit**

```bash
git add src/app/report-table.tsx src/app/report-table.test.tsx src/app/reports-tables.tsx src/app/reports.tsx src/app/reports.test.tsx
git commit -m "fix: disambiguate sortable headers reused across embedded report tables"
```

---

### Task 6: §289 — milestones stamp `localModifiedAt`

**Files:**
- Modify: `src/app/milestones-panel.tsx`
- Test: `src/app/milestones-panel.test.tsx`

**Context you need.** `Milestone` carries an optional `localModifiedAt`, but
`milestones-panel.tsx`'s `save` never writes it, so the register has no modification
time at all. The other three bulk-edit registers (RAID, changes, stakeholders) already
pass `stampField: "localModifiedAt"` to their capture.

★★★ **ORDER IS LOAD-BEARING. The apply goes FIRST.** `stampField` does not restore a
prior stamp — it writes a fresh `new Date().toISOString()` on undo AND redo. Adding it
to the capture alone would produce a stamp that appears ONLY when a user REVERSES
something, which is strictly worse than the current uniform absence.

★ Already verified, so do not re-derive it: `localModifiedAt` is a member of
`DEFAULT_DIFF_SKIP` in `activity-log.ts`, so stamping adds no field-change noise to
activity entries.

```bash
grep -n "DEFAULT_DIFF_SKIP" -A 6 src/app/activity-log.ts
```

- [ ] **Step 1: Write the failing apply test**

Append to `src/app/milestones-panel.test.tsx`:

```tsx
  // §289. The APPLY, and it goes first — see the undo test below for why.
  it("stamps localModifiedAt when a milestone is saved", async () => {
    const setMilestones = vi.fn();
    renderMilestones({ setMilestones });
    await saveMilestoneEdit({ name: "Kickoff" });
    const updater = setMilestones.mock.calls.at(-1)?.[0];
    const next = typeof updater === "function" ? updater([{ id: 1, name: "old", date: "2026-01-01", linkedTaskIds: [], knowledgeLinks: [] }]) : updater;
    expect(next[0].localModifiedAt).toEqual(expect.any(String));
  });
```

★ Adapt `renderMilestones` / `saveMilestoneEdit` to the helpers that file already uses —
do not introduce new ones. The assertion is what matters: the SAVED item carries a
stamp.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/milestones-panel.test.tsx -t "stamps localModifiedAt when a milestone is saved" > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests |undefined" /tmp/t6.log | head
```

Expected: FAIL — `localModifiedAt` is `undefined`.

- [ ] **Step 3: Stamp in `save`**

In `src/app/milestones-panel.tsx`, change the `finalItem` line inside `save`:

```tsx
    // §289: the apply stamps, so the bulk-undo `stampField` below has a real
    // apply-time timestamp to refresh rather than inventing one. Order matters:
    // stamping only on undo would produce a modification time that appears ONLY
    // when a user REVERSES something.
    const finalItem: Milestone = { ...next, id, localModifiedAt: new Date().toISOString() };
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npx vitest run src/app/milestones-panel.test.tsx -t "stamps localModifiedAt when a milestone is saved" > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t6.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Write the failing bulk-undo test**

```tsx
  // §289, second half. `stampField` writes a FRESH stamp on undo and redo — it
  // does not restore the prior one — so the assertion is that the stamp MOVED
  // past the apply-time one, never that it equals some captured value.
  it("refreshes localModifiedAt when a bulk edit is undone", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-29T10:00:00.000Z"));
      const captured: { stampField?: string } = {};
      renderMilestones({ captureFieldRows: (a: { stampField?: string }) => Object.assign(captured, a) });
      runBulkEdit();
      expect(captured.stampField).toBe("localModifiedAt");
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 6: Add `stampField` to the bulk capture**

In `src/app/milestones-panel.tsx`, in the bulk-edit handler:

```tsx
    if (edits.length) captureFieldRows?.({ setter: setMilestones, kind: "bulk.edit", edits, entityKey: "milestone", stampField: "localModifiedAt" });
```

- [ ] **Step 7: Replace the stale comment**

★★★ The long comment above that line currently argues that milestones deliberately do
NOT stamp, and ends with a paragraph saying the decision has since been reversed. Once
this task lands, that comment describes code that no longer exists. **Leaving a comment
that forbids the present is a defect class this repo has already paid for.** Delete the
whole block and replace it with:

```tsx
    // §289 (closed): milestones stamp `localModifiedAt` on both the apply
    // (`save`, above) and the bulk undo, matching RAID, changes and
    // stakeholders. `stampField` writes a FRESH ISO timestamp on undo AND redo
    // — the reversal is itself a local modification — it does not restore the
    // prior stamp. The apply had to land FIRST: adding this alone would give
    // the register a modification time that appears only when a user REVERSES
    // something. `localModifiedAt` is in `activity-log.ts`'s DEFAULT_DIFF_SKIP,
    // so neither write adds field-change noise to the activity log.
```

- [ ] **Step 8: Run the whole file and typecheck**

```bash
npx vitest run src/app/milestones-panel.test.tsx > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t6.log
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"; head -20 /tmp/tsc.log
```

Expected: `EXIT=0` from both. ★ If an unrelated test in this file now fails on an
unexpected `localModifiedAt` in a snapshot or `toEqual`, that is a REAL consequence of
the change, not a broken test — update the expectation rather than weakening the stamp.

- [ ] **Step 9: Commit**

```bash
git add src/app/milestones-panel.tsx src/app/milestones-panel.test.tsx
git commit -m "fix: stamp localModifiedAt on milestone save and bulk undo"
```

---

### Task 7: Close the register entries and release

**Files:**
- Modify: `docs/open-followups.md`, `CHANGELOG.md`, `src/app/version.ts`

★★★ **A register closure is a FOUR-PLACE edit**, and missing one breaks every count:
the `## N.` heading marker, the body `**Status:**` line, the index-table row, and the
row's anchor. ★ `— CLOSED` belongs in the HEADING only; a `**Status:**` line containing
the word CLOSED fails `npm run followups:status:check`.

- [ ] **Step 1: Run the full suite before touching docs**

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

Expected: `EXIT=0`. A red carrying `Failed to start forks worker` is contention — re-run
with `--maxWorkers=4` before treating it as a failure.

- [ ] **Step 2: Close §146, §246 and §289**

Mark each heading `— CLOSED 2026-08-29`, update each `**Status:**` line to state what
landed and cite the command that verifies it, and update the index table row and anchor
for each. For §246, record explicitly that its roles-editor OPEN QUESTION was settled as
a CONTENT GAP rather than a same-purpose case, and why. For §146, record that the
prescribed reason-union was deliberately NOT built and that the fix is internal to the
primitive — a future reader must not re-derive the union from the closed entry.

- [ ] **Step 3: Verify the register gates**

```bash
npm run followups:status:check > /tmp/f.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/f.log
npm run docs:claims:check > /tmp/d.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/d.log
npm run docs:symbols:check > /tmp/s.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/s.log
```

Expected: `EXIT=0` from all three. ★ Exit **1** is DRIFT (fix the content); exit **2**
means the gate could not scan at all (fix the gate's input). They demand opposite
responses. ★ `docs:claims:check` is a RATCHET — do NOT add a new `path:LINE` citation
anywhere; cite symbols and commands.

- [ ] **Step 4: Bump the version and write the changelog**

Set `APP_VERSION`, `APP_BUILD_DATE` and `APP_MILESTONE` in `src/app/version.ts` — a
MINOR bump takes a NEW codename, a patch keeps the current one. Add the `CHANGELOG.md`
entry. ★ Never put a `[session link removed]...` URL in `CHANGELOG.md`.

Then propagate rather than hand-editing the eight satellite files:

```bash
npm run version:sync
npm run version:check > /tmp/v.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/v.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Run the remaining blocking gates**

```bash
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npm run size:check > /tmp/z.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/z.log
npm run dup:check > /tmp/p.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/p.log
```

Expected: `EXIT=0` from each. ★ `npm run lint` exits 1 from leftovers in gitignored
`.worktrees/` and `.demo-tmp/` — use `npx eslint src`. ★ Do not pipe any of these.

- [ ] **Step 6: Axe the two touched scanned views**

Budget and Reports are both in `A11Y_VIEWS`.

```bash
curl -o /dev/null -s http://localhost:3000/
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Budget|Reports" > /tmp/a.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a.log
```

★★★ `--workers=1` is REQUIRED whenever more than one view is matched: CI runs axe
serially and local runs it at CPU count, and over-subscribed tests die on
`Test timeout of 60000ms exceeded` inside `page.evaluate` — a FAILURE with a screenshot
and zero violation text. Read the failure BODY: a real violation names a rule id and an
impact. ★ Warm the route first so a cold Turbopack compile does not eat the timeout.

★★ A green run here proves NOTHING about this slice's actual subject — axe has no rule
for duplicate accessible names or focus restoration. It is a regression check that the
edits broke nothing else.

- [ ] **Step 7: Eye-verify the budget layout (OWED, and it is a gate)**

Task 3 removed two elements from every period cell and added a legend. jsdom has no
layout, so nothing in the unit suite can see the result. Open the Budget panel on a
project with at least two buckets and two periods, and confirm: the Budget and Actual
input rows still align, the legend renders once above the bucket list, and no column
has visibly reflowed.

★ Do not skip this and do not report the slice complete without it. An owed eye-verify
recorded and not done is how three earlier slices shipped with a visual defect nothing
could catch.

- [ ] **Step 8: Commit**

```bash
git add docs/open-followups.md CHANGELOG.md src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS
git commit -m "docs: close the shared-primitive a11y follow-ups and release"
```

---

## Notes for the executor

- **Do not push, open an MR, or merge** unless the user says so explicitly. "Release"
  means push → MR → poll the pipeline → merge on green, and merging uses
  `--auto-merge=false` (glab defaults it to `true`).
- **Never `git commit --amend`** — this is a shared worktree and an amend has twice
  swallowed another session's commit. Use new commits and `git commit --only <paths>`.
- **Never bare `git stash` / `git stash pop`** — the stash stack is shared across
  worktrees.
- **Never run `npm ci`** — it wipes `node_modules` and aborts on a Windows EPERM lock.
- If a task's `minControls` floor throws, read the ACTUAL count from the error and pin
  that. Never lower a floor to 1 to get green.
