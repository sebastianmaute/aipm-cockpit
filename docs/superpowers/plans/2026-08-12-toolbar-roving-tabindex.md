# Rich-Text Toolbar Keyboard Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 15-control rich-text toolbar into a single tab stop with APG-compliant arrow-key navigation, then give it `role="toolbar"` — closing `docs/open-followups.md` §144(a).

**Architecture:** A new pure, DOM-free engine `toolbar-roving.ts` computes the next focus index (mirroring `band-roving.ts`'s shape). `rich-text-toolbar.tsx` holds an active-index state, marks 14 of 15 controls `tabIndex={-1}`, and attaches one `onKeyDown` to the row that drives whichever row fired it. The role is flipped **only after** the behaviour exists — that ordering is the point of the slice, not an accident.

**Tech Stack:** TypeScript, React 19, Next 16, Tiptap 3.27.1, vitest + @testing-library/react + @testing-library/user-event, fast-check, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-12-toolbar-roving-tabindex-design.md`

---

## Background an engineer needs before touching anything

**Why the role does not already exist.** The toolbar deliberately uses `role="group"`, and `rich-text-toolbar.test.tsx` pins `queryByRole("toolbar")` as **null**. That is not an oversight — declaring the toolbar role without the keyboard contract tells a screen-reader user to press arrow keys that do nothing. Build the behaviour first (Tasks 1–4), flip the role after (Task 5).

**Why no existing roving helper is reused.** The repo has three: `useTablistRoving`, `SegmentedControl`'s inline radiogroup, and `band-roving.ts`. The first two **activate on focus** (`useTablistRoving` literally ends in `target.click()`), which is correct for tabs and radios and catastrophic in a toolbar — every arrow keypress would run Bold/Italic/Quote and mutate the user's document. `band-roving.ts` is focus-only but its arithmetic is 2-D. So: new engine, same *shape* as `band-roving.ts`.

**Why the tab-stop index is plain state seeded to 0.** Every control passes `preventFocusSteal`, which suppresses the mousedown default so a click cannot pull focus off the editor and collapse the selection the command applies to. A click therefore **never focuses a toolbar button**, so there is no "last clicked" to track — the index only moves by keyboard.

**Read before implementing:** `docs/AGENTS/ui-shell.md` — it owns the Escape/Tab protocol, and this slice changes Tab inside stacking modals.

**Gate hygiene, repo-wide:** never read a gate's exit code through a pipe. `npm run test:run | tail -8` reports `tail`'s status. Always `cmd > /tmp/x.log 2>&1; echo "EXIT=$?"` then read the file.

---

## File Structure

| File | Responsibility |
|---|---|
| **Create** `src/app/toolbar-roving.ts` | Pure index arithmetic. DOM-free, i18n-free. Coverage-**gated** (a `.ts` file), so its tests must cover every branch. |
| **Create** `src/app/toolbar-roving.test.ts` | Unit + one fast-check property for the engine. |
| **Create** `e2e/rich-text-toolbar-keyboard.spec.ts` | The browser-level proof of the contract. |
| **Modify** `src/app/rich-text-toolbar-button.tsx` | Add a `tabIndex` prop and forward it. |
| **Modify** `src/app/rich-text-toolbar.tsx` | Index constants, roving state, keydown handler, `tabIndex` wiring, role flip. |
| **Modify** `src/app/rich-text-toolbar.test.tsx` | Five new pins; invert the null-role pin; extend the focus-steal pins. |
| **Modify** `AGENTS.md`, `docs/AGENTS/ui-shell.md`, `docs/open-followups.md` | Docs owed. |
| **Modify** `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` | Release. |

★ `src/app/**/*.tsx` is coverage-**excluded** (`vitest.config.ts`), so the two `.tsx` files do not move the coverage gate. `toolbar-roving.ts` does — cover it fully.

★ Before creating `toolbar-roving.ts`, note there is no `toolbar-roving.tsx`; a bare `./toolbar-roving` import therefore cannot hijack an existing component. Verified free at planning time.

---

### Task 1: The pure roving engine

**Files:**
- Create: `src/app/toolbar-roving.ts`
- Test: `src/app/toolbar-roving.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/toolbar-roving.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { moveToolbarFocus } from "./toolbar-roving";

// 15 controls is the real row size (heading trigger + 12 CONTROLS + link + unlink).
const N = 15;

describe("moveToolbarFocus", () => {
  it("steps right and left", () => {
    expect(moveToolbarFocus(N, 0, "ArrowRight")).toBe(1);
    expect(moveToolbarFocus(N, 5, "ArrowLeft")).toBe(4);
  });

  it("wraps in both directions", () => {
    expect(moveToolbarFocus(N, N - 1, "ArrowRight")).toBe(0);
    expect(moveToolbarFocus(N, 0, "ArrowLeft")).toBe(N - 1);
  });

  it("jumps to the ends with Home and End", () => {
    expect(moveToolbarFocus(N, 7, "Home")).toBe(0);
    expect(moveToolbarFocus(N, 7, "End")).toBe(N - 1);
  });

  // ★ Up/Down are deliberately NOT handled: the row is horizontal, and
  // swallowing them would eat page scroll for no gain.
  it("leaves keys outside the model alone, so the caller does not preventDefault", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "Tab", "a", "Escape"]) {
      expect(moveToolbarFocus(N, 3, key)).toBeNull();
    }
  });

  // ★ band-roving.ts's precedent: Alt+Left is browser Back. Swallowing a chord
  // from a toolbar control breaks navigation for keyboard users.
  it("ignores chords, leaving them to the browser or OS", () => {
    expect(moveToolbarFocus(N, 3, "ArrowLeft", { altKey: true })).toBeNull();
    expect(moveToolbarFocus(N, 3, "ArrowRight", { ctrlKey: true })).toBeNull();
    expect(moveToolbarFocus(N, 3, "Home", { metaKey: true })).toBeNull();
  });

  it("returns null for an empty row", () => {
    expect(moveToolbarFocus(0, 0, "ArrowRight")).toBeNull();
  });

  // ★ A stale index can outlive its row (a control added or removed between
  // render and keypress). Clamp rather than throw or return an out-of-range hit.
  it("clamps a stale index instead of returning an out-of-range one", () => {
    expect(moveToolbarFocus(N, 99, "ArrowRight")).toBe(0);
    expect(moveToolbarFocus(N, -4, "ArrowLeft")).toBe(N - 1);
  });

  it("always returns a valid index for a handled bare key", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: -20, max: 70 }),
        fc.constantFrom("ArrowLeft", "ArrowRight", "Home", "End"),
        (count, index, key) => {
          const next = moveToolbarFocus(count, index, key);
          expect(next).not.toBeNull();
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThan(count);
        },
      ),
    );
  });
});
```

★ The property lives in this file rather than a separate `*.property.test.ts`. That split exists for the CPU-heavy suites; `band-roving.test.ts` — the direct precedent, same module shape — has no separate property file either. Follow the sibling.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/toolbar-roving.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
```

Expected: `EXIT=1`, failing to resolve `./toolbar-roving`.

- [ ] **Step 3: Write the implementation**

Create `src/app/toolbar-roving.ts`:

```ts
// Keyboard roving for the rich-text toolbar row. Pure, i18n-free and DOM-free:
// the caller owns focus and state, this owns only "which index next".
//
// ★★★ Why this is not `useTablistRoving` or `SegmentedControl`'s radiogroup
// walk: both ACTIVATE on focus (the tablist hook ends in `target.click()`),
// which is APG-correct for tabs and radios and wrong for a toolbar. Arrowing
// across this row must move focus and nothing else — activating on focus would
// run Bold/Italic/Quote and mutate the user's document on every keypress.
//
// ★ Shape follows band-roving.ts: a pure engine plus a thin React caller. A
// shared 1-D movement engine for tablist + toolbar is a real opportunity and is
// deliberately not taken here — it would refactor two working consumers as a
// rider on an a11y slice.

/** Keys this model handles. Anything else is left to bubble untouched — Tab
 *  must still escape the row, Enter/Space must still reach the control, and
 *  Up/Down must still scroll the page (the row is horizontal). */
const HANDLED = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

/**
 * Next focus index for `key`, or `null` when the key is not part of this model
 * (the caller must then NOT preventDefault).
 *
 * A handled bare key ALWAYS returns an index, so the caller can preventDefault
 * unconditionally for handled keys.
 */
export function moveToolbarFocus(
  count: number,
  index: number,
  key: string,
  modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
): number | null {
  if (count <= 0) return null;
  if (!HANDLED.has(key)) return null;
  // A chord belongs to the browser or the OS — Alt+Left is Back. (Shift is
  // deliberately absent: it produces no competing default here.)
  if (modifiers?.altKey || modifiers?.ctrlKey || modifiers?.metaKey) return null;
  // Clamped, so a stale index surviving a row that changed under it degrades to
  // a neighbour rather than throwing or returning an out-of-range hit.
  const i = Math.min(Math.max(index, 0), count - 1);

  switch (key) {
    case "Home": return 0;
    case "End": return count - 1;
    case "ArrowRight": return (i + 1) % count;
    case "ArrowLeft": return (i - 1 + count) % count;
    default: return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/toolbar-roving.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```

Expected: `EXIT=0`, 8 tests passed.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/tsc.log
```

Expected: `EXIT=0`. (vitest never typechecks — a test-only type error passes the suite and fails CI.)

- [ ] **Step 6: Commit**

```bash
git add src/app/toolbar-roving.ts src/app/toolbar-roving.test.ts
git commit -m "feat(a11y): add the pure toolbar roving engine (§144a)"
```

---

### Task 2: `ToolbarButton` accepts a `tabIndex`

**Files:**
- Modify: `src/app/rich-text-toolbar-button.tsx`
- Test: `src/app/rich-text-toolbar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe("RichTextToolbar", ...)` block in `src/app/rich-text-toolbar.test.tsx`:

```tsx
  // ★★ `<button>` is NATIVELY tabbable, so marking one control tabIndex={0}
  // does nothing on its own — every other control stays reachable and the
  // tab-stop count is unchanged. The -1 on the other fourteen is the line the
  // whole slice's user-visible claim rests on.
  it("puts every control but the active one out of the tab order", () => {
    const { editor } = makeEditor();
    const { container } = render(
      <RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(buttons.filter((b) => b.tabIndex === -1)).toHaveLength(buttons.length - 1);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/rich-text-toolbar.test.ts -t "out of the tab order" > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log
```

Expected: `EXIT=1` — all 15 buttons report `tabIndex === 0` (the DOM default for a button), so the second assertion fails with `0` received.

- [ ] **Step 3: Add the prop**

In `src/app/rich-text-toolbar-button.tsx`, add to `ToolbarButtonProps` (after `ariaControls`):

```ts
  /** Roving tabindex position: 0 for the row's single tab stop, -1 for every
   *  other control. Required for the row's `role="toolbar"` keyboard contract
   *  (open-followups §144a) — a `<button>` is natively tabbable, so omitting
   *  the -1 leaves all fifteen controls in the tab order. */
  tabIndex?: number;
```

Add `tabIndex` to the destructured parameter list (after `ariaControls,`):

```ts
  ariaControls,
  tabIndex,
  ref,
```

And forward it on the `<button>` (after `type="button"`):

```tsx
      type="button"
      tabIndex={tabIndex}
```

- [ ] **Step 4: Verify the test still fails, for the right reason now**

```bash
npx vitest run src/app/rich-text-toolbar.test.ts -t "out of the tab order" > /tmp/t2.log 2>&1; echo "EXIT=$?"
```

Expected: still `EXIT=1` — the prop exists but `rich-text-toolbar.tsx` does not pass it yet. That is Task 4. **Do not fix it here.**

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"
git add src/app/rich-text-toolbar-button.tsx src/app/rich-text-toolbar.test.tsx
git commit -m "feat(a11y): let ToolbarButton carry a roving tabIndex (§144a)"
```

---

### Task 3: Index constants and the count pin

**Files:**
- Modify: `src/app/rich-text-toolbar.tsx`
- Test: `src/app/rich-text-toolbar.test.tsx`

The row's DOM order is: heading trigger, then the 12 `CONTROLS`, then Insert link, then Remove link. The `PopoverPanel` portals to `document.body`, and `ToolbarDivider` renders a `<div>`, so the row's direct `<button>` children are exactly these 15.

- [ ] **Step 1: Write the failing test**

Append inside `describe("RichTextToolbar", ...)`:

```tsx
  // ★ Pins the index arithmetic against the DOM. The constants below are
  // derived from CONTROLS.length rather than hardcoded, and this is what stops
  // them drifting from the JSX if a control is added or removed.
  // ★★ It ALSO pins the no-disabled invariant: no control in this row is ever
  // disabled today, which is why the roving engine needs no skip-disabled
  // logic. Adding a disabled control turns this red and forces that decision
  // rather than silently breaking the arrow order.
  it("has TOOLBAR_CONTROL_COUNT enabled buttons and no disabled one", () => {
    const { editor } = makeEditor();
    const { container } = render(
      <RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons).toHaveLength(TOOLBAR_CONTROL_COUNT);
    expect(buttons.filter((b) => b.disabled)).toEqual([]);
  });
```

Extend the import at the top of the test file:

```tsx
import { RichTextToolbar, TOOLBAR_CONTROL_COUNT } from "./rich-text-toolbar";
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/rich-text-toolbar.test.ts -t "TOOLBAR_CONTROL_COUNT" > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t3.log
```

Expected: `EXIT=1` — `TOOLBAR_CONTROL_COUNT` is not exported.

- [ ] **Step 3: Add the constants**

In `src/app/rich-text-toolbar.tsx`, immediately after the existing `GROUP_DIVIDER_BEFORE` declaration:

```ts
// Roving-tabindex positions, in DOM order: the heading trigger leads, then the
// twelve CONTROLS, then Insert link and Remove link. Derived from
// CONTROLS.length rather than hardcoded, so adding a mark or block cannot
// silently desync the arithmetic from the JSX below.
const HEADING_INDEX = 0;
const CONTROLS_OFFSET = 1;
const LINK_INDEX = CONTROLS.length + 1;
const UNLINK_INDEX = CONTROLS.length + 2;

/** How many focusable controls the row renders. Exported so a test can pin the
 *  arithmetic against the real DOM (open-followups §144a). */
export const TOOLBAR_CONTROL_COUNT = CONTROLS.length + 3;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/rich-text-toolbar.test.ts -t "TOOLBAR_CONTROL_COUNT" > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t3.log
```

Expected: `EXIT=0`, 1 passed. (`TOOLBAR_CONTROL_COUNT` is 15.)

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"
git add src/app/rich-text-toolbar.tsx src/app/rich-text-toolbar.test.tsx
git commit -m "feat(a11y): derive toolbar control indices from CONTROLS (§144a)"
```

---

### Task 4: Roving state, keydown handler, and `tabIndex` wiring

**Files:**
- Modify: `src/app/rich-text-toolbar.tsx`
- Test: `src/app/rich-text-toolbar.test.tsx`

- [ ] **Step 1: Write the four failing tests**

Append inside `describe("RichTextToolbar", ...)`:

```tsx
  // ★★★ THE SECOND TAB IS THE ASSERTION. A first Tab lands on control 1
  // whether or not the roving works — only the second one distinguishes a
  // single-tab-stop row from fifteen tab stops.
  it("is a single tab stop: a second Tab leaves the row entirely", async () => {
    const user = userEvent.setup();
    const { editor } = makeEditor();
    render(
      <>
        <RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />
        <button type="button">after the row</button>
      </>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Text style" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "after the row" }));
  });

  // ★★★ THE PIN THAT CATCHES REUSING useTablistRoving, whose move ends in
  // `target.click()`. Under that helper this test's ArrowRight would have run
  // toggleBold and mutated the document. A toolbar moves focus and nothing else.
  it("moves focus with ArrowRight and runs no command", async () => {
    const user = userEvent.setup();
    const { editor, run } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bold" }));
    expect(run).not.toHaveBeenCalled();
  });

  it("wraps with ArrowLeft and jumps with Home/End", async () => {
    const user = userEvent.setup();
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />);
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove link" }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Text style" }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove link" }));
  });

  // ★★ A SINGLE-TOOLBAR FIXTURE CANNOT SEE THIS. change-edit-modal.tsx mounts
  // three rows; each must rove within itself. Same trap the group-naming test
  // in this file already documents.
  it("keeps two mounted rows roving independently", async () => {
    const user = userEvent.setup();
    const a = makeEditor();
    const b = makeEditor();
    render(
      <>
        <RichTextToolbar editor={a.editor} lang="en-US" label="Description" onAddLink={() => {}} />
        <RichTextToolbar editor={b.editor} lang="en-US" label="Mitigation" onAddLink={() => {}} />
      </>,
    );
    const rowB = screen.getByRole("group", { name: "Mitigation" });
    await user.tab();
    await user.tab(); // out of row A, into row B's single stop
    expect(within(rowB).getByRole("button", { name: "Text style" })).toBe(document.activeElement);
    await user.keyboard("{ArrowRight}");
    expect(within(rowB).getByRole("button", { name: "Bold" })).toBe(document.activeElement);
  });
```

★ The last test queries `role="group"` because Task 5 has not flipped the role yet. Task 5 updates it.

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run src/app/rich-text-toolbar.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t4.log
```

Expected: `EXIT=1`, with the four new tests failing (plus Task 2's tab-order test still red).

- [ ] **Step 3: Add the imports and state**

In `src/app/rich-text-toolbar.tsx`, change the React import line to add the keyboard-event type:

```ts
import { useCallback, useId, useRef, useState, Fragment } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
```

Add the engine import beside the others:

```ts
import { moveToolbarFocus } from "./toolbar-roving";
```

Inside `RichTextToolbar`, immediately after `const closeHeadingMenu = useCallback(...)`:

```ts
  // ★★★ Seeded to 0 and moved by KEYBOARD ONLY — deliberately not "last
  // clicked". Every control passes `preventFocusSteal`, which suppresses the
  // mousedown default so the click cannot pull focus off the editor and
  // collapse the selection the command reads. A click therefore never focuses a
  // toolbar button, so there is no click-focus to track and the usual roving
  // state model collapses to this.
  const [activeIndex, setActiveIndex] = useState(0);

  const handleRowKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    // ★ `e.currentTarget` is the row this handler is attached to, so no ref is
    // needed and the handler is inherently per-row — the three rows
    // change-edit-modal mounts each drive their own. (`useTablistRoving` uses
    // currentTarget for the same reason, there because ONE hook instance serves
    // several strips.)
    // `:scope >` so only THIS row's own controls count. The heading menu is a
    // PopoverPanel portaled to document.body, so its items are never in here.
    const buttons = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > button"),
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    // ★★★ THE PORTAL GUARD. React synthetic events bubble the REACT tree, not
    // the DOM tree, so a keydown inside the OPEN heading menu — whose panel
    // lives under document.body — still arrives here. Without this, arrowing
    // inside the menu would silently rove the row underneath it while the menu
    // appeared to ignore the key. Returning BEFORE preventDefault is essential:
    // the menu's own handling must still see the event.
    if (current === -1) return;

    const next = moveToolbarFocus(buttons.length, current, e.key, e);
    if (next === null) return;
    e.preventDefault();
    setActiveIndex(next);
    buttons[next]?.focus();
  }, []);
```

- [ ] **Step 4: Wire the row and every control**

On the row `<div>`, add the handler (keep `className`, `role`, `aria-label` as they are — Task 5 changes the role):

```tsx
    <div
      onKeyDown={handleRowKeyDown}
      className="flex flex-wrap items-center gap-0.5"
      role={named ? "group" : undefined}
      aria-label={named ? label : undefined}
    >
```

On the heading trigger `ToolbarButton`, add:

```tsx
        tabIndex={activeIndex === HEADING_INDEX ? 0 : -1}
```

On the mapped `CONTROLS` `ToolbarButton`, add:

```tsx
            tabIndex={activeIndex === index + CONTROLS_OFFSET ? 0 : -1}
```

On the Insert-link `ToolbarButton`, add:

```tsx
        tabIndex={activeIndex === LINK_INDEX ? 0 : -1}
```

On the Remove-link `ToolbarButton`, add:

```tsx
        tabIndex={activeIndex === UNLINK_INDEX ? 0 : -1}
```

- [ ] **Step 5: Run the full toolbar suite**

```bash
npx vitest run src/app/rich-text-toolbar.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests |✕" /tmp/t4.log
```

Expected: `EXIT=1`. The four new tests and Task 2's tab-order test now PASS; the pre-existing `"does not claim the toolbar role"` test still passes (the role is still `group`). If anything else is red, fix it before continuing.

★ If `:scope >` misbehaves under this jsdom version, `row.querySelectorAll("button")` is equivalent here — the popover portals out, so the row has no nested buttons. Prefer `:scope >` if it works; it stays correct if a nested element is ever added.

- [ ] **Step 6: Mutation-check the two load-bearing lines**

Verify each guard is actually pinned, and record the counts.

```bash
# (a) Delete the portal guard line `if (current === -1) return;` -> run the suite.
# (b) Change `tabIndex={... ? 0 : -1}` to `tabIndex={0}` on the CONTROLS map -> run the suite.
npx vitest run src/app/rich-text-toolbar.test.ts > /tmp/mut.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/mut.log
```

Expected: each mutant turns at least 1 test red. Revert each mutation after measuring, and write the **counts** into the commit message — never the phrase "mutation-proved".

★ Mutant (a) needs the heading-menu test from Task 5 to be red. If it survives at this point, note it and re-check after Task 5, where that pin lands.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"
git add src/app/rich-text-toolbar.tsx src/app/rich-text-toolbar.test.tsx
git commit -m "feat(a11y): rove focus across the rich-text toolbar (§144a)

The row is now one tab stop: 14 of 15 controls carry tabIndex={-1} and
Left/Right/Home/End move focus between them without activating anything.
Mutation counts: <fill in from Step 6>."
```

---

### Task 5: Flip the role, invert the pinned test

Only now that the contract exists.

**Files:**
- Modify: `src/app/rich-text-toolbar.tsx`
- Test: `src/app/rich-text-toolbar.test.tsx`

- [ ] **Step 1: Rewrite the pinned-null test**

In `src/app/rich-text-toolbar.test.tsx`, replace the existing test whose body is `expect(screen.queryByRole("toolbar")).toBeNull();` (titled "does not claim the toolbar role, whose keyboard contract it does not honour") with:

```tsx
  // ★★ The refusal this replaces was CORRECT for as long as it stood: the APG
  // toolbar role is a KEYBOARD CONTRACT (one tab stop, roving tabindex,
  // Left/Right between controls), and declaring it without the behaviour tells
  // an AT user to press arrow keys that do nothing. The price was 15 tab stops
  // per editor and up to 45 in change-edit-modal. §144(a) built the contract,
  // so the role follows it — that order is the whole point, and this test now
  // pins the opposite of what it used to.
  it("claims the toolbar role, whose keyboard contract it now honours", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />);
    expect(screen.getByRole("toolbar", { name: "Description" })).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });

  // ★ The unnamed branch is unreachable from `src/app` — RichTextEditor.label
  // is a required string and all twelve mounts pass a real one — but it stays
  // pinned so a blank label cannot start announcing an unnamed boundary.
  it("renders no role at all when there is no name for it", () => {
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" label="  " onAddLink={() => {}} />);
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });
```

★ Check the existing file for a test already covering the blank-label case (there is one titled around "treats a blank label as no name"). If it duplicates the second test above, keep the existing one and update its assertions to check `toolbar` instead of `group` rather than adding a second.

- [ ] **Step 2: Add the portal-guard pin**

```tsx
  // ★★★ Pins the portal guard. PopoverPanel renders through createPortal to
  // document.body, but React synthetic events bubble the REACT tree, so this
  // ArrowRight reaches the row's onKeyDown even though the focused menu item is
  // nowhere inside the row in the DOM. Without the guard the row would rove
  // underneath the open menu.
  it("does not rove while the heading menu is open", async () => {
    const user = userEvent.setup();
    const { editor } = makeEditor();
    render(<RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Text style" });
    await user.click(trigger);
    const menu = await screen.findByRole("dialog", { name: "Text style" });
    const firstItem = within(menu).getAllByRole("button")[0];
    act(() => firstItem.focus());
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(firstItem);
  });
```

- [ ] **Step 3: Update the two-row test from Task 4**

Change its `screen.getByRole("group", { name: "Mitigation" })` to:

```tsx
    const rowB = screen.getByRole("toolbar", { name: "Mitigation" });
```

- [ ] **Step 4: Run to verify the role tests fail**

```bash
npx vitest run src/app/rich-text-toolbar.test.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t5.log
```

Expected: `EXIT=1` — the role is still `group`.

- [ ] **Step 5: Flip the role**

In `src/app/rich-text-toolbar.tsx`, change one word on the row `<div>`:

```tsx
      role={named ? "toolbar" : undefined}
```

Then replace the `// ★★★ \`group\`, NEVER \`toolbar\`...` comment block above `const named = ...` with:

```ts
  // ★★★ `toolbar`, and ONLY because the row now honours the contract. The APG
  // toolbar pattern is a KEYBOARD contract — one tab stop for the row, roving
  // tabindex, Left/Right moving focus between controls — and until §144(a) this
  // row implemented none of it, so it correctly declared `group` instead:
  // declaring a role whose interaction the widget does not honour is worse than
  // declaring none, because it tells an AT user to press arrow keys that do
  // nothing. The contract now lives in handleRowKeyDown + the tabIndex wiring
  // below. If either is ever removed, this must go back to `group` in the same
  // commit.
  // ★★ Named or ABSENT, never named generically — see the wrapper's comment.
  const named = label !== undefined && label.trim() !== "";
```

- [ ] **Step 6: Run the whole toolbar suite plus its consumers**

```bash
npx vitest run src/app/rich-text-toolbar.test.ts src/app/rich-text-editor.test.tsx \
  src/app/change-edit-modal.test.tsx src/app/raid-edit-modal.test.tsx \
  src/app/note-log-panel.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5.log
```

Expected: `EXIT=0`. Any consumer asserting `getByRole("group")` against a toolbar must be updated here.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"
git add src/app/rich-text-toolbar.tsx src/app/rich-text-toolbar.test.tsx
git commit -m "feat(a11y): give the rich-text toolbar role=toolbar (§144a)"
```

---

### Task 6: Extend the focus-steal pins to the whole row

The roving state model depends on `preventFocusSteal` holding at **every** control — a control without it would take focus on click and desync `activeIndex` from reality.

**Files:**
- Test: `src/app/rich-text-toolbar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
  // ★★ activeIndex is keyboard-only BECAUSE no control takes focus on click.
  // A control missing preventFocusSteal would both steal the editor selection
  // its command reads AND desync the roving state, so pin the whole row rather
  // than the two controls the older tests happened to cover.
  it("suppresses the mousedown default on every control that runs a command", () => {
    const { editor } = makeEditor();
    const { container } = render(
      <RichTextToolbar editor={editor} lang="en-US" label="Description" onAddLink={() => {}} />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    // The heading trigger deliberately omits it — opening a popover does not
    // blur the contenteditable the way a mark command's focus does.
    const commandButtons = buttons.filter(
      (b) => b.getAttribute("aria-label") !== "Text style",
    );
    expect(commandButtons).toHaveLength(TOOLBAR_CONTROL_COUNT - 1);
    for (const button of commandButtons) {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/rich-text-toolbar.test.ts -t "suppresses the mousedown default" > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t6.log
```

Expected: `EXIT=0` — this pins behaviour that already holds. If it is RED, a control is missing `preventFocusSteal`; add it in `rich-text-toolbar.tsx` and re-run.

- [ ] **Step 3: Commit**

```bash
git add src/app/rich-text-toolbar.test.tsx
git commit -m "test(a11y): pin preventFocusSteal across the whole toolbar row (§144a)"
```

---

### Task 7: The browser-level proof

jsdom models tab order only approximately. §144 owes an eye-verify, and §144(b) has already made one toolbar browser-reachable — reuse that exact path.

**Files:**
- Create: `e2e/rich-text-toolbar-keyboard.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";

// open-followups §144(a): the browser-level proof of the toolbar keyboard
// contract. jsdom models tab order approximately, so the unit pins in
// rich-text-toolbar.test.tsx are necessary but not sufficient.
//
// ★ Reuses §144(b)'s reachable mount: the floating notes window, opened from a
// seeded task's notes badge on Open Points. Every other RichTextEditor mount
// sits behind a modal, an unscanned view, a non-default Settings section, or a
// closed <details>.
test("rich-text toolbar is one tab stop and arrows move within it", async ({ page }) => {
  await gotoApp(page);
  await openView(page, "Open Points");

  // DOM-click so the auto-launched guided tour overlay cannot intercept a real
  // pointer click. Assert it was found, so a rename fails loudly rather than
  // silently testing the Open Points table.
  const opened = await page.evaluate(() => {
    const btn = document.querySelector(
      'button[aria-label="Notes log – Design SSO architecture"]',
    );
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  });
  expect(opened, "Notes badge button not found on Open Points").toBe(true);
  await waitForViewSettled(page);

  await page.getByRole("button", { name: "Text style" }).first().focus();

  // Tag the row the focused control belongs to, so the Tab assertion below
  // cannot accidentally test a different toolbar.
  const tagged = await page.evaluate(() => {
    const row = document.activeElement?.closest('[role="toolbar"]');
    if (!row) return false;
    (row as HTMLElement).dataset.rovingProbe = "1";
    return true;
  });
  expect(tagged, 'focused control has no [role="toolbar"] ancestor').toBe(true);

  // ArrowRight moves focus WITHIN the row and changes no content.
  const before = await page.evaluate(
    () => document.querySelector(".ProseMirror")?.innerHTML ?? "",
  );
  await page.keyboard.press("ArrowRight");
  const afterArrow = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") ?? "",
  );
  expect(afterArrow).toBe("Bold");
  const after = await page.evaluate(
    () => document.querySelector(".ProseMirror")?.innerHTML ?? "",
  );
  expect(after, "arrowing across the toolbar must not change the document").toBe(before);

  // ONE Tab leaves the row — the claim the whole slice rests on.
  await page.keyboard.press("Tab");
  const stillInside = await page.evaluate(() => {
    const row = document.querySelector('[data-roving-probe="1"]');
    return !!row && !!document.activeElement && row.contains(document.activeElement);
  });
  expect(stillInside, "one Tab should leave the toolbar row").toBe(false);
});
```

- [ ] **Step 2: Run it**

```bash
npx playwright test e2e/rich-text-toolbar-keyboard.spec.ts --project=chromium --workers=1 > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e.log
```

Expected: `EXIT=0`, 1 passed.

★★ `--workers=1` always. `playwright.config.ts` sets `workers: CI ? 1 : undefined`, so local runs go at CPU count; over-subscription yields `Test timeout of 60000ms exceeded` failures that name **no rule and no impact** and are NOT real failures. Warm the route first if the server is cold (`curl -o /dev/null http://localhost:3000/`).

- [ ] **Step 3: Commit**

```bash
git add e2e/rich-text-toolbar-keyboard.spec.ts
git commit -m "test(e2e): prove the toolbar keyboard contract in a real browser (§144a)"
```

---

### Task 8: Docs

**Files:**
- Modify: `AGENTS.md`, `docs/AGENTS/ui-shell.md`, `docs/open-followups.md`, `src/app/rich-text-toolbar.tsx`

- [ ] **Step 1: Rewrite the AGENTS.md landmine — do NOT delete it**

In `AGENTS.md`, inside the rich-text register-descriptions bullet, find the paragraph beginning
`★★★ \`group\` AND NOT \`toolbar\`. The APG toolbar pattern is a KEYBOARD CONTRACT` and ending
`…which changes Tab in every editor in the app.` Replace that whole paragraph with:

> ★★★ `toolbar` NOW, AND `group` UNTIL 0.236.0 — the flip is the point, not the endpoint. The APG
> toolbar pattern is a KEYBOARD CONTRACT (one tab stop for the row, roving `tabindex`, Left/Right
> moving focus between controls), and until §144(a) this row honoured none of it, so it correctly
> declared `group`: a role whose interaction the widget does not implement tells an AT user to press
> arrow keys that do nothing, which is worse than declaring no role at all. **The refusal was right
> for as long as it stood, and it was not free** — it cost 15 tab stops per editor, and up to 45 in
> `change-edit-modal.tsx` at the default `advanced` tier (30 in simple, where `isVisible("impact")`
> gates the third editor). §144(a) built the contract in `toolbar-roving.ts` plus the `tabIndex`
> wiring in `rich-text-toolbar.tsx`, so the role followed it. ★★ `rich-text-toolbar.test.tsx` used to
> pin `queryByRole("toolbar")` as NULL; it now pins the OPPOSITE, and a reader who remembers only the
> old rule will try to revert this. ★★★ The two must move together in BOTH directions: if the roving
> handler or the `tabIndex={-1}` wiring is ever removed, the role goes back to `group` in the SAME
> commit. ★ A NEW control added to this row joins the roving order automatically — the indices derive
> from `CONTROLS.length` via `TOOLBAR_CONTROL_COUNT`, pinned against the real DOM by a unit test — but
> a control that renders `disabled` does NOT, since the engine has no skip-disabled logic (nothing in
> this row is ever disabled today, and a test pins that so adding one forces the decision).

★★★ Deleting the paragraph loses the reasoning for why the refusal was correct. Leaving it unchanged
instructs the next reader to revert this slice. Neither is acceptable — it gets rewritten in place.

★ Then grep for any other copy of the claim, since this file restates things:

```bash
grep -rn 'NOT `toolbar`\|queryByRole("toolbar")\|role="toolbar"' AGENTS.md docs/AGENTS/ docs/CODEMAPS/
```

Fix every hit that still says the row has no keyboard contract.

- [ ] **Step 2: Update the module header**

In `src/app/rich-text-toolbar.tsx`, the header comment says the row's controls are each their own tab stop. Update it to describe the single-tab-stop contract and point at `toolbar-roving.ts`.

- [ ] **Step 3: Update `docs/AGENTS/ui-shell.md`**

Add the toolbar's keyboard contract to its focus/keyboard section: one tab stop per row, Left/Right/Home/End within, activation never follows focus, and the portal guard for the heading menu.

- [ ] **Step 4: Close §144**

In `docs/open-followups.md`, change the §144 heading from `(b) CLOSED 2026-08-12, (a) open` to fully CLOSED, and add a closing subsection recording: what shipped, the tab-stop numbers before and after (15 → 1 per row; 45 → 3 in `change-edit-modal.tsx` at the default `advanced` tier, 30 → 3 in simple mode), the mutation counts from Task 4, and that the e2e spec is the browser-level proof. Update the index row for 144 near the top of the file.

- [ ] **Step 5: Run the doc gates, unpiped**

```bash
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "SYMBOLS_EXIT=$?"; tail -3 /tmp/sym.log
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "CLAIMS_EXIT=$?"; tail -3 /tmp/claims.log
```

Expected: both `EXIT=0`.

★ `docs:claims:check` is a RATCHET — do not add any new `path:LINE` citation to a doc. Cite symbol names. `docs:symbols:check` fails on a backticked mixed-case name that exists nowhere in `src`/`scripts`/`e2e`, so `moveToolbarFocus` and `TOOLBAR_CONTROL_COUNT` are safe once Tasks 1 and 3 have landed.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md docs/AGENTS/ui-shell.md docs/open-followups.md src/app/rich-text-toolbar.tsx
git commit -m "docs: close §144, rewrite the group-not-toolbar landmine (§144a)"
```

---

### Task 9: Full gate run

- [ ] **Step 1: Run every gate, each read unpiped**

```bash
npx tsc --noEmit > /tmp/g1.log 2>&1; echo "TSC=$?"
npx eslint --max-warnings=0 src/app > /tmp/g2.log 2>&1; echo "ESLINT=$?"
npm run test:run > /tmp/g3.log 2>&1; echo "TESTS=$?"; grep -E "Test Files|Tests " /tmp/g3.log
npm run test:shuffle > /tmp/g4.log 2>&1; echo "SHUFFLE=$?"
npm run test:coverage > /tmp/g5.log 2>&1; echo "COVERAGE=$?"
npm run dup:check > /tmp/g6.log 2>&1; echo "DUP=$?"
npm run size:check > /tmp/g7.log 2>&1; echo "SIZE=$?"
```

Expected: all `=0`.

★ `npm run lint` is bare `eslint` with no `--max-warnings` and exits 0 even with warnings — it does NOT reproduce the CI gate. Use the `npx eslint --max-warnings=0 src/app` line above.

★ ESLint here is fatal on an unused import or variable, including `_`-prefixed params. Re-check after every extraction.

★ `size:check` counts `readFileSync().split("\n").length`, which is `wc -l` **+ 1**. `rich-text-toolbar.tsx` gains roughly 30 lines in this slice — if it is near its baseline, read the true number with:

```bash
node -e "console.log(require('fs').readFileSync('src/app/rich-text-toolbar.tsx','utf8').split('\n').length)"
```

- [ ] **Step 2: Fix anything red, then commit**

```bash
git add -A
git commit -m "chore: gate fixes for the toolbar keyboard contract (§144a)"
```

---

### Task 10: Release

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`

- [ ] **Step 1: Pick a codename and prove it is unused**

The next version is **0.236.0**. Pick a science-fiction author surname not already used, and verify against release HEADINGS only:

```bash
grep -oE '^## \[[0-9.]+\] - [0-9-]+ "[A-Za-z]+"' CHANGELOG.md | grep -oE '"[A-Za-z]+"' | sort -u
```

★★ Scope the check to headings. A loose grep over the whole file matches prose and reports a free name as taken; a hyphen in the anchor pattern once reported ~20 used names as free.

- [ ] **Step 2: Bump `src/app/version.ts`**

Set `APP_VERSION = "0.236.0"`, `APP_MILESTONE = "<codename>"`, and update `APP_BUILD_DATE`.

★★ `version.ts` is **CRLF**. An edit whose anchor uses `\n` silently no-ops while sibling edits succeed. Match `\r\n`, and re-read the file to confirm the write landed.

- [ ] **Step 3: Bump the five ungated places**

`package.json` `version`; `package-lock.json` (**two** occurrences — the root `version` and the `packages[""]` one); the README shields badge (version **and** codename); and the `<!-- Generated: … | App <version> "<codename>" … -->` header on all five `docs/CODEMAPS/*.md`.

★★ No gate checks any of these. They have drifted by up to eleven releases before. Bump them in the same commit.

- [ ] **Step 4: Add the CHANGELOG entry**

Under a new `## [0.236.0] - <date> "<codename>"` heading, in `### Changed`, describe it for a user — not for a compiler:

> **The formatting toolbar is now a single tab stop.** Reaching the text in a description used to mean pressing Tab past fifteen formatting buttons, and a change record with three rich-text fields put forty-five of them between you and the Save button. The toolbar is now one stop: Tab moves past the whole row, and Left/Right arrows (plus Home and End) move between the buttons once you are inside it. Focusing a button no longer applies it — you still press Enter or Space.

★★ No `[session link removed]...` URL in `CHANGELOG.md` or an MR description.

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS
git commit -m "chore(release): 0.236.0 \"<codename>\""
```

---

## Definition of done

- [ ] `toolbar-roving.ts` exists, pure and DOM-free, fully covered.
- [ ] The row is one tab stop; 14 of 15 controls carry `tabIndex={-1}`.
- [ ] Left/Right wrap; Home/End jump; Enter/Space activate; Up/Down and chords fall through.
- [ ] The portal guard is present and pinned by the heading-menu test.
- [ ] `role="toolbar"` under the existing `named` gate, flipped only after the behaviour.
- [ ] All pins green, including the **second**-Tab assertion and the command-not-called assertion.
- [ ] Mutation counts recorded in the Task 4 commit message.
- [ ] The Playwright spec passes in a real browser at `--workers=1`.
- [ ] `docs/AGENTS/ui-shell.md` read before implementing; AGENTS.md landmine rewritten, not deleted.
- [ ] §144 fully closed; index row updated.
- [ ] Every gate green, each read unpiped.
- [ ] 0.236.0 bumped in all six places; CHANGELOG entry added.
