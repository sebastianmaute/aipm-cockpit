# Dashboard Reset-Layout Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the dashboard's existing "Reset layout" control out from under the tile grid into the top-right Print / Reset-size stack, as an icon-only button carrying a new `RotateCcwSquare` glyph.

**Architecture:** No engine change. `DEFAULT_LAYOUT` and `useDashboardLayout().reset()` already exist and are tested; this slice only relocates the control, changes its form from a ghost text button to an `IconButton`, and adds one glyph to the icon barrel. Three files carry code (`icons.ts`, `task-manager-ui.tsx`, `dashboard-panel.tsx`), two carry tests.

**Tech Stack:** Next.js 16 / React, TypeScript, Tailwind v4, vitest + @testing-library/react, lucide-react 1.31.0 behind the `src/app/icons.ts` barrel.

**Spec:** `docs/superpowers/specs/2026-09-02-dashboard-reset-layout-button-design.md`

---

## Before you start — environment rules that will bite

- **Every `src/app/*.ts(x)` file is CRLF** (`git ls-files --eol` reports `i/lf w/crlf`). Use the **Edit** tool, never **Write** — Write re-lines the file to LF, which is invisible in `git diff` and breaks the next anchored edit. If you script an edit in node, your anchors must contain `\r\n`, not `\n`.
- **Never read a gate's exit code through a pipe.** `npm run test:run | tail -5` reports `tail`'s status. Redirect, echo `$?` unpiped, then grep the file.
- **`npx tsc --noEmit` exits 2 on diagnostics**, not 1.
- **Never run two vitest processes at once.** A vitest failure whose log contains `Failed to start forks worker` is machine contention, not a red test — re-run that file alone.
- `npm run lint` exits 1 from gitignored leftovers; use `npx eslint src` (or the specific files).

## File structure

| File | Responsibility after this slice |
|---|---|
| `src/app/icons.ts` | barrel; gains ONE export, `RotateCcwSquare as RotateCcwSquareIcon` |
| `src/app/icons.test.ts` | barrel ratchet; gains one `EXPECTED` row, count 69 → 70 |
| `src/app/task-manager-ui.tsx` | owns the control family; gains `ResetLayoutIcon` + `ResetLayoutButton` beside `ResetSizeIcon` / `ResetSizeButton` / `PrintButton` |
| `src/app/dashboard-panel.tsx` | renders the button in the top stack under `!arrangement.readOnly`; the old ghost button, its wrapper and the now-unused `Button` import are deleted |
| `src/app/dashboard-panel.test.tsx` | de-vacuumed popout assertion + three new tests |

---

## Task 1: Add the `RotateCcwSquareIcon` glyph to the barrel

**Files:**
- Modify: `src/app/icons.ts`
- Test: `src/app/icons.test.ts`

The barrel re-exports lucide glyphs under old heroicons names, sorted by the **exported** name. `RotateCcwSquareIcon` sorts between `RectangleStackIcon` and `ShieldCheckIcon`. Adding an export is a deliberate three-place edit: the barrel line, the `EXPECTED` row, and a hardcoded count whose own comment says to bump it only on purpose.

- [ ] **Step 1: Write the failing test**

In `src/app/icons.test.ts`, add a row to the `EXPECTED` map immediately after the `RectangleStackIcon` row (currently line 72), keeping alphabetical order:

```ts
  RectangleStackIcon: "GalleryVerticalEnd",
  RotateCcwSquareIcon: "RotateCcwSquare",
  ShieldCheckIcon: "ShieldCheck",
```

And bump the count literal in the same file:

```ts
  it("exports 70 icons", () => {
    expect(Object.keys(icons)).toHaveLength(70);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/icons.test.ts --maxWorkers=1`

Expected: FAIL. Two of them — `exports exactly the expected icon set` (the key sets differ by `RotateCcwSquareIcon`) and `RotateCcwSquareIcon resolves to the lucide RotateCcwSquare glyph` (`RotateCcwSquareIcon is not exported`). Record the tally as `N failed / M passed`.

- [ ] **Step 3: Add the barrel export**

In `src/app/icons.ts`, inside the `export { … } from "lucide-react"` block, insert after the `GalleryVerticalEndIcon as RectangleStackIcon,` line (currently line 162):

```ts
  GalleryVerticalEndIcon as RectangleStackIcon,
  RotateCcwSquare as RotateCcwSquareIcon,
  ShieldCheckIcon,
```

Note the left-hand side is `RotateCcwSquare` with **no** `Icon` suffix — that is lucide's real export name, and `icons.test.ts` asserts the resolved `displayName` is exactly `"RotateCcwSquare"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/icons.test.ts --maxWorkers=1`

Expected: PASS, all tests in the file. The `★★★ maps no two app names onto the same glyph` test passing is the point — it proves the new row did not repoint at a glyph another name already owns.

- [ ] **Step 5: Commit**

```bash
git add src/app/icons.ts src/app/icons.test.ts
git commit -m "feat(icons): add RotateCcwSquareIcon to the barrel"
```

---

## Task 2: Add `ResetLayoutIcon` and `ResetLayoutButton`

**Files:**
- Modify: `src/app/task-manager-ui.tsx`

No test in this task: these are two presentational declarations with no branching, and Task 4 pins them through the surface that renders them. Adding a test here that renders `ResetLayoutButton` in isolation would assert only that `IconButton` works.

- [ ] **Step 1: Import the glyph**

In `src/app/task-manager-ui.tsx`, extend the existing import block at the top of the file (alphabetical by imported name — `RotateCcwSquareIcon` goes after the `PrinterIcon` line, before `ViewColumnsIcon`):

```tsx
import {
  ArrowsPointingInIcon,
  ArrowTopRightOnSquareIcon,
  BackspaceIcon,
  PrinterIcon as PrinterHeroIcon,
  RotateCcwSquareIcon,
  ViewColumnsIcon,
} from "./icons";
```

- [ ] **Step 2: Add the icon wrapper**

Immediately after the existing `ResetColWidthsIcon` declaration (currently lines 76-78), add:

```tsx
export function ResetLayoutIcon() {
  return <RotateCcwSquareIcon aria-hidden="true" className="h-4 w-4" />;
}
```

- [ ] **Step 3: Add the button**

Immediately after the existing `ResetSizeButton` declaration (it ends around line 200), add:

```tsx
/** Icon button that restores a dashboard's tile arrangement to DEFAULT_LAYOUT.
 *
 *  ★★ Its accessible name MUST differ from `ResetSizeButton`'s. Two adjacent
 *  reset buttons sharing a name is a WCAG 2.4.6 failure that axe cannot see —
 *  a name merely existing satisfies every rule the gate runs. Here
 *  `dashboardResetLayout` ("Reset layout") and `tableResetSizeHint` ("Reset
 *  back to the default size.") are distinct, and must stay so. */
export function ResetLayoutButton({
  onClick,
  lang,
}: {
  onClick: () => void;
  lang: Lang;
}) {
  return (
    <IconButton
      variant="bordered"
      size="md"
      onClick={onClick}
      label={t(lang, "dashboardResetLayout")}
      title={t(lang, "dashboardResetLayout")}
    >
      <ResetLayoutIcon />
    </IconButton>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit; echo "EXIT=$?"`

Expected: `EXIT=0`. (This command exits **2** on diagnostics, not 1.)

- [ ] **Step 5: Commit**

```bash
git add src/app/task-manager-ui.tsx
git commit -m "feat(ui): add ResetLayoutButton beside Print and ResetSize"
```

---

## Task 3: De-vacuum the popout assertion BEFORE moving the button

**Files:**
- Modify: `src/app/dashboard-panel.test.tsx`

Do this task **before** Task 4. The existing popout test asserts the layout reset is absent by querying its **visible text**. The moment the button becomes icon-only it renders no text node, so that assertion would pass whether or not the read-only guard exists — it stops guarding at exactly the commit that introduces the risk. Correcting it first means Task 4 lands against a test that can actually fail.

- [ ] **Step 1: Correct the assertion**

In `src/app/dashboard-panel.test.tsx`, in the test named `renders no grip, menu, shelf or reset in a popout (read-only)`, replace this line:

```tsx
    expect(screen.queryByText(t(EN, "dashboardResetLayout"))).toBeNull();
```

with:

```tsx
    // ★★★ queryByRole, NOT queryByText. This button is icon-only, so it renders
    // no text node and a text query passes whether it is guarded or not — the
    // assertion would read as coverage while pinning nothing. The accessible
    // name is the only observable that survives the icon-only form.
    expect(
      screen.queryByRole("button", { name: t(EN, "dashboardResetLayout") }),
    ).toBeNull();
```

- [ ] **Step 2: Run the file to verify it still passes**

Run: `npx vitest run src/app/dashboard-panel.test.tsx --maxWorkers=1`

Expected: PASS, `Tests 70 passed (70)`. It passes for the old reason right now (the ghost button is guarded and absent in popouts); Task 4 is what makes it load-bearing for the new form.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard-panel.test.tsx
git commit -m "test(dashboard): assert the popout reset by accessible name, not text"
```

---

## Task 4: Move the button into the top stack

**Files:**
- Modify: `src/app/dashboard-panel.tsx`
- Test: `src/app/dashboard-panel.test.tsx`

`arrangement` is created at line 249, well above the stack, so it is in scope at the new site.

- [ ] **Step 1: Write the failing tests**

In `src/app/dashboard-panel.test.tsx`, add this block after the existing popout test:

```tsx
describe("DashboardPanel reset-layout control", () => {
  it("renders the reset button in the top control stack", () => {
    render(<DashboardPanel {...fullProps} projectId="p-reset-present" />, { wrapper });
    expect(
      screen.getByRole("button", { name: t(EN, "dashboardResetLayout") }),
    ).toBeInTheDocument();
  });

  // ★ AGENTS.md pins the trailing group as Print · reset-columns ·
  // reset-pane-size. Reset layout is the reset-columns ANALOGUE (it restores
  // content arrangement, where reset-size restores the pane box), so it sorts
  // between them.
  it("orders the stack Print, Reset layout, Reset size", () => {
    render(<DashboardPanel {...fullProps} projectId="p-reset-order" />, { wrapper });
    expectButtonOrder(["printHint", "dashboardResetLayout", "tableResetSizeHint"], {
      contiguous: true,
    });
  });

  it("restores a hidden tile when the reset button is clicked", async () => {
    const user = userEvent.setup();
    render(<DashboardPanel {...fullProps} projectId="p-reset-click" />, { wrapper });
    await user.click(screen.getByRole("button", { name: kebab("Progress") }));
    const menu = screen.getByRole("dialog", { name: kebab("Progress") });
    await user.click(within(menu).getByRole("button", { name: t(EN, "dashboardTileHide") }));
    expect(screen.queryByTestId("tile-progress")).toBeNull();

    await user.click(screen.getByRole("button", { name: t(EN, "dashboardResetLayout") }));
    expect(screen.getByTestId("tile-progress")).toBeInTheDocument();
  });
});
```

Add the helper import at the top of the file, beside the other imports:

```tsx
import { expectButtonOrder } from "../test/toolbar-order";
```

`expectButtonOrder` throws when a key matches zero or several buttons, which a hand-rolled `findIndex` would not — do not replace it with one. `contiguous: true` is what catches a control drifting *between* two members of the group.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/dashboard-panel.test.tsx --maxWorkers=1`

Expected: **exactly one failure** — `orders the stack Print, Reset layout, Reset size`. Record the tally as `N failed / M passed`; N + M must equal 73, so this reads `1 failed / 72 passed`.

★★ **The other two new tests PASS before the change, and that is correct, not a mistake.** A text button's content IS its accessible name, so `getByRole("button", { name: "Reset layout" })` already finds today's ghost button, and that button already resets. Only the ORDER test can see the move. The other two are regression pins for the new site — they are what will fail if a later edit drops the button or unwires it, and Task 5 proves the guard separately. If `renders the reset button…` fails at THIS step, something is already broken; stop and find out what.

- [ ] **Step 3: Render the button in the top stack**

In `src/app/dashboard-panel.tsx`, replace the stack:

```tsx
          <div className="flex shrink-0 flex-col gap-2 print:hidden">
            <PrintButton lang={lang} />
            <ResetSizeButton onClick={resetSize} lang={lang} />
          </div>
```

with:

```tsx
          <div className="flex shrink-0 flex-col gap-2 print:hidden">
            <PrintButton lang={lang} />
            {/* ★★★ The `!arrangement.readOnly` guard is LOAD-BEARING and is not
                inherited here. It used to come from the block below the grid
                that this button was lifted out of; the stack itself is gated
                only on `print:hidden`. Without it a popout — a surface with no
                grip, no ⋮ menu and no shelf by design — gains a working reset. */}
            {!arrangement.readOnly && (
              <ResetLayoutButton onClick={arrangement.reset} lang={lang} />
            )}
            <ResetSizeButton onClick={resetSize} lang={lang} />
          </div>
```

- [ ] **Step 4: Delete the old button and its wrapper**

In the same file, replace:

```tsx
        {!arrangement.readOnly && (
          <div className="print:hidden">
            <div className="flex justify-end">
              <Button variant="ghost" size="xs" onClick={arrangement.reset}>
                {t(lang, "dashboardResetLayout")}
              </Button>
            </div>
            <DashboardShelf
```

with:

```tsx
        {!arrangement.readOnly && (
          <div className="print:hidden">
            <DashboardShelf
```

- [ ] **Step 5: Update the two imports**

In the same file, extend the `task-manager-ui` import (line 14):

```tsx
import { PrintButton, ResetLayoutButton, ResetSizeButton } from "./task-manager-ui";
```

and **delete** the now-unused `Button` import (line 30):

```tsx
import { Button } from "./button";
```

That was `Button`'s only use in this file. `npx eslint` runs with `--max-warnings=0`, so an unused import is a **fatal** error, not a warning.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/app/dashboard-panel.test.tsx --maxWorkers=1`

Expected: PASS, `Tests 73 passed (73)`.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx
git commit -m "feat(dashboard): move Reset layout into the top control stack"
```

---

## Task 5: Mutation-prove the guard and the order

**Files:**
- Modify (temporarily, then revert): `src/app/dashboard-panel.tsx`

A test that has never failed for the reason it claims is not coverage. Each mutant below must **land** (verify by grep before running) and be **reverted** by an inverse anchored edit whose anchor is as unique as the one that applied it. `git checkout -- <file>` is deny-blocked in this repo; revert by editing, then prove the tree is clean with `git diff --stat`.

- [ ] **Step 1: Mutant A — drop the read-only guard**

Replace, in `src/app/dashboard-panel.tsx`:

```tsx
            {!arrangement.readOnly && (
              <ResetLayoutButton onClick={arrangement.reset} lang={lang} />
            )}
```

with:

```tsx
            <ResetLayoutButton onClick={arrangement.reset} lang={lang} />
```

Verify it landed: `grep -c "arrangement.readOnly && (" src/app/dashboard-panel.tsx` must drop by one.

- [ ] **Step 2: Run and record**

Run: `npx vitest run src/app/dashboard-panel.test.tsx --maxWorkers=1`

Expected: FAIL — `renders no grip, menu, shelf or reset in a popout (read-only)`. Record `N failed / M passed`; N + M must equal 73. **This is the step that proves Task 3 was worth doing**: against the un-corrected `queryByText` assertion this mutant would have survived.

- [ ] **Step 3: Revert Mutant A and prove the tree is clean**

Restore the guard exactly as written in Task 4 Step 3, then run:

```bash
git diff --stat src/app/dashboard-panel.tsx
```

Expected: no output — the file matches the commit.

- [ ] **Step 4: Mutant B — put the button in the wrong slot**

Move the guarded `ResetLayoutButton` block to **after** `<ResetSizeButton …/>` inside the same stack div, so the order becomes Print → Reset size → Reset layout.

- [ ] **Step 5: Run and record**

Run: `npx vitest run src/app/dashboard-panel.test.tsx --maxWorkers=1`

Expected: FAIL — `orders the stack Print, Reset layout, Reset size`. Record `N failed / M passed`; N + M must equal 73.

- [ ] **Step 6: Revert Mutant B and prove the tree is clean**

Restore the order from Task 4 Step 3, then:

```bash
git diff --stat src/app/dashboard-panel.tsx
```

Expected: no output.

- [ ] **Step 7: Record the results**

No commit — the tree is unchanged by this task. Report the two tallies (`N failed / M passed` each, N + M = 73) in your summary. If either mutant **survived**, stop: the corresponding test is vacuous and needs fixing before this slice ships.

---

## Task 6: Full gates

**Files:** none modified.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit; echo "EXIT=$?"`

Expected: `EXIT=0`.

- [ ] **Step 2: Lint**

Run: `npx eslint src; echo "EXIT=$?"`

Expected: `EXIT=0`. A non-zero here most likely means the `Button` import deletion in Task 4 Step 5 was missed.

- [ ] **Step 3: The touched test files**

Set `LOG` to a file in **your own session scratchpad** — never `/tmp`, which is shared across sessions and checkouts, where a peer's run has already overwritten another agent's gate log and been read as its own result:

```bash
LOG="$SCRATCHPAD/gates.log"   # your session scratchpad path
npx vitest run src/app/icons.test.ts src/app/dashboard-panel.test.tsx src/app/use-dashboard-layout.test.tsx --maxWorkers=1 > "$LOG" 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " "$LOG"
```

Expected: `EXIT=0`. Note the `echo` is on its own line and unpiped — reading this exit code through a pipe gives the pipe's status, not vitest's.

- [ ] **Step 4: Commit nothing**

This task produces no diff. If it produced one, something in Tasks 1-5 was left unreverted — find it before proceeding.

---

## Out of scope — do not add these

- **No confirmation dialog.** Offered during brainstorming and declined. One click still discards the tile arrangement and every hidden-tile choice with no undo. Do not "improve" this by adding a confirm; it is a recorded decision.
- **No version bump, no `CHANGELOG.md` entry, no release.** This plan ends at Task 6.
- **No change to `DEFAULT_LAYOUT`, `reset()`, `dashboard-layout.ts` or `dashboard-layout-store.ts`.**
- **Reset layout still does not touch pane size.** `resetSize` stays its own control in the same stack.
