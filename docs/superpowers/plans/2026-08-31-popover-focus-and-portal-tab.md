# Popover Focus and Portal Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ★★ **DATED RECORD — state as of 2026-08-31, NOT a description of today's code.**
> This document is the plan/spec for the 0.270.0 slice and is deliberately not rewritten;
> a signed record that is edited to match a later tree stops being one. One claim in it has
> since been falsified — there are SEVERAL, and this is only the likeliest to mislead: it says
> `use-focus-trap`'s Tab branch
> "never consults the stack". That was true when written. `docs/open-followups.md` §318 —
> CLOSED 2026-09-01 — made the hook register whenever active and gate Tab on `isTopmostOfKind`,
> and §8 gave `tour-overlay` a real trap on top of it. Read this for what was DECIDED; read
> `docs/AGENTS/ui-shell.md`'s dismissal section for what the code DOES.

**Goal:** Close open-followups §100, §297 and §124 — three keyboard/focus defects in the popover-modal subsystem — by moving the behaviour into the `PopoverPanel` primitive instead of leaving it to call sites.

**Architecture:** `PopoverPanel` gains a Tab cycle over its own portaled content and flips its dismissal `kind` from `"layer"` to `"modal"`, so `Modal`'s existing `isTopmostOfKind` check defers to it; the new cycle is itself gated on `isTopmostOfKind` so a `Modal` opened from inside a popover still wins. Focus restoration moves to an unmount guard in the primitive, which fixes 13 consumer call sites without editing any of them. The measure effect splits so the scroll/resize listeners arm only once the panel is actually rendered.

**Tech Stack:** TypeScript, React 19, Next.js 16, vitest + @testing-library/react, jsdom.

**Spec:** `docs/superpowers/specs/2026-08-31-popover-focus-and-portal-tab-design.md`

**Required reading before Task 5:** `docs/AGENTS/ui-shell.md`, the dismissal section. It owns the Escape/Tab protocol and its `kind` rule is why Task 5 is two changes rather than one.

---

## Things that will bite you

Read these before starting. Each has already cost real work in this repo.

1. **Every `src/app/*.ts(x)` file is CRLF.** The `Write` tool re-lines a file to LF; `Edit` preserves. Use `Edit` on existing source. Never `sed -i`. Verify with `git ls-files --eol <file>` — healthy is `i/lf w/crlf`.
2. **Never read a gate's exit code through a pipe.** `npm run test:run | tail -5` reports `tail`'s status. Redirect, echo the unpiped `$?`, then read the file.
3. **`npx tsc --noEmit` exits 2 on diagnostics, not 1.**
4. **`npm run lint` exits 1 from gitignored leftovers.** Use `npx eslint src`.
5. **Never run two vitest processes at once.** A vitest red carrying `Failed to start forks worker` is machine contention, not a real failure.
6. **`/tmp` is shared across concurrent Claude sessions on this machine.** Every `> /tmp/tN.log` below is written that way for brevity only — substitute your session's scratchpad directory with a per-agent basename prefix. A peer's gate log has already overwritten one of ours and been read as this checkout's result.
7. **`react-hooks/set-state-in-effect` is banned and fatal**, and `--max-warnings=0` makes every warning fatal including unused vars.
8. **`pos` is a fresh object every time and the post-paint clamp rewrites it.** Any effect that must not re-run while the panel stays mounted has to depend on a derived boolean, never on `pos` itself. This is the single most dangerous detail in this plan — see Tasks 3 and 4.
9. **jsdom DOES mount the real `PopoverPanel`, and a comment in the tree says otherwise.** This is the single claim most likely to make you write a vacuous test, so verify it FIRST (Task 5 Step 0) rather than trusting either the tree or this plan.

   `dismissal-integration.test.tsx`'s `Popover` stand-in carries the docstring *"jsdom reports every rect as zero so the real portal never positions itself, which is why these are hosted on the hook rather than the component."* That conclusion does not follow from its premise. The premise is true — every rect IS zero — but trace the measure effect with those zeros: `r.right = 0`, and jsdom's `window.innerWidth` is 1024, so `right = Math.max(8, 1024 - 0) = 1024`; `spaceBelow = window.innerHeight - r.bottom = 768 - 0 = 768`, which clears `MIN_SPACE_BELOW` (220), so the effect calls `setPos({ right, top: 4 })`. `pos` is non-null and `if (!open || !pos || typeof document === "undefined") return null;` lets the panel through.

   Empirically confirmed: `popover-panel.test.tsx`'s first test (`"portals the panel to document.body as a fixed layer"`) renders the real `PopoverPanel` with **no** `withRects` wrapper and resolves it with `screen.getByRole("dialog")`. The `withRects` helper exists for *geometry* assertions — which coordinate lands where — not for mounting.

   Zero rects would only strand the panel on the `right-start` placement, which sets `left`/`top` and is then clamped; the default `bottom-end` is unaffected. Task 5's harness uses the default.

   ★ Because the stand-in cannot exercise a Tab cycle at all, Task 5 must use the real component. Correcting that docstring is part of Task 5, not optional tidying — left alone it will send the next reader back to a stand-in.
10. **Open a popover from a trigger click, never render it already-open.** `dismissal-stack.ts` asserts as a precondition that open order equals nesting order. Mount a popover and its parent modal in one commit and React runs the child's effect first, inverting the stack.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/focusables.ts` | **create** | The one `FOCUSABLE_SELECTOR` constant. Currently copy-pasted three times. |
| `src/app/modal.tsx` | modify | Import the shared selector. Tab trap otherwise unchanged — the `kind` flip alone makes it defer. |
| `src/app/use-focus-trap.ts` | modify | Import the shared selector. Nothing else. |
| `src/app/undo/undo-control.tsx` | modify | Import the shared selector. Nothing else. |
| `src/app/use-dismissable.ts` | modify | Return the dismissal token so callers can consult `isTopmostOfKind`. |
| `src/app/popover-panel.tsx` | modify | All three fixes: effect split (§124), unmount focus restore (§297), Tab cycle + `kind` flip (§100). |
| `src/app/modern-shell.tsx` | modify | Comment only — name the load-bearing `false` literal. |
| `src/app/popover-panel.test.tsx` | modify | Tests for §124 and §297. |
| `src/app/dismissal-integration.test.tsx` | modify | Tests for §100 and its inverse nesting. |
| `docs/AGENTS/ui-shell.md` | modify | Protocol update: what `PopoverPanel` pushes, and the `use-focus-trap` exception. |
| `docs/open-followups.md` | modify | Close §100, §297, §124. File §316. |
| `CHANGELOG.md`, `src/app/version.ts` | modify | 0.270.0 release. |

Tasks 1 and 2 are enabling refactors with no behaviour change. Tasks 3, 4, 5 are the three fixes, ordered least to most invasive so each lands on a green tree.

---

### Task 1: Extract `FOCUSABLE_SELECTOR` to one module

**Why:** it exists three times already and this slice needs a fourth. The three differ only in whitespace after commas, which CSS selector lists ignore, so this is behaviour-preserving.

**Files:**
- Create: `src/app/focusables.ts`
- Modify: `src/app/modal.tsx`, `src/app/use-focus-trap.ts`, `src/app/undo/undo-control.tsx`

- [ ] **Step 1: Confirm the three are equivalent before touching them**

Run:
```bash
grep -n "FOCUSABLE_SELECTOR" src/app/modal.tsx src/app/use-focus-trap.ts src/app/undo/undo-control.tsx
```
Expected: `modal.tsx` builds an array and `.join(", ")`; the other two are single-line string literals with no space after each comma. Same six clauses, same order, in all three.

- [ ] **Step 2: Create the shared module**

Create `src/app/focusables.ts`:

```ts
// src/app/focusables.ts
//
// The one selector for "elements sequential keyboard navigation can reach".
//
// ★★ It was copy-pasted THREE times before this file existed — modal.tsx,
// use-focus-trap.ts and undo/undo-control.tsx — and a fourth consumer
// (popover-panel.tsx's Tab cycle) is what forced the extraction. The three
// copies differed only in whitespace after the commas, which a CSS selector
// list ignores, so collapsing them changed no behaviour.
//
// ★ No visibility filter, on purpose. A `offsetParent`/`getClientRects` check
// fails under jsdom, which has no layout engine and reports every element as
// hidden. The `:not([disabled])` clauses already handle the common cases.
export const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
```

- [ ] **Step 3: Repoint the three consumers**

In `src/app/modal.tsx`, delete the local `const FOCUSABLE_SELECTOR = [ … ].join(", ");` block and add the import beside the other `./` imports:

```ts
import { FOCUSABLE_SELECTOR } from "./focusables";
```

In `src/app/use-focus-trap.ts`, delete its local `const FOCUSABLE_SELECTOR = '…';` and add:

```ts
import { FOCUSABLE_SELECTOR } from "./focusables";
```

In `src/app/undo/undo-control.tsx`, delete its local `const FOCUSABLE_SELECTOR = '…';` and add (note the `../` — this file is one directory down):

```ts
import { FOCUSABLE_SELECTOR } from "../focusables";
```

Use `Edit`, not `Write` — these files are CRLF.

- [ ] **Step 4: Verify nothing changed behaviourally**

Run:
```bash
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0`.

```bash
npx vitest run src/app/modal.test.tsx src/app/use-focus-trap.test.ts src/app/undo > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```
Expected: `EXIT=0`, all passing. ★ The focus-trap spec is `use-focus-trap.test.ts` — a `.ts`, not a `.tsx`; an earlier revision of this line assumed `.tsx` and the command matched nothing.

- [ ] **Step 5: Verify line endings survived**

Run:
```bash
git ls-files --eol src/app/modal.tsx src/app/use-focus-trap.ts src/app/undo/undo-control.tsx
```
Expected: every row reads `i/lf w/crlf`. A row reading `i/lf w/lf` means the file was re-lined — revert and redo that edit with `Edit`.

- [ ] **Step 6: Commit**

```bash
git add src/app/focusables.ts src/app/modal.tsx src/app/use-focus-trap.ts src/app/undo/undo-control.tsx
git commit -m "refactor: collapse three FOCUSABLE_SELECTOR copies into one module"
```

---

### Task 2: `useDismissable` returns its token

**Why:** §100's Tab cycle must ask `isTopmostOfKind(token, "modal")`, and the token is currently sealed inside the hook. Purely additive — all six existing consumers ignore the return.

**Files:**
- Modify: `src/app/use-dismissable.ts`
- Test: `src/app/use-dismissable.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/use-dismissable.test.tsx`, inside its existing top-level `describe`:

```tsx
it("returns a stable token that identifies its own stack entry", () => {
  const tokens: symbol[] = [];
  function Harness({ open }: { open: boolean }) {
    const token = useDismissable({ open, kind: "modal", onDismiss: () => {} });
    tokens.push(token);
    return null;
  }
  const { rerender } = render(<Harness open />);
  expect(typeof tokens[0]).toBe("symbol");
  expect(isTopmostOfKind(tokens[0], "modal")).toBe(true);
  rerender(<Harness open />);
  expect(tokens[tokens.length - 1]).toBe(tokens[0]);
});
```

Add `isTopmostOfKind` to the existing `./dismissal-stack` import in that file if it is not already there.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/use-dismissable.test.tsx -t "returns a stable token" > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log
```
Expected: FAIL. `typeof tokens[0]` is `"undefined"`, because the hook returns `void`.

- [ ] **Step 3: Make it return the token**

In `src/app/use-dismissable.ts`, change the signature's return type from `void` to `symbol`:

```ts
}: DismissableOptions): symbol {
```

and add this as the final statement of the function body, after the last `useEffect`:

```ts
  // ★ Returned so a caller that runs its OWN Tab trap can ask
  // `isTopmostOfKind(token, "modal")` and stand down when something is layered
  // above it. `popover-panel.tsx` is the only consumer that needs it; the other
  // five ignore the return, which is why adding it broke nothing.
  return tokenRef.current;
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run src/app/use-dismissable.test.tsx > /tmp/t2b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2b.log
```
Expected: `EXIT=0`, all passing.

- [ ] **Step 5: Confirm no consumer broke**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-dismissable.ts src/app/use-dismissable.test.tsx
git commit -m "feat: return the dismissal token from useDismissable"
```

---

### Task 3: §124 — arm the scroll and resize listeners only once the panel is rendered

**The defect:** one effect in `popover-panel.tsx` both calls `setPos` and registers a capture-phase window `scroll` listener that calls `onClose`. Render is gated on `open && pos`. A click on a trigger inside a horizontally scrollable container makes the browser scroll to reveal it; that scroll lands on the freshly registered listener and closes a panel that never mounted.

**Files:**
- Modify: `src/app/popover-panel.tsx`
- Test: `src/app/popover-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

The observable is *when* the listener is armed relative to the panel existing. Add to `src/app/popover-panel.test.tsx` inside the `describe("PopoverPanel", …)`:

```tsx
it("does not arm the close-on-scroll listener until the panel is rendered", () => {
  // §124: the listener used to be registered in the same effect pass that
  // called setPos, i.e. while the panel was still gated behind `open && pos`.
  // A scroll dispatched by the browser to reveal the trigger then closed a
  // panel that had never been in the DOM.
  const realAdd = window.addEventListener;
  let panelPresentWhenArmed: boolean | null = null;
  const spy = vi
    .spyOn(window, "addEventListener")
    .mockImplementation((type, listener, options) => {
      if (type === "scroll" && panelPresentWhenArmed === null) {
        panelPresentWhenArmed =
          document.body.querySelector('[role="dialog"]') !== null;
      }
      return realAdd.call(window, type, listener, options);
    });
  try {
    render(<Harness />);
    fireEvent.click(screen.getByText("trigger"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(panelPresentWhenArmed).toBe(true);
  } finally {
    spy.mockRestore();
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/popover-panel.test.tsx -t "does not arm the close-on-scroll" > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t3.log
```
Expected: FAIL with `expected false to be true` — the listener is armed in the same pass as `setPos`, before the panel renders.

- [ ] **Step 3: Split the effect**

In `src/app/popover-panel.tsx`, the measure effect currently ends by registering both listeners. Remove `onScroll`, `onResize`, `widthAtOpen`, both `addEventListener` calls and the cleanup from it, so it ends immediately after the `if (placement === "right-start") { … } else { … }` block, and change its dep array to `[open, anchorRef, placement]` (it no longer calls `onClose`).

Then add a **new** effect immediately below it:

```tsx
  // ★★★ §124. These listeners are armed on `rendered`, NOT on `open` — they
  // used to live in the measure effect above, which runs while the panel is
  // still gated behind `open && pos`. A click on a trigger inside a
  // horizontally scrollable container makes the browser scroll the container to
  // reveal the trigger, and that scroll is dispatched AFTER the click handler
  // and its effects — so it landed on a listener that had just been registered
  // and closed a panel that had never been in the DOM. `aria-expanded` went
  // straight back to `false`.
  //
  // ★★ `rendered` is a BOOLEAN, deliberately, and depending on `pos` here
  // instead would reintroduce a different bug: `pos` is a fresh object and the
  // post-paint clamp effect rewrites it, so both listeners would be torn down
  // and re-registered on every clamp pass.
  //
  // ★ This is the same distinction `usePanelInitialFocus` already draws: the
  // flag means "the panel is RENDERED", not "the panel is open".
  const rendered = open && pos !== null;
  useEffect(() => {
    if (!rendered) return;
    // Close when an ANCESTOR scroller moves (the panel detaches from its
    // anchor), but NOT when the user scrolls a scrollable child INSIDE the
    // panel (e.g. the nested ResourcePicker's resource list in Assign/Escalate)
    // — a capture-phase window listener observes those inner scrolls too, and
    // closing on them would dismiss the popover mid-selection.
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    // Close only on a WIDTH change (real layout resize). A height-only resize is
    // usually a mobile keyboard / native date-sheet opening over the input —
    // closing then would dismiss the panel the instant the user interacts.
    const widthAtOpen = window.innerWidth;
    const onResize = () => { if (window.innerWidth !== widthAtOpen) onClose(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [rendered, onClose]);
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run src/app/popover-panel.test.tsx > /tmp/t3b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3b.log
```
Expected: `EXIT=0`, every test in the file passing — including the existing close-on-scroll and close-on-resize tests, which must still pass because the listeners still exist, just later.

- [ ] **Step 5: Mutation-check the new test**

Temporarily change the new effect's dep/guard from `if (!rendered) return;` to `if (!open) return;` and change `[rendered, onClose]` to `[open, onClose]`. Re-run the one test:
```bash
npx vitest run src/app/popover-panel.test.tsx -t "does not arm the close-on-scroll" > /tmp/t3m.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=1` — the mutant is killed. Then revert the mutation with an anchored `Edit` back to `rendered`, and prove the tree is clean:
```bash
git diff --stat src/app/popover-panel.tsx
```
Expected: the only changes are the intended ones from Step 3.

- [ ] **Step 6: Commit**

```bash
git add src/app/popover-panel.tsx src/app/popover-panel.test.tsx
git commit -m "fix: arm the popover close-on-scroll listener only once the panel is rendered"
```

---

### Task 4: §297 — restore focus to the anchor when the panel unmounts

> ★★★ **AMENDED AFTER MEASUREMENT — the mechanism Step 3 below prescribes DOES NOT WORK, and
> neither did the first replacement for it.** Two spellings were tried and both were measured
> broken, in opposite ways:
>
> 1. Step 3's own `panelRef.current?.contains(document.activeElement)` read inside the cleanup is a
>    silent no-op **everywhere**. A passive effect destroy runs after the commit that removed the
>    panel, so React has already detached the ref AND focus has already fallen to `<body>` — both
>    terms are stale. Measured in jsdom: the §297 test failed identically to unfixed code.
> 2. Its replacement — eager `focusin`/`focusout` capture into a `focusInsideRef` that the cleanup
>    reads — is a no-op **in Chromium only**, which is worse, because jsdom cannot see it and all 23
>    tests went green over it. Measured with Playwright probes in real chromium and firefox:
>    **Chromium dispatches `focusout` on the panel with `relatedTarget === null`, synchronously, as
>    the focused element is removed** — before the passive cleanup runs — so `panel.contains(null)`
>    clears the flag first. Firefox and jsdom dispatch no focusout on removal at all. There is no
>    in-handler discriminator: at that event Chromium reports `target.isConnected: true`,
>    `panel.isConnected: true`, `activeElement: BODY`, byte-identical to an outside-click focusout.
>
> The shipped fix keeps the eager capture and adds two structural guards: `onOut` **ignores a null
> `relatedTarget` entirely** (unknowable across removal / `<body>` / window blur), and the
> outside-mousedown listener **clears the flag explicitly** before `onClose`, so §146's
> "don't yank the user back after a deliberate outside click" is enforced by the code that knows the
> click was outside rather than by browser blur timing. Validated in BOTH browsers.
>
> ★★ Read Steps 3–4 below as the RECORD OF A REJECTED DESIGN, not as instructions. The live
> mechanism and its landmines are in `popover-panel.tsx`'s own comments; the two tests that pin the
> Chromium half (a null-`relatedTarget` focusout must NOT clear the flag; a non-null outside one
> must) are the only detector anywhere — jsdom fires no focusout on removal, axe has no rule, and
> the e2e suite does not exercise it.

**The defect:** `closeRestoringFocus` is wired only to `useDismissable`, so it runs on Escape and nothing else. 13 activate sites across 7 consumer files close the panel from an item's own handler; focus falls to `document.body`. Several of them use a raw `setOpen(false)` rather than the memoised `close`, so a fix that rewires `close` misses them.

**Files:**
- Modify: `src/app/popover-panel.tsx`
- Test: `src/app/popover-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add both to `src/app/popover-panel.test.tsx`. The first harness closes with a **raw `setOpen(false)`** — that spelling is the point, because a test written against the memoised `close` would pass against a fix that misses four real sites.

```tsx
function ActivateHarness() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={btnRef} type="button" onClick={() => setOpen((o) => !o)}>
        trigger
      </button>
      <PopoverPanel open={open} anchorRef={btnRef} onClose={() => setOpen(false)} role="dialog" ariaLabel="Panel" className="w-64 p-2">
        {/* Closes with a RAW setOpen(false), exactly as export-menu's pick,
            template-menus' submit and action-cta-controls' item helper do. */}
        <button type="button" onClick={() => setOpen(false)}>item</button>
      </PopoverPanel>
    </div>
  );
}

it("returns focus to the anchor when an item closes the panel", () => {
  render(<ActivateHarness />);
  fireEvent.click(screen.getByText("trigger"));
  const item = screen.getByText("item");
  item.focus();
  fireEvent.click(item);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.activeElement).toBe(screen.getByText("trigger"));
});

it("leaves focus alone when the consumer has already moved it", () => {
  // undo-control, sidebar-nav and dashboard-panel all restore focus
  // themselves, two of them to an element that is NOT the anchor. The
  // containment guard must let them win.
  function ElsewhereHarness() {
    const [open, setOpen] = useState(false);
    const btnRef = useRef<HTMLButtonElement>(null);
    const otherRef = useRef<HTMLButtonElement>(null);
    return (
      <div>
        <button ref={btnRef} type="button" onClick={() => setOpen((o) => !o)}>
          trigger
        </button>
        <button ref={otherRef} type="button">elsewhere</button>
        <PopoverPanel open={open} anchorRef={btnRef} onClose={() => setOpen(false)} role="dialog" ariaLabel="Panel" className="w-64 p-2">
          <button
            type="button"
            onClick={() => { otherRef.current?.focus(); setOpen(false); }}
          >
            item
          </button>
        </PopoverPanel>
      </div>
    );
  }
  render(<ElsewhereHarness />);
  fireEvent.click(screen.getByText("trigger"));
  const item = screen.getByText("item");
  item.focus();
  fireEvent.click(item);
  expect(document.activeElement).toBe(screen.getByText("elsewhere"));
});
```

- [ ] **Step 2: Run them and watch the first fail**

```bash
npx vitest run src/app/popover-panel.test.tsx -t "returns focus to the anchor" > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t4.log
```
Expected: FAIL — `document.activeElement` is `document.body`, not the trigger. The second test passes already; that is correct, it is a non-regression pin.

- [ ] **Step 3: Add the unmount restore**

In `src/app/popover-panel.tsx`, immediately after the `const rendered = open && pos !== null;` line added in Task 3, add:

```tsx
  // ★★★ §297. Restore focus to the anchor when the panel goes away with focus
  // still inside it. This is in the PRIMITIVE, on unmount, rather than threaded
  // out to consumers, for two measured reasons: several activate sites close
  // with a raw `setOpen(false)` rather than the memoised `close`, so a fix that
  // rewired `close` would miss them silently; and three consumers
  // (undo-control, sidebar-nav, dashboard-panel) already restore focus, two of
  // them to an element that is NOT the anchor.
  //
  // ★★ The containment guard is what makes both work. A consumer that has
  // already moved focus has moved it OUT of the panel, so this reads false and
  // stands down — no opt-out prop, no per-site audit.
  //
  // ★★ It runs in CLEANUP, while the panel's DOM is still attached, and it
  // depends on the `rendered` BOOLEAN, not on `pos`. Depending on `pos` would
  // fire this cleanup on every post-paint clamp pass — with the panel still
  // mounted and focus still inside it — yanking focus to the anchor mid-clamp.
  // jsdom has no layout, so no test in this file can catch that.
  useEffect(() => {
    if (!rendered) return;
    return () => {
      if (panelRef.current?.contains(document.activeElement)) {
        anchorRef.current?.focus({ preventScroll: true });
      }
    };
  }, [rendered, anchorRef]);
```

- [ ] **Step 4: Rewrite the `closeRestoringFocus` comment**

That comment currently states the rule this task changes ("ESCAPE ONLY … Restoring focus from all four would YANK the user back"). Replace the first paragraph of the ★★★ block above `closeRestoringFocus` with:

```
  // ★★★ Escape restores focus HERE, before `onClose`, so there is never a frame
  // in which `document.activeElement` is `body`. Every other close path —
  // outside-click, ancestor-scroll, width-resize, and a consumer closing from
  // an item's own handler — is covered by the unmount guard above instead.
  // ★★ The two compose and cannot double-fire: this one moves focus to the
  // anchor, which puts it OUTSIDE the panel, so the unmount guard's containment
  // check then reads false. Do not delete either as redundant.
  // ★★ This SUPERSEDES the former Escape-only rule (open-followups §146, §297).
  // That rule argued that restoring from all four paths would yank the user back
  // after they deliberately clicked elsewhere — which is an argument about
  // outside-CLICK, where focus is elsewhere and the containment guard already
  // declines. When focus is INSIDE the panel and the panel unmounts, the
  // alternative to restoring is not "leave the user where they were"; it is
  // `document.body`.
```

Keep the two ★ lines beneath it (the "guarded on focus still being INSIDE" and "focus the anchor BEFORE closing" notes) — both are still true.

- [ ] **Step 5: Run and watch both pass**

```bash
npx vitest run src/app/popover-panel.test.tsx > /tmp/t4b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4b.log
```
Expected: `EXIT=0`, all passing.

- [ ] **Step 6: Mutation-check**

Delete the `if (panelRef.current?.contains(document.activeElement))` guard (restore unconditionally) and re-run:
```bash
npx vitest run src/app/popover-panel.test.tsx -t "leaves focus alone" > /tmp/t4m.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=1`. Revert with an anchored `Edit` and confirm `git diff --stat src/app/popover-panel.tsx` shows only the intended changes.

- [ ] **Step 7: Run the consumer suites that already manage focus**

```bash
npx vitest run src/app/undo src/app/sidebar-nav.test.tsx src/app/dashboard-panel.test.tsx src/app/document-block-gutter.test.tsx > /tmp/t4c.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4c.log
```
Expected: `EXIT=0`. These three restore focus themselves; a red here means the containment guard is not deferring to them.

- [ ] **Step 8: Commit**

```bash
git add src/app/popover-panel.tsx src/app/popover-panel.test.tsx
git commit -m "fix: return focus to the anchor when a popover closes with focus inside it"
```

---

### Task 5: §100 — give `PopoverPanel` a Tab cycle and flip its dismissal kind

**The defect:** `Modal`'s Tab trap guards on `container.contains(active)` and `PopoverPanel` portals into `document.body`, so `contains` is false for every element inside the popover. The first Tab hits the "focus escaped" branch and re-focuses the modal's own first/last focusable. The popover's contents have no keyboard path — WCAG 2.1.1.

**Read `docs/AGENTS/ui-shell.md`'s dismissal section before this task.** Its ★★ rule — `kind` MEANS "traps Tab", and a surface gaining a real trap flips its `kind` in the same commit — is why this is two changes.

**Files:**
- Modify: `src/app/popover-panel.tsx`
- Test: `src/app/dismissal-integration.test.tsx`

- [ ] **Step 0: Prove the real component mounts under jsdom before writing anything against it**

Everything in this task assumes the real `PopoverPanel` renders in jsdom. A comment in the very file you are about to edit denies it. Settle it in ten seconds:

```bash
npx vitest run src/app/popover-panel.test.tsx -t "portals the panel to document.body" > /tmp/t5pre.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5pre.log
```
Expected: `EXIT=0`. That test renders the real component with no rect stub and resolves it by role, so the panel demonstrably mounts.

If it does NOT pass, stop and re-plan: the tests below would be asserting against a component that never rendered, and `getByRole` would throw with a confusing message rather than telling you why.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/dismissal-integration.test.tsx`. Import the real component and a ref hook at the top:

```tsx
import { PopoverPanel } from "./popover-panel";
```

`useRef` and `useState` are already imported in that file. Then add a real-component harness and a new `describe`:

```tsx
/** Unlike the `Popover` stand-in above, this mounts the REAL PopoverPanel — the
 *  Tab cycle is the thing under test and a hook stand-in cannot exercise it.
 *  jsdom mounts it fine: with zero rects `right` and `spaceBelow` still compute,
 *  so `setPos` fires and the panel portals. The `withRects` helper in
 *  popover-panel.test.tsx is for GEOMETRY assertions, not for mounting. */
function ModalWithRealPopover({ closeModal }: { closeModal: () => void }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal open onClose={closeModal} ariaLabel="Editor">
      <button type="button">modal first</button>
      <button ref={btnRef} type="button" onClick={() => setPopoverOpen(true)}>
        field
      </button>
      <PopoverPanel
        open={popoverOpen}
        anchorRef={btnRef}
        onClose={() => setPopoverOpen(false)}
        role="dialog"
        ariaLabel="Fields"
        className="w-64 p-2"
      >
        <button type="button">panel first</button>
        <button type="button">panel last</button>
      </PopoverPanel>
      <button type="button">modal last</button>
    </Modal>
  );
}

function pressTab(from: HTMLElement, shiftKey = false): KeyboardEvent {
  from.focus();
  const e = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    from.dispatchEvent(e);
  });
  return e;
}

describe("Tab containment across a portaled popover", () => {
  beforeEach(() => resetDismissalStack());

  it("cycles Tab inside the popover instead of ejecting to the modal", () => {
    render(<ModalWithRealPopover closeModal={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "field" }));
    pressTab(screen.getByRole("button", { name: "panel last" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "panel first" }),
    );
    expect(screen.getByRole("dialog", { name: "Fields" })).toBeInTheDocument();
  });

  it("wraps Shift+Tab from the first control to the last", () => {
    render(<ModalWithRealPopover closeModal={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "field" }));
    pressTab(screen.getByRole("button", { name: "panel first" }), true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "panel last" }),
    );
  });

  it("pulls a Tab arriving from outside into the popover", () => {
    render(<ModalWithRealPopover closeModal={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "field" }));
    pressTab(screen.getByRole("button", { name: "modal last" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "panel first" }),
    );
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/app/dismissal-integration.test.tsx -t "Tab containment across a portaled popover" > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t5.log
```
Expected: FAIL. The first two land on `modal first` (the modal's trap fired its "focus escaped" branch); the third also lands wrong.

- [ ] **Step 3: Flip the kind and capture the token**

In `src/app/popover-panel.tsx`, change the `useDismissable` call to capture its return and push `"modal"`:

```tsx
  // ★★★ `kind: "modal"` because this panel now TRAPS TAB (the effect below).
  // `docs/AGENTS/ui-shell.md`: `kind` MEANS "traps Tab", not "looks like a
  // dialog", and a surface gaining a real trap flips its kind in the SAME
  // commit. The flip is also what makes the fix work — `modal.tsx`'s Tab branch
  // consults `isTopmostOfKind`, which goes false while this panel is open, so
  // the modal beneath defers instead of competing (open-followups §100).
  // ★ Escape is unaffected: modal and layer compete equally for it.
  const dismissToken = useDismissable({ open, kind: "modal", onDismiss: closeRestoringFocus });
```

Add the imports at the top of the file:

```tsx
import { isTopmostOfKind } from "./dismissal-stack";
import { FOCUSABLE_SELECTOR } from "./focusables";
```

- [ ] **Step 4: Add the Tab cycle**

★★★ **Three different focusable selectors exist and they are NOT interchangeable. Use `FOCUSABLE_SELECTOR` from Task 1, deliberately.** The popover's own `autoFocus` effect uses two inline selector strings — a narrow `'input:not([tabindex="-1"]),button:not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])'` arm with an `"input,button,[tabindex]"` fallback — and **neither covers `a[href]`, `select`, `textarea`, or `:not([disabled])`**. Building the Tab cycle on the narrow arm would skip links, selects and textareas inside a panel and would land on disabled buttons. Do not "reuse the existing selector" without saying which; `autoFocus` answers "where should focus START", the cycle answers "what is in the tab order", and only the second needs the full set.

★★ **A panel whose every control is `tabIndex={-1}` matches `FOCUSABLE_SELECTOR` nowhere, so `focusables.length === 0` and the effect returns without trapping. That is correct, not a hole.** `CollapsedNavFlyout` is exactly that shape — an arrow-navigated menu with no tab stops — and it already owns its own Tab handling (it `preventDefault`s and re-focuses the trigger). The early return is what lets it keep doing so. Note this differs from `modal.tsx`, which on zero focusables `preventDefault`s and focuses the dialog root; a popover must NOT do that, because the panel is a `<span>` with no `tabIndex` and focusing it would strand the user on an unfocusable element.

Add this effect after the `useDismissable` call:

```tsx
  // ★★★ §100. The panel is PORTALED to document.body, so an enclosing Modal's
  // Tab trap — which guards on `container.contains(active)` — reads false for
  // EVERY element in here, not merely at the boundary. Its "focus escaped"
  // branch therefore fired on the first Tab and threw the user back into the
  // modal, leaving this panel's controls with no keyboard path at all
  // (WCAG 2.1.1). We cycle Tab ourselves instead.
  //
  // ★★ Gated on `isTopmostOfKind` so this stands down when something is layered
  // ABOVE us — which happens today: `version-menu`'s VersionInfo child opens a
  // real Modal from INSIDE this popover. Without the gate that modal and this
  // panel would both trap. Every Tab trap in the app consults the stack; keep
  // it that way.
  //
  // ★ Escape and outside-click remain the exits. This deliberately does NOT
  // close on Tab: `CollapsedNavFlyout` does that, but its items are all
  // tabIndex={-1} and arrow-navigated, so it has no tab stops to strand. A
  // panel with real tab stops needs a cycle, not an exit.
  useEffect(() => {
    if (!rendered) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || e.defaultPrevented) return;
      if (!isTopmostOfKind(dismissToken, "modal")) return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [rendered, dismissToken]);
```

- [ ] **Step 5: Run and watch them pass**

```bash
npx vitest run src/app/dismissal-integration.test.tsx src/app/popover-panel.test.tsx src/app/modal.test.tsx > /tmp/t5b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5b.log
```
Expected: `EXIT=0`. `modal.test.tsx`'s existing "keeps Tab containment when a popover layers above it" must still pass — it pushes a bare `Symbol` with no DOM, so it is unaffected.

- [ ] **Step 6: Add the inverse-nesting test**

A `Modal` opened from inside a popover must win. Add to the same `describe`:

```tsx
it("stands down when a modal is opened from inside the popover", () => {
  function PopoverWithModal() {
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const btnRef = useRef<HTMLButtonElement>(null);
    return (
      <div>
        <button ref={btnRef} type="button" onClick={() => setPopoverOpen(true)}>
          menu
        </button>
        <PopoverPanel open={popoverOpen} anchorRef={btnRef} onClose={() => setPopoverOpen(false)} role="dialog" ariaLabel="Menu" className="w-64 p-2">
          <button type="button" onClick={() => setModalOpen(true)}>about</button>
        </PopoverPanel>
        {modalOpen && (
          <Modal open onClose={() => setModalOpen(false)} ariaLabel="About">
            <button type="button">inner first</button>
            <button type="button">inner last</button>
          </Modal>
        )}
      </div>
    );
  }
  render(<PopoverWithModal />);
  fireEvent.click(screen.getByRole("button", { name: "menu" }));
  fireEvent.click(screen.getByRole("button", { name: "about" }));
  pressTab(screen.getByRole("button", { name: "inner last" }));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "inner first" }),
  );
});
```

Run:
```bash
npx vitest run src/app/dismissal-integration.test.tsx -t "stands down when a modal" > /tmp/t5c.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=0` — it passes because of the `isTopmostOfKind` gate.

- [ ] **Step 7: Mutation-check the gate**

Delete the `if (!isTopmostOfKind(dismissToken, "modal")) return;` line and re-run:
```bash
npx vitest run src/app/dismissal-integration.test.tsx -t "stands down when a modal" > /tmp/t5m.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=1`. Then mutate the `kind` back to `"layer"` and run the first three tests:
```bash
npx vitest run src/app/dismissal-integration.test.tsx -t "Tab containment across a portaled popover" > /tmp/t5m2.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=1` — proving the flip is load-bearing and not decoration. Revert both mutations with anchored `Edit`s and confirm `git diff --stat src/app/popover-panel.tsx` shows only intended changes.

- [ ] **Step 8: Full unit suite**

```bash
npm run test:run > /tmp/t5full.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5full.log
```
Expected: `EXIT=0`. This is the first point where the `kind` flip could break an unrelated surface, so run everything.

- [ ] **Step 9: Correct the stand-in's docstring**

The `Popover` stand-in in `src/app/dismissal-integration.test.tsx` says the real portal "never positions itself" under jsdom. Step 0 disproved that, and the tests you just added are the counter-example sitting in the same file. Leave it and the next reader writes a stand-in test for something that needs the real component.

Replace that docstring with:

```tsx
/** Stand-in for a document-level popover, hosted on the hook. It exists to keep
 *  the ESCAPE-ordering tests below focused on stack order rather than on a
 *  component's lifecycle — NOT because the real component cannot render here.
 *  ★★ It can: with jsdom's zero rects the measure effect still computes
 *  `right = max(8, innerWidth)` and a `spaceBelow` of 768 that clears
 *  MIN_SPACE_BELOW, so `setPos` fires and the panel portals. An earlier version
 *  of this comment claimed the opposite and would have pushed the §100 Tab
 *  tests onto this stand-in, where a Tab cycle cannot be exercised at all.
 *  See `ModalWithRealPopover` below, which drives the real PopoverPanel. */
```

- [ ] **Step 10: Commit**

```bash
git add src/app/popover-panel.tsx src/app/dismissal-integration.test.tsx
git commit -m "fix: give PopoverPanel its own Tab cycle so a portaled popover in a modal is reachable"
```

---

### Task 6: Guard comment on the load-bearing drawer literal

**Why:** the `use-focus-trap` double-trap risk is not reachable today only because `modern-shell` passes a hardcoded `false` for `collapsed` into the drawer. That is one token, in a file this slice does not otherwise touch.

**Files:**
- Modify: `src/app/modern-shell.tsx`

- [ ] **Step 1: Find the call**

```bash
grep -n "renderSidebar(false" src/app/modern-shell.tsx
```
Expected: one line, inside the drawer branch.

- [ ] **Step 2: Add the comment above that call**

```tsx
        {/* ★★★ The `false` is LOAD-BEARING, not a default. It renders the
            sidebar EXPANDED inside the drawer, which is what keeps
            `CollapsedNavFlyout` — the only PopoverPanel in this subtree, gated
            on `collapsed` — out of the drawer's focus trap. That matters
            because `use-focus-trap.ts` traps Tab unconditionally without
            consulting the dismissal stack, while PopoverPanel portals to
            document.body: a popover in here would have its DOM invisible to the
            trap's focusables list, so the trap would yank focus back OUT of it
            on every Tab. Change this to `collapsed` and you ship that bug.
            ★★ The `footer` slot is the other way in — it renders inside the
            drawer ungated and arrives as a prop, so no import-closure check
            over sidebar.tsx can ever see a PopoverPanel added under
            `sidebar-footer.tsx`. */}
```

- [ ] **Step 3: Verify it compiles and nothing moved**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git ls-files --eol src/app/modern-shell.tsx
```
Expected: `EXIT=0`; the eol row reads `i/lf w/crlf`.

- [ ] **Step 4: Commit**

```bash
git add src/app/modern-shell.tsx
git commit -m "docs: name the drawer literal that keeps a popover out of the focus trap"
```

---

### Task 7: Update the dismissal protocol doc

**Files:**
- Modify: `docs/AGENTS/ui-shell.md`

- [ ] **Step 1: Locate the two claims to change**

```bash
grep -n "isTopmostOfKind\|kind: \"layer\"\|traps Tab" docs/AGENTS/ui-shell.md
```

- [ ] **Step 2: Correct the over-general claim**

The doc states that only the topmost modal contains Tab, via `isTopmostOfKind`. That is true of `modal.tsx` and now of `popover-panel.tsx`, and false of `use-focus-trap.ts`. Replace that sentence with:

```
only the topmost `"modal"` entry contains Tab (`isTopmostOfKind`) — with ONE
exception. ★★★ `use-focus-trap.ts` pushes `kind: "modal"` and traps Tab
UNCONDITIONALLY: its Tab branch never consults the stack, and it is gated on
`active` alone while its stack PUSH additionally requires an `onEscape`. So
`inline-ai-edit-popover`, which passes no `onEscape`, runs a live Tab trap while
never joining the stack at all — invisible to every stack-consulting reader.
Verify rather than trust this: `grep -rn "isTopmostOfKind" src/app --include=*.ts
--include=*.tsx | grep -v "\.test\."` returns the declaration, the import, and
exactly TWO real call sites (`modal.tsx`, `popover-panel.tsx`). Reasoning about
Tab from the unqualified sentence gets the drawer case wrong; open-followups §316.
```

- [ ] **Step 3: Record what `PopoverPanel` now pushes**

Wherever the doc says `PopoverPanel` pushes `kind: "layer"`, change it to `"modal"` and add:

```
★★ It pushes `"modal"` as of 0.270.0 because it now owns a real Tab cycle over
its portaled content (open-followups §100). Escape is unchanged — both kinds
compete equally for it. The cycle is itself gated on `isTopmostOfKind`, so a
Modal opened from inside a popover (`version-menu`'s VersionInfo) still wins.
```

- [ ] **Step 4: Verify the symbol gate**

```bash
npm run docs:symbols:check > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t7.log
```
Expected: `EXIT=0`. Every backticked mixed-case name above exists in `src`.

- [ ] **Step 5: Commit**

```bash
git add docs/AGENTS/ui-shell.md
git commit -m "docs: record the PopoverPanel kind flip and the use-focus-trap exception"
```

---

### Task 8: Close the register entries and file the new one

**Files:**
- Modify: `docs/open-followups.md`

**★★ Closing an entry is a FOUR-place edit.** The heading marker, the summary-table STATUS cell, the summary-table ANCHOR (the heading slug — em dash dropped, each surrounding space becomes `-`), and the `**Status:**` line. Miss one and `followups:status:check` or a stale anchor survives.

- [ ] **Step 1: Close §100, §297 and §124**

For each, append ` — CLOSED 2026-08-31` to the heading, update the anchor in its summary-table row to match the new slug, set the table's status cell to `closed`, and rewrite the `**Status:**` line to name what closed it and how it was verified. Example for §100:

```
**Status:** CLOSED 2026-08-31 — `PopoverPanel` now owns a Tab cycle over its
portaled content and pushes `kind: "modal"`, so `modal.tsx`'s `isTopmostOfKind`
branch defers to it. Verified by three tests in `dismissal-integration.test.tsx`
("Tab containment across a portaled popover"), each mutation-checked: reverting
the kind to `"layer"` turns all three red, and deleting the `isTopmostOfKind`
gate turns the inverse-nesting test red.
```

- [ ] **Step 2: File §316**

The next free number is **316** — 304, 305 and 308–315 are reserved on a concurrent unmerged branch. Add:

```
## 316. `use-focus-trap` runs a Tab trap that never joins the dismissal stack — open

**Status:** open — **never machine-verified**; read from source on 2026-08-31
while closing §100. Reproduce with `grep -n "active" src/app/use-focus-trap.ts`.

Its Tab branch is gated on `active` alone, while its stack PUSH is gated on
`active && hasEscape`. `inline-ai-edit-popover` passes no `onEscape`, so it runs
a live, unconditional Tab trap while never appearing in the stack.

★★ Consequence for anything that reasons about Tab from the stack — which is now
`modal.tsx` AND `popover-panel.tsx` — is that this trap is structurally
invisible. §100's fix is correct today only because no `PopoverPanel` is
reachable inside either `useFocusTrap` call site, which was established by
tracing both render paths, not by a guard.

★★★ The two things that would make it reachable are single tokens in unrelated
files: `renderSidebar`'s hardcoded `false` in `modern-shell.tsx` becoming
`collapsed`, or anything under `sidebar-footer.tsx` gaining a `PopoverPanel` —
the `footer` slot renders inside the drawer ungated and arrives as a prop, so no
import-closure check over `sidebar.tsx` can see it. A comment at the literal
names both.

★ The failure would not be two symmetric traps. `PopoverPanel` portals to
`document.body` and the trap enumerates `container.querySelectorAll`, so the
popover's DOM is invisible to it and the drawer trap would yank focus back OUT
on every Tab — §100's own defect one layer up.
```

- [ ] **Step 3: Verify both gates**

```bash
npm run followups:status:check > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t8.log
npm run docs:claims:check > /tmp/t8b.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t8b.log
```
Expected: `EXIT=0` for both. `docs:claims:check` is a ratchet — it fails on a NEW `path:LINE` citation, so the text above deliberately cites symbols and greps only.

- [ ] **Step 4: Commit**

```bash
git add docs/open-followups.md
git commit -m "docs: close followups 100, 297 and 124; file 316"
```

---

### Task 9: Release 0.270.0

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, and the five satellites `version:sync` writes.

- [ ] **Step 1: Bump the source of truth**

In `src/app/version.ts` set `APP_VERSION = "0.270.0"`, `APP_MILESTONE = "Nagata"`, and `APP_BUILD_DATE` to `2026-08-31`.

★ 0.269.0 "Due" is reserved by a concurrent unmerged branch. Do not take it.

- [ ] **Step 2: Propagate**

```bash
npm run version:sync > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t9.log
npm run version:check > /tmp/t9b.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t9b.log
```
Expected: `EXIT=0` from `version:check`. Exit 1 means drift; exit 2 means the gate could not scan, which is a different problem.

- [ ] **Step 3: Write the CHANGELOG entry**

Add a `## 0.270.0 "Nagata"` section. Every line must describe something a **0.269.x user actually experienced** — not a defect this branch introduced and repaired before merge. Three `### Fixed` entries:

```markdown
- **A menu opened inside a dialog could not be reached with the keyboard.** Opening the
  field-visibility menu in an edit dialog and pressing Tab threw you back into the dialog behind it,
  with the menu still open — so its checkboxes and its Reset button could not be reached at all
  without a mouse. Tab now moves through the menu's own controls.
- **Picking something from a menu lost your place.** Choosing an item — exporting, applying a
  template, acting on a row or a document block — closed the menu and dropped keyboard focus to the
  top of the page. Focus now returns to the button you opened the menu from.
- **A menu could refuse to open.** Clicking a menu button that sat off the edge of a scrolling area
  made the page scroll to reveal it, and that scroll closed the menu before it appeared — so the
  button looked dead and a second click was needed. It now opens on the first click.
```

- [ ] **Step 4: Verify the whole gate set locally**

```bash
npx eslint src; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npm run test:run > /tmp/t9c.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t9c.log
npm run size:check > /tmp/t9d.log 2>&1; echo "EXIT=$?"
npm run dup:check > /tmp/t9e.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=0` from every one. `dup:check` matters here because Task 1 removed three duplicate blocks and Task 5 added a Tab handler that resembles `modal.tsx`'s.

Then confirm no source file was re-lined by an edit anywhere in the slice:

```bash
git ls-files --eol $(git diff --name-only origin/main...HEAD -- 'src/**') 
```
Expected: every row reads `i/lf w/crlf`. A row reading `i/lf w/lf` means that file was written with `Write` instead of `Edit` — the working copy is re-lined. It commits to an identical blob so `git diff` will not show it, but it breaks the next `\r\n`-anchored edit against that file.

- [ ] **Step 5: Run the a11y gate on the two affected views**

The two consumers that mount inside a `Modal` are reached from Open Points and the edit modals.

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Open Points" > /tmp/t9f.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t9f.log
```
Expected: `EXIT=0`. `--workers=1` is mandatory — local runs default to CPU count while CI runs serially, and over-subscription produces `Test timeout of 60000ms exceeded` failures that look like violations but name no rule.

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS
git commit -m "chore: release 0.270.0 Nagata"
```

---

## Manual verification owed before release

jsdom has no layout and axe cannot see Tab order, so three things in this slice are pinned by unit tests only and want one pass in a real browser:

- [ ] Open an edit modal, open its field-visibility menu, Tab through it. Focus must cycle inside the menu and never jump to the dialog behind it.
- [ ] Open the Open Points row ⋮ menu on a horizontally scrolled table where the trigger is near the edge. It must open on the first click.
- [ ] Open any menu, activate an item with Enter, then press Tab. Focus must continue from the button you opened, not from the top of the page.

★★★ **The third item MUST be done in Chromium specifically, and repeated in Firefox.** §297's
restore is the one thing in this slice whose behaviour was measured to DIVERGE between the two
engines, and the first two attempts at it were each green in one engine and dead in the other. A
pass in only one browser is not evidence. Also check the outside-click direction in both: click
outside an open menu and confirm focus does NOT snap back to the trigger (that is §146, and it is
now held by an explicit clear rather than by blur timing).
