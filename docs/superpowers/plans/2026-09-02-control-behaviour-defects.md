# Control-behaviour defects — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close register entries §326, §333, §334 and §199 — each measured in a real browser before
any code changes, and closed as *not a defect* where the measurement says so.

**Architecture:** Four independent surfaces, no shared files. Every fix is preceded by a temporary
Playwright probe that observes the symptom in Chromium; the probe spec is deleted before the fix is
committed, and its measured numbers go into the register entry and the source comment. Two of the
four fixes are deletions rather than additions — `useId()` replacing module constants, and
`PopoverPanel` replacing a hand-rolled clone.

**Tech Stack:** Next 16 / React / TypeScript, vitest + Testing Library for units, Playwright for
probes, GitLab CI for gates.

**Spec:** `docs/superpowers/specs/2026-09-02-control-behaviour-defects-design.md`

---

## Ground rules that apply to every task

- **Never read a gate's exit code through a pipe.** Redirect to the session scratchpad, echo the
  status unpiped, then read the file:
  ```bash
  SP="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad"
  npx vitest run src/app/<file>.test.tsx --reporter=dot > "$SP/unit.log" 2>&1; echo "EXIT=$?"
  grep -E "Test Files|Tests " "$SP/unit.log"
  ```
- **Never run two vitest processes at once.** A red run carrying `Failed to start forks worker` is
  machine contention, not a result — re-run it before believing it.
- `src/app/*.ts(x)` and `e2e/*.ts` are **CRLF**. Use the `Edit` tool, never `Write`, on an existing
  one — `Write` re-lines CRLF to LF invisibly to `git diff`. `docs/**` are LF and `Write` is fine
  there.
- Probes bind `PORT=3100`, never the long-running `:3000`.
- Every new test is mutation-proved. Record `N failed / M passed` and check the sum against the
  file's runtime test count. Revert a mutant with an inverse anchored write asserting the anchor is
  unique in BOTH directions, then prove `git diff --stat` is empty. `git checkout -- <path>` is
  deny-blocked.
- No push, no MR, no merge without an explicit instruction.

---

## File structure

| File | Change |
|---|---|
| `src/app/type-to-confirm-dialog.tsx` | modify — `useId()` for both ids |
| `src/app/type-to-confirm-dialog.test.tsx` | modify — two-instance test |
| `src/app/raci-chip-picker.tsx` | modify — adopt `PopoverPanel`, delete the clone |
| `src/app/raci-chip-picker.test.tsx` | modify — pins the adoption |
| `src/app/popover-panel.tsx` | modify — comments only, two stale claims |
| `src/app/document-block-selection.ts` | modify — `selectionAfterInsert` gains a kind argument |
| `src/app/document-block-selection.test.ts` | modify — both branches |
| `src/app/document-editor.tsx` | modify — pass the inserted kind |
| `src/app/labels-input.tsx` | modify ONLY if the §333 probe reproduces |
| `src/app/stakeholder-recipient-input.tsx` | modify ONLY if the §333 probe reproduces |
| `e2e/tmp-*.spec.ts` | temporary probes — created, run, **deleted before committing** |
| `docs/open-followups.md` | four entries closed |
| `AGENTS.md`, `docs/AGENTS/ui-shell.md` | prose sweep |
| `src/app/version.ts`, `CHANGELOG.md` | release |

---

## Task 1: §333 probe — does a chip clear actually get swallowed?

**Files:**
- Create (temporary): `e2e/tmp-chip-clear-probe.spec.ts`

- [ ] **Step 1: Write the probe**

The prediction is that the clear works. The probe must be able to observe the FAILURE too, so it
asserts on the field's contents after the click, not on the click landing.

```ts
import { test, expect, gotoApp, openView } from "./seed";

// TEMPORARY probe for open-followups §333. Deleted before anything is committed.
// The entry reasons — from the ResourcePicker rule — that a chip clear button
// with no onMouseDown + preventDefault can have its click land on an
// already-closed editor and be swallowed. Neither input under test puts an
// onBlur on its own field, and stakeholder-recipient-input's only close path is
// a document mousedown gated on rootRef containment with the clear button
// INSIDE rootRef. This probe decides it.
test("a labels chip clear removes the label", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
  await gotoApp(page);
  await openView(page, "Open Points");

  // Open the task editor on the first row.
  await page.getByRole("button", { name: /^Edit – /, exact: false }).first().click();

  const labels = page.getByRole("textbox", { name: /label/i }).first();
  await labels.click();
  await labels.fill("probe-label");
  await labels.press("Enter");

  const chipClear = page.getByRole("button", { name: /remove.*probe-label/i });
  await expect(chipClear).toBeVisible();
  await chipClear.click();

  // The claim under test: does this click reach its handler?
  await expect(page.getByText("probe-label")).toHaveCount(0);
});
```

- [ ] **Step 2: Run it**

```bash
SP="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad"
npx playwright test e2e/tmp-chip-clear-probe.spec.ts --project=chromium --workers=1 > "$SP/p333.log" 2>&1; echo "EXIT=$?"
tail -30 "$SP/p333.log"
```

Expected: PASS — the label is removed, so nothing is swallowed.

- [ ] **Step 3: Branch on the result**

**If it PASSED** (the predicted outcome): §333 is not a defect. Go to Task 9 for its closure; write
NO code. Do not add the guard "for safety" — an unfalsifiable guard pinned by a test that passes
against the unguarded code is the vacuous shape this repo keeps paying for.

**If it FAILED:** the entry is real. Add to BOTH `labels-input.tsx` and
`stakeholder-recipient-input.tsx`, on the chip clear `IconButton`:

```tsx
onMouseDown={(e) => e.preventDefault()}
```

with a comment naming the measured swallow, and pin it with a unit test that fails when the prop is
removed. Then continue.

- [ ] **Step 4: Delete the probe**

```bash
rm e2e/tmp-chip-clear-probe.spec.ts
git status --short   # must show no e2e/ entry
```

- [ ] **Step 5: Record the number now, not later**

Paste the probe's own output into a scratch note for Task 9 — the measurement is the deliverable
whichever way it went, and it cannot be reconstructed after the spec is deleted.

---

## Task 2: §326 probe — do two dialogs really collide?

**Files:**
- Create (temporary): `e2e/tmp-dialog-id-probe.spec.ts`

- [ ] **Step 1: Write the probe**

```ts
import { test, expect, gotoApp, openView } from "./seed";

// TEMPORARY probe for open-followups §326. Deleted before committing.
// TITLE_ID / MISMATCH_ID are module constants, so two mounted
// TypeToConfirmDialogs put duplicate ids in the document and aria-labelledby
// resolves to whichever comes FIRST. tasks-section.tsx holds two independent
// open booleans, so the collision is reachable.
test("two confirm dialogs put duplicate ids in the document", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
  await gotoApp(page);
  await openView(page, "Open Points");

  // Select a row, open delete-selected, then open clear-all on top of it.
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: /delete selected/i }).click();
  await page.getByRole("button", { name: /clear all/i }).click();

  const counts = await page.evaluate(() => ({
    title: document.querySelectorAll("#type-to-confirm-title").length,
    dialogs: document.querySelectorAll('[role="dialog"]').length,
  }));
  console.log("PROBE-326", JSON.stringify(counts));
  expect(counts.dialogs).toBe(2);
  expect(counts.title).toBe(2); // duplicate ids — the defect
});
```

- [ ] **Step 2: Run it and read `PROBE-326`**

```bash
npx playwright test e2e/tmp-dialog-id-probe.spec.ts --project=chromium --workers=1 > "$SP/p326.log" 2>&1; echo "EXIT=$?"
grep "PROBE-326" "$SP/p326.log"; tail -20 "$SP/p326.log"
```

If the two dialogs cannot be opened together through the UI, drive the voice `clearAll` nonce path
instead (the entry names it) rather than declaring the collision unreachable — "I could not get two
open" is not the same claim as "two cannot be open".

- [ ] **Step 3: Delete the probe, record the counts**

```bash
rm e2e/tmp-dialog-id-probe.spec.ts
```

---

## Task 3: §326 fix — `useId()` for both ids

**Files:**
- Modify: `src/app/type-to-confirm-dialog.tsx`
- Test: `src/app/type-to-confirm-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("TypeToConfirmDialog", ...)`:

```tsx
  // ★★ §326. Both ids were module CONSTANTS, so two mounted dialogs put
  // duplicate ids in the document and `aria-labelledby` / `aria-describedby`
  // resolved to whichever element came FIRST in document order — the wrong
  // dialog's title announced, with no visible symptom and nothing thrown.
  // `tasks-section.tsx` holds two independent open booleans, so this is a
  // reachable user sequence, not a hypothetical future call site.
  it("gives two mounted dialogs ids that resolve inside their own dialog", () => {
    render(
      <>
        <TypeToConfirmDialog {...base} title="First" />
        <TypeToConfirmDialog {...base} title="Second" />
      </>,
    );
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(2);
    const titles = dialogs.map((d) => {
      const el = document.getElementById(d.getAttribute("aria-labelledby")!)!;
      // The whole assertion: each name resolves INSIDE the dialog that claims it.
      expect(d.contains(el)).toBe(true);
      return el.textContent;
    });
    expect(titles).toEqual(["First", "Second"]);
  });

  it("gives two mounted dialogs distinct mismatch regions", () => {
    render(
      <>
        <TypeToConfirmDialog {...base} title="First" />
        <TypeToConfirmDialog {...base} title="Second" />
      </>,
    );
    const dialogs = screen.getAllByRole("dialog");
    for (const d of dialogs) {
      const input = within(d).getByRole("textbox");
      fireEvent.change(input, { target: { value: "wrong" } });
      fireEvent.blur(input);
      const described = document.getElementById(input.getAttribute("aria-describedby")!)!;
      expect(d.contains(described)).toBe(true);
    }
  });
```

Add `within` to the Testing Library import at the top of the file.

- [ ] **Step 2: Run it — it must FAIL**

```bash
npx vitest run src/app/type-to-confirm-dialog.test.tsx --reporter=dot > "$SP/u326.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/u326.log"
```

Expected: 2 failed / 12 passed. The failure is `expect(d.contains(el)).toBe(true)` on the second
dialog, whose `aria-labelledby` resolves into the first.

- [ ] **Step 3: Fix**

In `src/app/type-to-confirm-dialog.tsx`, change the React import:

```tsx
import { useId, useState } from "react";
```

Delete the two module constants:

```tsx
const TITLE_ID = "type-to-confirm-title";
const MISMATCH_ID = "type-to-confirm-mismatch";
```

and add, as the first two lines of the component body, above `const [typed, setTyped] = useState("")`:

```tsx
  // ★★ §326. Per-INSTANCE ids. These were module constants, and two mounted
  // dialogs then put duplicate ids in the document: `aria-labelledby` and
  // `aria-describedby` resolve to whichever element comes first in document
  // order, so the wrong dialog's title and mismatch text were announced — no
  // visible symptom, nothing thrown. `tasks-section.tsx` opens two of these
  // from two independent booleans, so it was reachable rather than theoretical.
  // This also retires an unwritten "only one may be mounted" rule that no gate
  // could ever have enforced.
  const titleId = useId();
  const mismatchId = useId();
```

Replace the three usages: `ariaLabelledby={titleId}`, `titleId={titleId}`,
`aria-describedby={showMismatch ? mismatchId : undefined}` and `<span id={mismatchId} …>`.

- [ ] **Step 4: Run the test — it must PASS**

```bash
npx vitest run src/app/type-to-confirm-dialog.test.tsx --reporter=dot > "$SP/u326.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/u326.log"
```

Expected: 14 passed, EXIT=0. Confirm 14 is the file's runtime test count.

- [ ] **Step 5: Mutation-prove**

Revert `const titleId = useId();` to `const titleId = "type-to-confirm-title";`, re-run, record
`N failed / M passed`, then restore with an anchored write and prove `git diff --stat` clean. Repeat
for `mismatchId`. Each mutant must kill exactly the test that names it.

- [ ] **Step 6: Commit**

```bash
git add src/app/type-to-confirm-dialog.tsx src/app/type-to-confirm-dialog.test.tsx
git commit -m "fix: give each TypeToConfirmDialog its own DOM ids (326)"
```

---

## Task 4: §334 baseline probe — overflow, and keyboard traversal BEFORE the change

**Files:**
- Create (temporary): `e2e/tmp-raci-popover-probe.spec.ts`

Two measurements, and the second is the one the spec defers a decision to.

- [ ] **Step 1: Write the probe**

```ts
import { test, expect, gotoApp, openView } from "./seed";

// TEMPORARY probe for open-followups §334. Deleted before committing.
// (a) does the popover run off the right edge, and (b) what does Tab do today?
test("RACI popover: right-edge overflow and keyboard traversal", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page);
  await openView(page, "Stakeholders");
  // Reach the RACI matrix sub-surface, then the RIGHTMOST trigger in a row.
  const triggers = page.locator('button[aria-haspopup="true"][aria-expanded]');
  const last = triggers.last();
  await last.scrollIntoViewIfNeeded();
  await last.click();

  const geom = await page.evaluate(() => {
    const pop = document.querySelector('body > span.fixed.z-\\[100\\]') as HTMLElement | null;
    if (!pop) return null;
    const r = pop.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, innerWidth: window.innerWidth };
  });
  console.log("PROBE-334-GEOM", JSON.stringify(geom));

  // (b) Keyboard: where does Tab go from the first chip?
  await page.keyboard.press("Tab");
  const afterTab = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    const pop = document.querySelector('body > span.fixed.z-\\[100\\]');
    return {
      label: a?.getAttribute("aria-label") ?? a?.textContent?.trim() ?? null,
      insidePopover: !!(pop && a && pop.contains(a)),
    };
  });
  console.log("PROBE-334-TAB", JSON.stringify(afterTab));
  expect(geom).not.toBeNull();
});
```

- [ ] **Step 2: Run it and read both lines**

```bash
npx playwright test e2e/tmp-raci-popover-probe.spec.ts --project=chromium --workers=1 > "$SP/p334.log" 2>&1; echo "EXIT=$?"
grep "PROBE-334" "$SP/p334.log"
```

Record `right` against `innerWidth`. `right > innerWidth` is the defect. If the rightmost trigger in
the seeded matrix does not overflow, narrow the viewport until it does and record the width at which
it starts — "it does not overflow at 1280" is not a disproof, it is a measurement at one width.

Record `PROBE-334-TAB` verbatim. This is the BEFORE half of the Tab-trap decision and it cannot be
taken after the adoption lands.

- [ ] **Step 3: Do NOT delete this probe yet** — Task 6 re-runs it against the adopted code. Keep it
until then, and keep it out of every commit.

---

## Task 5: §334 fix — adopt `PopoverPanel`

**Files:**
- Modify: `src/app/raci-chip-picker.tsx`
- Modify: `src/app/popover-panel.tsx` (comments only)
- Test: `src/app/raci-chip-picker.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `describe("RaciChipPicker", ...)`:

```tsx
  // ★★ §334. The picker hand-rolled a portal, an outside-pointerdown listener,
  // scroll/resize close and inline positioning from one getBoundingClientRect —
  // with no comparison against window.innerWidth, no clamp and no flip. A
  // trigger near the right edge of a wide matrix rendered a popover that ran
  // off-screen, and `w-max` meant it never wrapped to compensate. It now
  // renders through `PopoverPanel`, which owns the clamp.
  // ★ jsdom has no layout, so NOTHING here can see the clamp itself; the
  // arithmetic is pinned by `popover-panel.test.tsx` and the clamp evidence for
  // THIS consumer is a browser probe. What this test can pin is that the picker
  // no longer emits a popover of its own.
  it("renders its popover through PopoverPanel, not a hand-rolled portal", () => {
    render(<RaciChipPicker value="A" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const panel = screen.getByRole("button", { name: "C" }).closest("span.fixed") as HTMLElement;
    expect(panel).toBeTruthy();
    // PopoverPanel supplies these; the hand-rolled span did not carry them.
    expect(panel.className).toContain("rounded-md");
    expect(panel.className).toContain("border-line");
    expect(panel.className).toContain("bg-surface");
    // and it is portaled to body, as before.
    expect(panel.parentElement).toBe(document.body);
  });
```

- [ ] **Step 2: Run it — it must FAIL**

```bash
npx vitest run src/app/raci-chip-picker.test.tsx --reporter=dot > "$SP/u334.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/u334.log"
```

Expected 1 failed / 4 passed. ★ The hand-rolled span already carries `rounded-md border-line
bg-surface`, so this test as written may PASS against the unfixed code — a vacuous pin. If it does,
strengthen it to assert on something only the primitive produces before proceeding: assert the panel
is NOT positioned by an inline `left` (`panel.style.left === ""` after the primitive's `right`-based
`bottom-end` placement). **Do not proceed on a test that passes before the fix.**

- [ ] **Step 3: Rewrite the picker**

Replace the imports at the top of `raci-chip-picker.tsx`:

```tsx
import { useCallback, useId, useRef, useState } from "react";
import { PopoverPanel } from "./popover-panel";
```

Remove `createPortal`, `useEffect` and `useDismissable` imports if nothing else in the file uses
them.

Delete the whole positioning-and-dismissal block — the `pos` state, the `popRef`, the
`useDismissable` call and the `useEffect` holding `setPos`, `onPointerDown`, `onScroll` and their
listener registration. Replace the component's state head with:

```tsx
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // ★★ MUST be stable — `PopoverPanel` documents that an unstable `onClose`
  // re-subscribes its listeners on every render.
  const close = useCallback(() => setOpen(false), []);
```

Replace the `{open && pos && …createPortal(…)}` block with:

```tsx
      {/* ★★★ §334. This was a hand-rolled portal with inline `left`/`top` from
          one getBoundingClientRect and NO clamp, so a trigger near the right
          edge of a wide RACI matrix painted the popover off-screen. It also
          duplicated the portal, the outside-pointerdown dismiss, the
          scroll/resize close and the Escape registration that `PopoverPanel`
          already owns — roughly forty lines of clone.
          ★★ THREE BEHAVIOUR CHANGES CAME WITH THE ADOPTION and none is a
          detail: the panel is now right-aligned to the trigger rather than
          left-aligned; it flips above the anchor when fewer than
          MIN_SPACE_BELOW px sit below it; and it registers `kind: "modal"`, so
          it TRAPS TAB where this picker previously let Tab walk out into the
          matrix. All three were measured in Chromium before and after — see
          open-followups §334.
          ★ `role` is deliberately OMITTED. `PopoverPanel` accepts "menu", but
          these five children are `aria-pressed` buttons, not menuitems, and a
          role="menu" without menuitem children is an axe `aria-required-children`
          violation on an axe-scanned view. The markup therefore stays the plain
          span it was. */}
      <PopoverPanel
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        id={panelId}
        ariaLabel={ariaPrefix}
        autoFocus={false}
        className="flex w-max items-center gap-2 p-1.5 shadow-[var(--shadow-control)]"
      >
        {/* the existing RACI_ROLES.map(...) and clear chip, unchanged */}
      </PopoverPanel>
```

★ `autoFocus={false}` is load-bearing: the primitive's default focuses the first control, which here
is the "R" chip — opening the picker would land focus on a role the user has not chosen.

Add `aria-controls={open ? panelId : undefined}` to the trigger button, keeping its existing
`aria-haspopup` and `aria-expanded`.

Keep the two chip `stopPropagation` handlers. `PopoverPanel` stops propagation at its own root, but
the chips also sit inside a matrix row with its own click handling.

- [ ] **Step 4: Fix the two now-false comments in `popover-panel.tsx`**

Both are inside the file this change edits, which is the easiest place for a stale claim to survive:

1. The nested-portal note lists `createPortal` sites including `raci-chip-picker.tsx` and asserts
   "no `PopoverPanel` consumer renders … `RaciChipPicker`". The picker no longer calls
   `createPortal` and IS now a consumer. Rewrite both clauses to what is true after this commit,
   and re-run the census the comment describes rather than editing the sentence from memory.
2. Re-run the `<Modal` consumer count the §100 comment gives, since the consumer set grew:
   ```bash
   grep -l PopoverPanel src/app/*.tsx | grep -v test | xargs grep -c "<[M]odal"
   ```
   Paste the new output into the comment if the numbers moved.

- [ ] **Step 5: Run the test — it must PASS**

```bash
npx vitest run src/app/raci-chip-picker.test.tsx src/app/popover-panel.test.tsx --reporter=dot > "$SP/u334.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/u334.log"
```

- [ ] **Step 6: Typecheck — it exits 2 on diagnostics, not 1**

```bash
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "EXIT=$?"
tail -20 "$SP/tsc.log"
```

- [ ] **Step 7: Mutation-prove, then commit**

Mutant: restore the hand-rolled `<span className="fixed z-[100] …" style={{top,left}}>`. The new
test must go red. Record `N failed / M passed`, restore by anchored write, prove `git diff --stat`
empty against the intended diff.

```bash
git add src/app/raci-chip-picker.tsx src/app/raci-chip-picker.test.tsx src/app/popover-panel.tsx
git commit -m "fix: clamp the RACI popover by adopting PopoverPanel (334)"
```

---

## Task 6: §334 after-probe — did the adoption actually fix it, and is Tab worse?

**Files:**
- Reuse: `e2e/tmp-raci-popover-probe.spec.ts` (still uncommitted)

- [ ] **Step 1: Re-run the same probe**

```bash
npx playwright test e2e/tmp-raci-popover-probe.spec.ts --project=chromium --workers=1 > "$SP/p334b.log" 2>&1; echo "EXIT=$?"
grep "PROBE-334" "$SP/p334b.log"
```

Expected `PROBE-334-GEOM`: `right <= innerWidth - 8`. If it still overflows, the adoption did not
fix it and the diagnosis is wrong — return to the code, do not adjust the probe.

- [ ] **Step 2: Adjudicate the Tab trap**

Compare `PROBE-334-TAB` before and after. After the adoption `insidePopover` should be `true` where
it was `false`.

Then drive the picker by keyboard alone — open, Tab through the five chips, Escape — and answer one
question: **is the RACI matrix worse to traverse now?** If it is, revert the adoption commit and
close §334 with the minimal clamp instead:

```tsx
const maxLeft = window.innerWidth - VIEWPORT_MARGIN;   // popover is w-max, measured post-paint
setPos({ top: r.bottom + 4, left: Math.min(r.left, maxLeft) });
```

recording the measurement that made the primitive the wrong contract for this surface. Adopting a
primitive is correct only while its contract is the one the surface wants.

- [ ] **Step 3: Decide `MIN_SPACE_BELOW`**

Open a picker with 100–200px below it and watch. If a ~34px chip row flips above an anchor that had
plenty of room, add an optional `minSpaceBelow` prop to `PopoverPanel` defaulting to today's 220 and
pass a small value here. If the flip looks right, accept it and say so in the comment.

- [ ] **Step 4: Delete the probe**

```bash
rm e2e/tmp-raci-popover-probe.spec.ts
git status --short   # no e2e/ entry
```

---

## Task 7: §199 — a paragraph inserted at a narrow pane becomes the live one

**Files:**
- Modify: `src/app/document-block-selection.ts`
- Modify: `src/app/document-editor.tsx`
- Test: `src/app/document-block-selection.test.ts`

- [ ] **Step 1: Write the failing tests**

In `describe("selectionAfterInsert", …)`:

```ts
  // ★★★ §199. `selectionAfterInsert` used to shift the OLD selection past the
  //  insertion in every case, which is right for move and delete and wrong for
  //  insert: at a narrow pane every paragraph but the selected one is collapsed
  //  read-only, so "Add below → Paragraph" handed the user a fresh paragraph
  //  they could not type in until they clicked "Edit this block".
  //  ★★ PARAGRAPH ONLY, and this is not a stylistic narrowing. `document-editor.tsx`
  //  admits nothing else to the selection model on two counts: `resolvedSelection`
  //  re-checks `type === "paragraph"` and falls back to `firstParagraph`, and the
  //  collapse is `collapseParagraph`, read by a paragraph row alone. Selecting a
  //  newly-inserted heading would be resolved away on the next render — a change
  //  with no observable effect, and a test for it would pass either way.
  it("selects the new block when a paragraph is inserted", () => {
    expect(selectionAfterInsert(0, 2, "paragraph")).toBe(2);
    expect(selectionAfterInsert(3, 1, "paragraph")).toBe(1);
    expect(selectionAfterInsert(null, 0, "paragraph")).toBe(0);
  });

  it("leaves the selection alone for kinds with no selection concept", () => {
    for (const kind of ["heading", "bullets", "table", "dataSection", "pageBreak"] as const) {
      expect(selectionAfterInsert(2, 0, kind)).toBe(3);
      expect(selectionAfterInsert(0, 2, kind)).toBe(0);
      expect(selectionAfterInsert(null, 0, kind)).toBeNull();
    }
  });
```

★ The `null` case in the paragraph branch is deliberate and is the one worth arguing about: with no
selection yet, `resolvedSelection` is null and the editor resolves to `firstParagraph`. Inserting a
paragraph while nothing is chosen SHOULD select it — that is the same request. Keep the assertion,
and if the editor's fallback overrides it, fix the editor rather than weakening the test.

- [ ] **Step 2: Run — must FAIL**

```bash
npx vitest run src/app/document-block-selection.test.ts --reporter=dot > "$SP/u199.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/u199.log"
```

Expected: a TypeScript/arity failure plus 2 failed. Confirm `npx tsc --noEmit` also objects — the
third argument does not exist yet.

- [ ] **Step 3: Implement**

Replace `selectionAfterInsert` in `src/app/document-block-selection.ts`:

```ts
/**
 * Where a selection lands after a block is inserted at `at`.
 *
 * ★★★ §199. A block inserted AT or BEFORE the selection pushes it up by one —
 *  EXCEPT for a paragraph, which BECOMES the selection. At a narrow pane
 *  `document-editor.tsx` collapses every paragraph but the selected one, so
 *  shifting the old selection past the insertion handed the user a fresh
 *  paragraph rendered read-only behind an "Edit this block" button: the block
 *  they had just asked for was the one block they could not type in.
 *
 * ★★ PARAGRAPH ONLY. Nothing else is in the selection model:
 *  `resolvedSelection` re-checks `type === "paragraph"`, and the collapse prop
 *  is read by a paragraph row alone. Selecting an inserted heading or table
 *  would be resolved away on the next render — a no-op that a test would
 *  happily pass either way.
 *
 * ★ The branch is on the KIND, never on the position. The pre-fix code had an
 *  index-0-only special case that made this behaviour inconsistent, and a
 *  positional rule here would recreate it.
 */
```

★★★ **CORRECTED 2026-09-02 — the last ★ of that drafted docstring is FALSE and was NOT shipped.**
There was no index-0-only special case in `selectionAfterInsert`: the module arrived whole in
`af704299`, and before it `insertSeeded` was
`(at, type) => structural.insert(at, blockSeed(lang, type))`, which never touched the selection
(`git show af704299^:src/app/document-editor.tsx | grep -A1 "insertSeeded ="`). The index-0
coincidence lived in `resolvedSelection`'s `firstParagraph` fallback — a different function, untouched
by this fix. The implementer refuted the claim rather than transcribing it; the shipped docstring says
only "a paragraph can be inserted at any index, including 0, and must become the selection at every one
of them", which is the correct form.

```ts
export function selectionAfterInsert(
  chosen: number | null,
  at: number,
  kind: AddableBlockType,
): number | null {
  if (kind === "paragraph") return at;
  if (chosen === null) return null;
  return chosen >= at ? chosen + 1 : chosen;
}
```

Add at the top of the file:

```ts
import type { AddableBlockType } from "./document-block-seeds";
```

★ This is the module's first import. Its header promises "NO React, NO DOM, NO i18n" — a `type`-only
import of a string union keeps that promise (it erases at compile time), but check that
`document-block-seeds.ts` does not drag i18n into a value position here; `blockSeed` takes a `Lang`,
so import the TYPE alone and nothing else.

In `src/app/document-editor.tsx`, `insertSeeded` passes the kind it already has:

```tsx
  const insertSeeded = (at: number, type: AddableBlockType) => {
    const r = structural.insert(at, blockSeed(lang, type));
    if (r?.changed) setChosen(selectionAfterInsert(resolvedSelection, at, type));
  };
```

- [ ] **Step 4: Run — must PASS**

```bash
npx vitest run src/app/document-block-selection.test.ts src/app/document-editor.test.tsx --reporter=dot > "$SP/u199.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/u199.log"
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 5: Mutation-prove**

Two mutants, each must kill exactly one test:
1. `if (kind === "paragraph") return at;` → delete the line. The paragraph test goes red, the
   other stays green.
2. `if (kind === "paragraph")` → `if (kind !== "pageBreak")`. The second test goes red.

Record `N failed / M passed` for each; the sum must equal the file's runtime test count (12 after
this task — verify, do not assume).

- [ ] **Step 6: Eye-verify at a narrow pane**

jsdom has no layout and no `ResizeObserver`, so no unit test can see the collapse this fixes. Open a
document, narrow the pane past `NARROW_PANE_PX`, "Add below → Paragraph", and confirm you can type
immediately. Then add a page break and confirm the selection did not move.

- [ ] **Step 7: Commit**

```bash
git add src/app/document-block-selection.ts src/app/document-block-selection.test.ts src/app/document-editor.tsx
git commit -m "fix: select a paragraph inserted at a narrow pane (199)"
```

---

## Task 8: Gates

- [ ] **Step 1: Run the full local set, unpiped exit codes**

```bash
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "EXIT=$?"
npm run test:run > "$SP/suite.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/suite.log"
npm run size:check > "$SP/size.log" 2>&1; echo "EXIT=$?"
npm run dup:check > "$SP/dup.log" 2>&1; echo "EXIT=$?"
npm run docs:claims:check > "$SP/claims.log" 2>&1; echo "EXIT=$?"
npm run docs:symbols:check > "$SP/symbols.log" 2>&1; echo "EXIT=$?"
npm run followups:status:check > "$SP/fus.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 2: Run the shuffled suite — the only local reproduction of that gate**

```bash
npm run test:shuffle > "$SP/shuffle.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/shuffle.log"
```

- [ ] **Step 3: Axe the two scanned views this touches**

```bash
PORT=3100 npm run dev &
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Stakeholders" > "$SP/axe.log" 2>&1; echo "EXIT=$?"
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Documents" >> "$SP/axe.log" 2>&1; echo "EXIT=$?"
PORT=3100 npm run stop
```

`--workers=1` is mandatory whenever more than one view is matched: locally Playwright runs at CPU
count while CI runs serially, and over-subscribed axe tests die on a 60s timeout inside
`page.evaluate` — a failure that names no rule and no impact. Read the failure BODY, never the
summary line.

---

## Task 9: Register closures and the prose sweep

**Files:**
- Modify: `docs/open-followups.md`
- Modify: `AGENTS.md`, `docs/AGENTS/ui-shell.md` as the sweep requires

- [ ] **Step 1: Close each entry as a FOUR-PLACE edit**

For each of §326, §334, §199 and §333: the `##` heading gains `— CLOSED <date>`, the index table's
status cell and anchor are updated, and the `isClosed` witness is checked. Verify with:

```bash
grep -E "^## (199|326|333|334)\." docs/open-followups.md
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
npm run followups:status:check > "$SP/fus.log" 2>&1; echo "EXIT=$?"
```

★ A partially closed entry is OPEN and must NOT carry `— CLOSED`. If the §334 Tab adjudication sent
the fix back to the minimal clamp, say so in those words — the clamp closes the entry, the adoption
did not happen, and both facts belong in the heading's body.

- [ ] **Step 2: §333 gets the measurement, whichever way it went**

If the probe cleared it, the closure records: the probe, its result, and the `rootRef`-containment
reason — so the next reader inherits a measurement rather than a suspicion. Name explicitly that the
`ResourcePicker` rule is still correct and simply does not apply to a control rendered INSIDE the
containment check that governs the close.

- [ ] **Step 3: Sweep prose describing the pre-fix behaviour**

```bash
grep -rn "RaciChipPicker\|raci-chip-picker" AGENTS.md docs/ src/app --include=*.md --include=*.tsx | grep -v test
grep -rn "type-to-confirm-title\|type-to-confirm-mismatch" src docs AGENTS.md
grep -rn "selectionAfterInsert" src docs AGENTS.md
```

Every hit is a claim to re-read against the new code, not a string to bulk-replace. ~~Note §102's
hand-rolled-UI ratchet loses its `RaciChipPicker` row only if the adoption stood.~~

★★★ **CORRECTED 2026-09-02 — THERE IS NO SUCH ROW.** `docs/handrolled-ui-inventory.md` carries exactly
three `raci-chip-picker` rows (the popover TRIGGER, the `aria-pressed` role chips, the clear ✕) and
**all three survive the adoption unchanged**. The inventory never had a row for the hand-rolled
portal/popover — the only thing the adoption removed — so §102 loses nothing. Verify with
`grep -n "raci-chip-picker" docs/handrolled-ui-inventory.md`. Do not delete a surviving row to make
the struck sentence true.

- [ ] **Step 4: Commit**

```bash
git add docs/open-followups.md AGENTS.md docs/AGENTS/ui-shell.md
git commit -m "docs: close 326, 333, 334 and 199 and sweep the prose behind them"
```

---

## Task 10: Release

- [ ] **Step 1: Bump**

Edit `src/app/version.ts` — `APP_VERSION = "0.277.2"`, `APP_BUILD_DATE` to today, milestone stays
`"Ozeki"` (codename uniqueness is per MINOR line). If the §199 behaviour change is to ride a minor
instead, this is 0.278.0 and needs a NEW codename unique within that line.

```bash
npm run version:sync > "$SP/vsync.log" 2>&1; echo "EXIT=$?"
npm run version:check > "$SP/vcheck.log" 2>&1; echo "EXIT=$?"
```

Exit 1 is drift (re-run `version:sync`); exit 2 is the gate unable to scan — opposite responses.

- [ ] **Step 2: CHANGELOG**

Add `## [0.277.2] - <date> "Ozeki"` with a Fixed bullet per closed entry, phrased as what a user
sees. **Never a `[session link removed]...` URL in `CHANGELOG.md` or an MR description.** Do not
claim §333 was fixed if it was disproved — say the behaviour was verified correct.

- [ ] **Step 3: Cold code review before release**

Standing rule: always run a code review before every release. Dispatch a reviewer against
`origin/main..HEAD` with the spec as the requirements, and take an IMPORTANT finding seriously —
the last two slices each had one that changed what shipped.

- [ ] **Step 4: Stop**

Do not push, open an MR or merge without an explicit instruction. On "release": push → MR → poll →
merge only on a fully green pipeline for the FINAL SHA, with `--auto-merge=false` passed explicitly
(glab defaults it true).
