# Escape Dismissal Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace phase-ordering with an explicit arbiter so exactly one layer acts on each Escape keypress.

**Architecture:** A module-level stack of open layers in open order, each tagged `modal` or `layer` and carrying an optional `claims()` predicate. Escape goes to the topmost entry that claims it; Tab containment asks a separate question (topmost *modal*) so a popover above a modal cannot waive WCAG 2.4.3. All document-level closers return to bubble phase, because registration order stops mattering once the stack decides.

**Tech Stack:** TypeScript, React 19, Next 16, vitest + React Testing Library, Playwright (axe gate).

**Spec:** `docs/superpowers/specs/2026-07-27-dismissal-stack-design.md`

**Branch:** `feature/dismissal-stack`, cut from `main` @ `dc77cbb4`.

---

## Task ordering is load-bearing

Tasks 3 → 4 → 5/6/7 must run in that order, because each intermediate commit has to stay green:

- **Modal migrates first (Task 3).** While Modal is on the stack and the popovers are still capture-phase, the popovers `preventDefault` and Modal's `claimsEscape` declines on `defaultPrevented`. Correct.
- **The reverse order breaks.** If a popover moved to bubble+stack while Modal still used its private `modalStack`, Modal (registered first, bubble) would run first, see `defaultPrevented === false`, and close. That is the exact two-layer bug.

Do not reorder these tasks.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/dismissal-stack.ts` | create | Pure ordering logic. No React, no DOM except reading the event. |
| `src/app/dismissal-stack.test.ts` | create | Unit tests for the above. |
| `src/app/use-dismissable.ts` | create | React wrapper: push/pop + one bubble listener. Exports `claimsWhenFocusWithin`. |
| `src/app/use-dismissable.test.tsx` | create | Hook-level tests. |
| `src/app/modal.tsx` | modify | Drop private `modalStack`; Escape → `claimsEscape`, Tab → `isTopmostOfKind`. |
| `src/app/use-popover-dismiss.ts` | modify | Escape half → `useDismissable`; keep own `mousedown`. |
| `src/app/popover-panel.tsx` | modify | Same. |
| `src/app/notes-window.tsx` | modify | Focus gate moves into `claims`. |
| `src/app/use-focus-trap.ts` | modify | Register only when `onEscape` given. |
| `src/app/help-menu.tsx` | modify | Gains protocol + focus gate. |
| `src/app/raci-chip-picker.tsx` | modify | Gains protocol. |
| `src/app/tour-overlay.tsx` | modify | Gains protocol; focus-per-step effect split out. |
| `src/app/dismissal-integration.test.tsx` | create | The four cross-surface cases. |
| `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `AGENTS.md`, `package.json` | modify | Release. |

---

### Task 1: The pure dismissal stack

**Files:**
- Create: `src/app/dismissal-stack.ts`
- Test: `src/app/dismissal-stack.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/dismissal-stack.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  claimsEscape,
  escapeOwner,
  isTopmostOfKind,
  popDismissal,
  pushDismissal,
  resetDismissalStack,
} from "./dismissal-stack";

/** A KeyboardEvent stand-in. The module reads five fields and nothing else, so
 *  a cast object is honest here and keeps these tests DOM-free. */
function esc(over: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "Escape",
    defaultPrevented: false,
    isComposing: false,
    keyCode: 27,
    ...over,
  } as KeyboardEvent;
}

describe("dismissal-stack", () => {
  beforeEach(() => resetDismissalStack());

  it("has no owner when empty", () => {
    expect(escapeOwner()).toBeNull();
  });

  it("gives Escape to the last-pushed entry", () => {
    const outer = Symbol("outer");
    const inner = Symbol("inner");
    pushDismissal(outer, "modal");
    pushDismissal(inner, "layer");
    expect(escapeOwner()).toBe(inner);
  });

  it("returns ownership to the layer beneath when the top pops", () => {
    const outer = Symbol("outer");
    const inner = Symbol("inner");
    pushDismissal(outer, "modal");
    pushDismissal(inner, "layer");
    popDismissal(inner);
    expect(escapeOwner()).toBe(outer);
  });

  it("removes only the last occurrence of a token", () => {
    const token = Symbol("dup");
    const other = Symbol("other");
    pushDismissal(token, "layer");
    pushDismissal(other, "layer");
    pushDismissal(token, "layer");
    popDismissal(token);
    // The earlier push survives, so `other` is not yet on top.
    expect(escapeOwner()).toBe(other);
  });

  it("ignores a pop for a token that was never pushed", () => {
    const live = Symbol("live");
    pushDismissal(live, "layer");
    popDismissal(Symbol("ghost"));
    expect(escapeOwner()).toBe(live);
  });

  it("walks past an entry that declines", () => {
    const modal = Symbol("modal");
    const panel = Symbol("panel");
    pushDismissal(modal, "modal");
    pushDismissal(panel, "layer", () => false);
    expect(escapeOwner()).toBe(modal);
  });

  it("has no owner when every entry declines", () => {
    pushDismissal(Symbol("a"), "layer", () => false);
    pushDismissal(Symbol("b"), "layer", () => false);
    expect(escapeOwner()).toBeNull();
  });

  it("treats a throwing predicate as declining rather than fatal", () => {
    const modal = Symbol("modal");
    pushDismissal(modal, "modal");
    pushDismissal(Symbol("broken"), "layer", () => {
      throw new Error("predicate blew up");
    });
    expect(escapeOwner()).toBe(modal);
  });

  it("asks a kind-scoped question for Tab containment", () => {
    const modal = Symbol("modal");
    const popover = Symbol("popover");
    pushDismissal(modal, "modal");
    pushDismissal(popover, "layer");
    // A popover above the modal owns Escape but must NOT take Tab containment.
    expect(escapeOwner()).toBe(popover);
    expect(isTopmostOfKind(modal, "modal")).toBe(true);
    expect(isTopmostOfKind(popover, "modal")).toBe(false);
  });

  it("reports no topmost of a kind that is absent", () => {
    const popover = Symbol("popover");
    pushDismissal(popover, "layer");
    expect(isTopmostOfKind(popover, "modal")).toBe(false);
  });

  describe("claimsEscape", () => {
    let token: symbol;
    beforeEach(() => {
      token = Symbol("token");
      pushDismissal(token, "layer");
    });

    it("claims a plain Escape for the owner", () => {
      expect(claimsEscape(esc(), token)).toBe(true);
    });

    it("declines for a non-owner", () => {
      expect(claimsEscape(esc(), Symbol("someone else"))).toBe(false);
    });

    it("declines a key that is not Escape", () => {
      expect(claimsEscape(esc({ key: "Tab" }), token)).toBe(false);
    });

    it("declines an Escape an element-scoped handler already took", () => {
      expect(claimsEscape(esc({ defaultPrevented: true }), token)).toBe(false);
    });

    it("declines while an IME composition owns the key", () => {
      expect(claimsEscape(esc({ isComposing: true }), token)).toBe(false);
    });

    it("declines on the legacy IME keyCode 229", () => {
      expect(claimsEscape(esc({ keyCode: 229 }), token)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/dismissal-stack.test.ts
```

Expected: FAIL — `Failed to resolve import "./dismissal-stack"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/dismissal-stack.ts`:

```ts
// The app's single arbiter for Escape.
//
// Escape is a DISMISSAL: exactly one layer should act on it. Before this
// module, every closer inferred locally whether the keypress was its own, and
// the inference was phase ordering — which fails, because native listeners on
// one node fire in REGISTRATION order and a modal opens before a popover
// inside it. Capture phase papered over that for Modal specifically but not
// for peers (capture listeners are registration-ordered too), and it broke
// element-scoped handlers, which React delegates at BUBBLE: a capture-phase
// closer ran before a combobox's own handler and took both layers down.
//
// Nesting is knowable directly, so this module knows it. Every document-level
// closer registers while open and asks `claimsEscape` before acting. Phase no
// longer matters; every caller is back on bubble.
//
// ★★ PRECONDITION: stack order is OPEN order, and open order equals NESTING
// order, because a layer opens in response to a user action and never in the
// same commit as its parent. If a parent and child ever pushed in one commit,
// React runs child effects BEFORE parent effects and the parent would end up
// topmost — inverted. This is asserted, not detected: the obvious detection is
// DOM containment, and `PopoverPanel` is a portal, which defeats it.

/** `modal` traps Tab; `layer` does not. Both compete equally for Escape. */
export type DismissalKind = "modal" | "layer";

interface DismissalEntry {
  token: symbol;
  kind: DismissalKind;
  /** Return false to pass this Escape down. Absent means "always claims". */
  claims?: () => boolean;
}

const stack: DismissalEntry[] = [];

/** Register an open layer. Call from an `[open]`-keyed effect ONLY — see the
 *  note on `popDismissal`. */
export function pushDismissal(
  token: symbol,
  kind: DismissalKind,
  claims?: () => boolean,
): void {
  stack.push({ token, kind, claims });
}

/** Deregister. Removes the LAST occurrence, so a token pushed twice (which a
 *  correctly-written caller never does) unwinds in the right order.
 *  ★★ The push/pop effect's deps must be `[open]` alone: re-running it moves
 *  the token to the TOP of the stack, making the wrong layer topmost. That bug
 *  bit `modal.tsx` twice via an unstable `onClose` identity before it was
 *  understood — pass handlers through refs, never through deps. */
export function popDismissal(token: symbol): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].token === token) {
      stack.splice(i, 1);
      return;
    }
  }
}

/** Topmost entry of `kind`. This is the TAB question, and it is deliberately
 *  not the Escape question: containment is WCAG 2.4.3, and a popover layered
 *  above a modal traps nothing, so the modal keeps Tab regardless. */
export function isTopmostOfKind(token: symbol, kind: DismissalKind): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].kind === kind) return stack[i].token === token;
  }
  return false;
}

/** The one entry that owns the next Escape, or null if nobody claims it.
 *  ★ A predicate that throws DECLINES. That is the failure direction which
 *  keeps Escape working for the layers beneath, rather than killing dismissal
 *  app-wide because one panel's focus check hit a detached node. */
export function escapeOwner(): symbol | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    if (!entry.claims) return entry.token;
    let claimed = false;
    try {
      claimed = entry.claims() === true;
    } catch {
      claimed = false;
    }
    if (claimed) return entry.token;
  }
  return null;
}

/** The single guard every dismissal handler calls. */
export function claimsEscape(e: KeyboardEvent, token: symbol): boolean {
  if (e.key !== "Escape") return false;
  // ★ An element-scoped handler (the combobox pickers, global search) marked
  // this handled. Those stay OUT of the stack on purpose: focus location is a
  // stronger signal than open order for a widget that only exists while its
  // own field has focus, and React's boot-registered delegation already runs
  // them before any effect listener.
  if (e.defaultPrevented) return false;
  // ★ Escape during IME composition cancels the composition, not a layer.
  if (e.isComposing || e.keyCode === 229) return false;
  return escapeOwner() === token;
}

/** TEST ONLY. Empties the stack so one test's leaked entry cannot alter the
 *  next test's ordering. Never call this from app code — it would strand every
 *  open layer's handler, which then silently stops responding. */
export function resetDismissalStack(): void {
  stack.length = 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/app/dismissal-stack.test.ts
```

Expected: PASS, 17 tests.

- [ ] **Step 5: Mutation-check three guards**

A test that passes both ways proves nothing, and this repo has shipped several. Verify each of these fails, then restore:

1. In `claimsEscape`, delete the `if (e.defaultPrevented) return false;` line → "declines an Escape an element-scoped handler already took" must FAIL.
2. In `escapeOwner`, replace the `try/catch` with a bare `entry.claims()` → "treats a throwing predicate as declining" must FAIL (it throws).
3. In `isTopmostOfKind`, drop the `kind` filter (`if (true)`) → "asks a kind-scoped question for Tab containment" must FAIL.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/dismissal-stack.ts src/app/dismissal-stack.test.ts
git commit -m "feat(a11y): add the dismissal stack, one arbiter for Escape"
```

---

### Task 2: The React wrapper

**Files:**
- Create: `src/app/use-dismissable.ts`
- Test: `src/app/use-dismissable.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/use-dismissable.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDismissalStack } from "./dismissal-stack";
import { claimsWhenFocusWithin, useDismissable } from "./use-dismissable";

/** Dispatch Escape from a FOCUSED ELEMENT, never `document`.
 *  ★★ `document.dispatchEvent` is an AT-TARGET dispatch, where capture and
 *  bubble listeners both fire in plain registration order — so it cannot tell
 *  a phase fix from a no-op, and a test built on it lies. */
function pressEscape(from: HTMLElement): KeyboardEvent {
  from.focus();
  const e = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  from.dispatchEvent(e);
  return e;
}

function Panel({
  open,
  onDismiss,
  gated = false,
  label,
}: {
  open: boolean;
  onDismiss: () => void;
  gated?: boolean;
  label: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDismissable({
    open,
    kind: "layer",
    onDismiss,
    claims: gated ? claimsWhenFocusWithin(panelRef) : undefined,
  });
  return (
    <div ref={panelRef}>
      <button type="button">{label}</button>
    </div>
  );
}

describe("useDismissable", () => {
  beforeEach(() => resetDismissalStack());

  it("dismisses on Escape and marks the event handled", () => {
    const onDismiss = vi.fn();
    render(<Panel open onDismiss={onDismiss} label="inside" />);
    const e = pressEscape(screen.getByRole("button", { name: "inside" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // ★★ Assert defaultPrevented — a property of the EVENT. Asserting "some
    // other listener did not fire" is a property of RTL's div-under-body
    // topology, which the real app (root === document) never has.
    expect(e.defaultPrevented).toBe(true);
  });

  it("does nothing while closed", () => {
    const onDismiss = vi.fn();
    render(<Panel open={false} onDismiss={onDismiss} label="inside" />);
    const e = pressEscape(document.body as HTMLElement);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("gives Escape to the layer opened last", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Panel open onDismiss={outer} label="outer" />
        <Panel open onDismiss={inner} label="inner" />
      </>,
    );
    pressEscape(screen.getByRole("button", { name: "inner" }));
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("passes Escape down when a gated panel does not have focus", () => {
    const ungated = vi.fn();
    const gated = vi.fn();
    render(
      <>
        <Panel open onDismiss={ungated} label="ungated" />
        <Panel open gated onDismiss={gated} label="gated" />
      </>,
    );
    // Focus sits in the FIRST panel, so the gated panel above it declines and
    // the layer beneath must act. Without the top-down walk, nobody would.
    pressEscape(screen.getByRole("button", { name: "ungated" }));
    expect(gated).not.toHaveBeenCalled();
    expect(ungated).toHaveBeenCalledTimes(1);
  });

  it("lets a gated panel claim Escape when focus is inside it", () => {
    const ungated = vi.fn();
    const gated = vi.fn();
    render(
      <>
        <Panel open onDismiss={ungated} label="ungated" />
        <Panel open gated onDismiss={gated} label="gated" />
      </>,
    );
    pressEscape(screen.getByRole("button", { name: "gated" }));
    expect(gated).toHaveBeenCalledTimes(1);
    expect(ungated).not.toHaveBeenCalled();
  });

  it("keeps its place in the stack when onDismiss identity changes", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    function Harness({ nonce }: { nonce: number }) {
      return (
        <>
          <Panel open onDismiss={outer} label="outer" />
          {/* A fresh arrow identity every render — the shape that re-ran the
              effect and re-pushed the token to the top in modal.tsx. */}
          <Panel open onDismiss={() => inner(nonce)} label="inner" />
        </>
      );
    }
    const { rerender } = render(<Harness nonce={1} />);
    rerender(<Harness nonce={2} />);
    rerender(<Harness nonce={3} />);
    pressEscape(screen.getByRole("button", { name: "inner" }));
    expect(inner).toHaveBeenCalledTimes(1);
    // Reads the LATEST handler, not the one captured at push time.
    expect(inner).toHaveBeenCalledWith(3);
    expect(outer).not.toHaveBeenCalled();
  });

  it("releases its claim on unmount", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    function Harness({ showInner }: { showInner: boolean }) {
      return (
        <>
          <Panel open onDismiss={outer} label="outer" />
          {showInner && <Panel open onDismiss={inner} label="inner" />}
        </>
      );
    }
    const { rerender } = render(<Harness showInner />);
    rerender(<Harness showInner={false} />);
    pressEscape(screen.getByRole("button", { name: "outer" }));
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/use-dismissable.test.tsx
```

Expected: FAIL — `Failed to resolve import "./use-dismissable"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/use-dismissable.ts`:

```ts
"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  claimsEscape,
  popDismissal,
  pushDismissal,
  type DismissalKind,
} from "./dismissal-stack";

export interface DismissableOptions {
  /** No entry is pushed and no listener attached while false. */
  open: boolean;
  kind: DismissalKind;
  /** Called when this layer wins the Escape. Identity may change freely — it
   *  is read through a ref, never through effect deps. */
  onDismiss: () => void;
  /** Return false to pass the Escape to the layer beneath. Read at EVENT time,
   *  so it must be a live DOM read — never a captured state value. */
  claims?: () => boolean;
}

/** Register an open layer with the dismissal stack and dismiss it when it wins
 *  an Escape. BUBBLE phase: the stack decides ownership, so registration order
 *  is irrelevant and the capture/IME hazard is gone. */
export function useDismissable({
  open,
  kind,
  onDismiss,
  claims,
}: DismissableOptions): void {
  // Matches modal.tsx's token pattern: a Symbol is minted each render but only
  // the first is kept. Assigning to a ref during render would trip the
  // react-hooks purity rule, which CI rejects.
  const tokenRef = useRef<symbol>(Symbol("dismissable"));
  const onDismissRef = useRef(onDismiss);
  const claimsRef = useRef(claims);
  useEffect(() => {
    onDismissRef.current = onDismiss;
    claimsRef.current = claims;
  });

  // ★★ Deps are [open, kind] ONLY. Adding onDismiss or claims here would
  // re-run this on any parent re-render, re-pushing the token to the TOP of
  // the stack and making the wrong layer topmost — the bug modal.tsx hit twice.
  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;
    pushDismissal(token, kind, () => claimsRef.current?.() ?? true);
    return () => popDismissal(token);
  }, [open, kind]);

  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;
    function onKeyDown(e: KeyboardEvent) {
      if (!claimsEscape(e, token)) return;
      // Still mark it: element-scoped handlers and anything outside the stack
      // read `defaultPrevented` as the boundary signal.
      e.preventDefault();
      onDismissRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, kind]);
}

/** Claim Escape only while focus is inside `ref` — or nowhere at all.
 *
 *  ★★ For a NON-MODAL floating panel that stays open while the user works
 *  elsewhere (`notes-window`, `help-menu`). Without this, opening notes, then
 *  opening the task editor, then pressing Escape while typing in the editor
 *  closes notes and leaves the editor up.
 *  ★ `activeElement === body` counts as "nowhere", so Escape immediately after
 *  opening the panel still closes it. */
export function claimsWhenFocusWithin(
  ref: RefObject<HTMLElement | null>,
): () => boolean {
  return () => {
    const focused = document.activeElement;
    if (focused === null || focused === document.body) return true;
    return ref.current?.contains(focused) ?? false;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/app/use-dismissable.test.tsx
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Mutation-check the two rules this hook exists to enforce**

1. Change the push effect deps from `[open, kind]` to `[open, kind, onDismiss, claims]` → "keeps its place in the stack when onDismiss identity changes" must FAIL (`outer` gets called instead of `inner`). Restore.
2. In `claimsWhenFocusWithin`, return `true` unconditionally → "passes Escape down when a gated panel does not have focus" must FAIL. Restore.

- [ ] **Step 6: Typecheck, lint, coverage**

```bash
npx tsc --noEmit && npm run lint && npx vitest run --coverage src/app/dismissal-stack.test.ts src/app/use-dismissable.test.tsx
```

Expected: tsc and lint exit 0. Both new files should show high line and function coverage — they are coverage-gated `.ts` files and the global floors are blocking (lines 92 / funcs 91 / branch 80 / stmts 89).

- [ ] **Step 7: Commit**

```bash
git add src/app/use-dismissable.ts src/app/use-dismissable.test.tsx
git commit -m "feat(a11y): add useDismissable, the React face of the dismissal stack"
```

---

### Task 3: Migrate `Modal` onto the shared stack

**Files:**
- Modify: `src/app/modal.tsx` (the `modalStack` const ~line 38, the push effect ~line 118, the keydown effect ~line 178)
- Test: `src/app/modal.test.tsx` (existing, must stay green)

Nothing else migrates in this task. While Modal is on the stack and the popovers are still capture-phase, they `preventDefault` and Modal's `claimsEscape` declines on `defaultPrevented`. Every intermediate state stays correct.

- [ ] **Step 1: Write the failing test**

Append to `src/app/modal.test.tsx`, inside the existing top-level `describe`:

```tsx
it("keeps Tab containment when a popover layers above it", async () => {
  const { pushDismissal, popDismissal, resetDismissalStack } = await import(
    "./dismissal-stack"
  );
  resetDismissalStack();
  const onClose = vi.fn();
  render(
    <Modal open onClose={onClose} ariaLabel="Editor">
      <button type="button">first</button>
      <button type="button">last</button>
    </Modal>,
  );
  // A popover opens on top of the modal. It owns Escape...
  const popover = Symbol("popover");
  pushDismissal(popover, "layer");

  const first = screen.getByRole("button", { name: "first" });
  first.focus();
  const escape = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  first.dispatchEvent(escape);
  expect(onClose).not.toHaveBeenCalled();

  // ...but Tab containment is NOT waivable by a layer above (WCAG 2.4.3).
  const last = screen.getByRole("button", { name: "last" });
  last.focus();
  const tab = new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
  });
  last.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(first);

  popDismissal(popover);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/modal.test.tsx -t "Tab containment"
```

Expected: FAIL — `onClose` *was* called, because Modal still consults its private `modalStack`, which knows nothing about the popover.

- [ ] **Step 3: Replace the private stack with the shared one**

In `src/app/modal.tsx`, delete this block (currently ~lines 34-38):

```ts
// Stack of currently-open modal tokens (mount order). Only the TOPMOST modal
// responds to Escape / Tab so a nested modal (e.g. the setup wizard opened from
// inside the create-project modal) doesn't double-fire — one Escape would
// otherwise close BOTH and discard the underlying draft.
const modalStack: symbol[] = [];
```

Add to the imports, after the `useEffect`/`useRef` import block:

```ts
import {
  claimsEscape,
  isTopmostOfKind,
  popDismissal,
  pushDismissal,
} from "./dismissal-stack";
```

Replace the membership effect:

```ts
  // Dismissal-stack membership — keyed on [open] ONLY, so push/pop happens
  // exactly on mount-open / unmount-close. Stack order == open order, so the
  // last-opened layer (a nested modal, or a popover inside this one) is
  // always topmost.
  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;
    pushDismissal(token, "modal");
    return () => popDismissal(token);
  }, [open]);
```

- [ ] **Step 4: Split the two keyboard questions**

In the keydown effect, replace the whole handler head — the `modalStack` topmost check plus the Escape branch — so that Escape and Tab ask different questions:

```ts
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // ★★ The dismissal stack decides. A popover opened inside this modal
        // is above it and owns the key; a non-modal panel that declines passes
        // it down to us. `claimsEscape` also honours `defaultPrevented`, which
        // is how element-scoped combobox handlers keep their own Escape:
        // React 19 delegates on `document` (Next passes `document` to
        // hydrateRoot), the very node this listener is on, so their
        // `stopPropagation` could never suppress this handler however
        // convincing it looks under React Testing Library.
        if (!claimsEscape(e, token)) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      // ★ Tab asks a DIFFERENT question. Escape is a dismissal — deferring to
      // whoever is on top is right. Tab is CONTAINMENT: the trap must keep
      // focus inside the dialog no matter what is layered above it, so it
      // gates on the topmost MODAL and is never waivable by a popover
      // (WCAG 2.4.3).
      if (!isTopmostOfKind(token, "modal")) return;
      const container = dialogRef.current;
```

Everything from `if (!container) return;` onward is unchanged.

- [ ] **Step 5: Run the modal suite**

```bash
npx vitest run src/app/modal.test.tsx src/app/popover-in-modal.test.tsx
```

Expected: PASS, including the pre-existing nested-modal and popover-in-modal cases.

- [ ] **Step 6: Mutation-check the split**

Change the Tab gate from `isTopmostOfKind(token, "modal")` to `escapeOwner() === token` (importing `escapeOwner`) → the new test must FAIL, because the popover owns Escape and Tab would leak out of the dialog. Restore.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/modal.tsx src/app/modal.test.tsx
git commit -m "refactor(a11y): Modal defers to the dismissal stack for Escape, keeps Tab"
```

---

### Task 4: Migrate the two popover hooks off capture

**Files:**
- Modify: `src/app/use-popover-dismiss.ts` (whole file)
- Modify: `src/app/popover-panel.tsx` (the dismiss effect, ~lines 119-144)
- Test: `src/app/use-popover-dismiss.test.tsx`, `src/app/popover-panel.test.tsx`, `src/app/popover-in-modal.test.tsx` (all existing, must stay green)

This is the task with reach: `use-popover-dismiss` has 7 consumers and `popover-panel` has 11, and all 18 inherit the change without an edit of their own.

- [ ] **Step 1: Rewrite `use-popover-dismiss.ts`**

Replace the whole file:

```ts
"use client";

import { useEffect, type RefObject } from "react";
import { useDismissable } from "./use-dismissable";

/** Dismiss an open popover/menu on outside-click (mousedown) or Escape. The
 *  `wrapperRef` must wrap BOTH the trigger and the floating panel so a click on
 *  the trigger (which toggles `open`) is treated as inside and does not race the
 *  close. No-op while `open` is false.
 *
 *  Escape is delegated to the dismissal stack: this popover registers as a
 *  `layer` while open, and the stack hands the key to whichever layer is
 *  topmost. That replaced a capture-phase listener, which had been needed only
 *  because `Modal` (opening first) won the bubble phase — and which broke the
 *  combobox pickers, whose React `onKeyDown` handlers React delegates at
 *  bubble, so a capture listener took both layers down at once.
 *
 *  `onClose` no longer needs to be stable for correctness — it is read through
 *  a ref — though a stable identity still avoids re-subscribing the mousedown
 *  listener below. */
export function usePopoverDismiss(
  open: boolean,
  wrapperRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useDismissable({ open, kind: "layer", onDismiss: onClose });

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, wrapperRef, onClose]);
}
```

- [ ] **Step 2: Rewrite the `popover-panel.tsx` dismiss effect**

Add to its imports:

```ts
import { useDismissable } from "./use-dismissable";
```

Add above the existing dismiss effect:

```ts
  // Escape goes through the dismissal stack — see `use-popover-dismiss` for
  // why this is no longer a capture-phase listener.
  useDismissable({ open, kind: "layer", onDismiss: onClose });
```

Then reduce the existing effect to outside-click only:

```ts
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, anchorRef, onClose]);
```

- [ ] **Step 3: Run the affected suites**

```bash
npx vitest run src/app/use-popover-dismiss.test.tsx src/app/popover-panel.test.tsx src/app/popover-in-modal.test.tsx src/app/ask-claude-menu.test.tsx src/app/sidebar-nav.test.tsx src/app/task-row.test.tsx
```

Expected: PASS. `popover-in-modal.test.tsx` is the one that matters — it is the 0.202.4 regression guard and must survive the phase change untouched.

- [ ] **Step 4: Run the whole unit suite**

```bash
npm run test:run
```

Expected: PASS. 18 call sites changed behaviour without being edited, so a broad run is the only honest check here.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/use-popover-dismiss.ts src/app/popover-panel.tsx
git commit -m "refactor(a11y): popovers claim Escape by stack order, not capture phase"
```

---

### Task 5: Move `notes-window`'s focus gate into the stack

**Files:**
- Modify: `src/app/notes-window.tsx` (the Escape effect, ~lines 164-197)
- Test: `src/app/notes-window.test.tsx` (existing, must stay green)

- [ ] **Step 1: Replace the effect**

Add to imports:

```ts
import { claimsWhenFocusWithin, useDismissable } from "./use-dismissable";
```

Delete the entire `// Escape closes (only while open).` comment block and its `useEffect` (through `}, [open, onClose, panelRef]);`) and put in its place:

```tsx
  // Escape closes — but ONLY while focus is inside this window, or nowhere.
  //
  // ★★ This window is NON-MODAL and mounts at the top level: it stays open
  // while the user works anywhere else, including inside a modal it is not
  // part of. An unconditional claim swallowed every Escape in the app — open
  // notes from a row badge, open the task editor, press Escape to dismiss the
  // editor, and the notes window closed while the editor stayed.
  //
  // ★★ The gate lives in `claims` rather than in a handler, and that is
  // load-bearing: a declining entry that stayed topmost would block every
  // layer beneath it, because each of those asks "am I topmost?" and gets
  // `false`. Escape would become a no-op. The stack walks past a decliner
  // instead, so the editor underneath gets the key.
  useDismissable({
    open,
    kind: "layer",
    onDismiss: onClose,
    claims: claimsWhenFocusWithin(panelRef),
  });
```

- [ ] **Step 2: Run the notes suite**

```bash
npx vitest run src/app/notes-window.test.tsx
```

Expected: PASS, unchanged.

- [ ] **Step 3: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/notes-window.tsx
git commit -m "refactor(a11y): notes window declines Escape through the stack"
```

---

### Task 6: `use-focus-trap` registers only when it can act

**Files:**
- Modify: `src/app/use-focus-trap.ts`
- Test: `src/app/use-focus-trap.test.ts` (existing, must stay green)

- [ ] **Step 1: Write the failing test**

Append to `src/app/use-focus-trap.test.ts`:

```ts
it("does not claim Escape when it has no handler to give it to", () => {
  const { escapeOwner, popDismissal, pushDismissal, resetDismissalStack } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./dismissal-stack") as typeof import("./dismissal-stack");
  resetDismissalStack();
  const beneath = Symbol("modal beneath");
  pushDismissal(beneath, "modal");

  const container = document.createElement("div");
  const button = document.createElement("button");
  container.appendChild(button);
  document.body.appendChild(container);
  const ref = { current: container };

  // No onEscape — `inline-ai-edit-popover`'s shape.
  renderHook(() => useFocusTrap(ref, true));

  // ★ An always-claiming entry that does nothing would swallow the key and
  // leave the modal beneath permanently unclosable.
  expect(escapeOwner()).toBe(beneath);

  popDismissal(beneath);
  document.body.removeChild(container);
});
```

If `use-focus-trap.test.ts` does not already import `renderHook` from `@testing-library/react`, add it to the existing import.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/use-focus-trap.test.ts -t "no handler"
```

Expected: FAIL — the module does not import `dismissal-stack` yet, so this passes for the *wrong* reason on a first run. Confirm it fails after Step 3's registration is added but *before* the `hasEscape` guard, by temporarily pushing unconditionally.

- [ ] **Step 3: Implement**

Add to imports:

```ts
import { claimsEscape, popDismissal, pushDismissal } from "./dismissal-stack";
```

Add inside the hook, above the existing effect:

```ts
  const tokenRef = useRef<symbol>(Symbol("focus-trap"));
  // ★★ Register ONLY when there is an `onEscape` to hand the key to. An
  // always-claiming entry that does nothing swallows Escape and blocks every
  // layer beneath — `inline-ai-edit-popover` passes no handler, so that shape
  // is one composition away. Gate on a BOOLEAN, not on `onEscape` itself: an
  // unstable handler identity in the deps would re-push the token to the top
  // of the stack on every parent render.
  const hasEscape = onEscape !== undefined;
  useEffect(() => {
    if (!active || !hasEscape) return;
    const token = tokenRef.current;
    pushDismissal(token, "modal");
    return () => popDismissal(token);
  }, [active, hasEscape]);
```

In the existing `onKeyDown`, replace the Escape branch:

```ts
      if (e.key === "Escape") {
        if (!onEscape) return;
        if (!claimsEscape(e, tokenRef.current)) return;
        e.preventDefault();
        onEscape();
        return;
      }
```

And move the listener from capture to bubble — both registration and removal:

```ts
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      prevFocus?.focus?.();
    };
```

Add `useRef` to the React import if it is not already there.

- [ ] **Step 4: Run the trap suite plus its two consumers**

```bash
npx vitest run src/app/use-focus-trap.test.ts src/app/modern-shell.test.tsx
```

Expected: PASS. The drawer's Tab wrapping is the thing to watch — the listener just moved to bubble, and Tab containment is WCAG 2.4.3.

If `modern-shell.test.tsx` does not exist, run `npx vitest run -t "drawer"` instead and record what covers the drawer.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/use-focus-trap.ts src/app/use-focus-trap.test.ts
git commit -m "refactor(a11y): focus trap joins the stack only when it can act"
```

---

### Task 7: The three surfaces that never participated

**Files:**
- Modify: `src/app/help-menu.tsx` (the Escape effect, ~lines 58-67)
- Modify: `src/app/raci-chip-picker.tsx` (the combined effect, ~lines 42-64)
- Modify: `src/app/tour-overlay.tsx` (the Escape+focus effect, ~lines 54-61)

All three close their own surface *and* the modal behind them today. `tour-overlay` already calls `preventDefault` and it does nothing, which is the proof that the mark alone was never enough — `Modal` had already acted.

- [ ] **Step 1: `help-menu.tsx`**

Add to imports:

```ts
import { claimsWhenFocusWithin, useDismissable } from "./use-dismissable";
```

Replace the effect:

```tsx
  // Escape closes the panel — but only while focus is inside it, or nowhere.
  // Same shape as `notes-window`: a persistent draggable panel that stays open
  // while the user works elsewhere must not answer an Escape aimed at the
  // dialog they are actually typing in.
  useDismissable({
    open,
    kind: "layer",
    onDismiss: () => setOpen(false),
    claims: claimsWhenFocusWithin(panelRef),
  });
```

Delete the `useEffect` import if nothing else in the file uses it — CI runs `--max-warnings=0` with no `argsIgnorePattern`, so an unused import is FATAL.

- [ ] **Step 2: `raci-chip-picker.tsx`**

Add to imports:

```ts
import { useDismissable } from "./use-dismissable";
```

Add above the existing effect:

```tsx
  useDismissable({ open, kind: "layer", onDismiss: () => setOpen(false) });
```

This one takes no `claims`: it is a transient anchored popover that already closes on scroll, so it is never a persistent floating surface.

Then delete these three lines from the effect body and both listener lines:

```ts
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
```

```ts
    document.addEventListener("keydown", onKeyDown);
```

```ts
      document.removeEventListener("keydown", onKeyDown);
```

- [ ] **Step 3: `tour-overlay.tsx`**

Add to imports:

```ts
import { useDismissable } from "./use-dismissable";
```

Replace the Escape effect with a stack registration plus a focus-only effect. The focus-per-step behaviour must survive — it is keyed on the step index:

```tsx
  // The overlay is a role=dialog aria-modal surface, so it registers as a
  // modal. Gated on a real step: it renders null without one, and an entry
  // that claims Escape while showing nothing would swallow the key.
  useDismissable({ open: step !== undefined, kind: "modal", onDismiss: onSkip });

  useEffect(() => {
    cardRef.current?.focus();
  }, [i]);
```

- [ ] **Step 4: Run the affected suites**

```bash
npx vitest run src/app/tour-overlay.test.tsx src/app/help-menu.test.tsx src/app/raci-chip-picker.test.tsx
```

Expected: PASS for whichever of these exist. If `help-menu.test.tsx` or `raci-chip-picker.test.tsx` does not exist, do not create one here — Task 8 covers the behaviour that matters across surfaces.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/help-menu.tsx src/app/raci-chip-picker.tsx src/app/tour-overlay.tsx
git commit -m "fix(a11y): help panel, RACI picker and tour overlay stop closing the dialog behind them"
```

---

### Task 8: The cross-surface integration cases

**Files:**
- Create: `src/app/dismissal-integration.test.tsx`

Four cases, each a bug that exists or would exist. Case 2 is currently broken on `main` — it is the hazard the capture fix introduced.

- [ ] **Step 1: Write the tests**

Create `src/app/dismissal-integration.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDismissalStack } from "./dismissal-stack";
import { Modal } from "./modal";
import { claimsWhenFocusWithin, useDismissable } from "./use-dismissable";

function pressEscape(from: HTMLElement): KeyboardEvent {
  from.focus();
  const e = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  from.dispatchEvent(e);
  return e;
}

/** Stand-in for a document-level popover (PopoverPanel / usePopoverDismiss).
 *  jsdom reports every rect as zero so the real portal never positions itself,
 *  which is why these are hosted on the hook rather than the component. */
function Popover({ onClose, label }: { onClose: () => void; label: string }) {
  useDismissable({ open: true, kind: "layer", onDismiss: onClose });
  return <button type="button">{label}</button>;
}

/** Stand-in for a combobox picker: an ELEMENT-scoped React handler that marks
 *  the event, exactly as entity-link-picker and the four siblings do. It is
 *  deliberately NOT in the stack. */
function Combobox({ onDismiss }: { onDismiss: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <input
      aria-label="picker"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          setOpen(false);
          onDismiss();
        }
      }}
    />
  );
}

describe("Escape dismissal across surfaces", () => {
  beforeEach(() => resetDismissalStack());

  it("closes a popover inside a modal without closing the modal", () => {
    const closeModal = vi.fn();
    const closePopover = vi.fn();
    render(
      <Modal open onClose={closeModal} ariaLabel="Editor">
        <button type="button">field</button>
        <Popover onClose={closePopover} label="popover item" />
      </Modal>,
    );
    pressEscape(screen.getByRole("button", { name: "popover item" }));
    expect(closePopover).toHaveBeenCalledTimes(1);
    expect(closeModal).not.toHaveBeenCalled();
  });

  it("closes the modal on the second Escape, once the popover is gone", () => {
    const closeModal = vi.fn();
    function Harness() {
      const [popoverOpen, setPopoverOpen] = useState(true);
      return (
        <Modal open onClose={closeModal} ariaLabel="Editor">
          <button type="button">field</button>
          {popoverOpen && (
            <Popover onClose={() => setPopoverOpen(false)} label="popover item" />
          )}
        </Modal>
      );
    }
    render(<Harness />);
    pressEscape(screen.getByRole("button", { name: "popover item" }));
    expect(closeModal).not.toHaveBeenCalled();
    pressEscape(screen.getByRole("button", { name: "field" }));
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  it("closes only the dropdown when a combobox sits inside a popover", () => {
    // ★★ The hazard capture phase introduced: React delegates onKeyDown at
    // BUBBLE, so a capture-phase popover listener ran BEFORE the combobox's own
    // handler and took both layers down with one keypress.
    const closePopover = vi.fn();
    const closeDropdown = vi.fn();
    function Harness() {
      useDismissable({ open: true, kind: "layer", onDismiss: closePopover });
      return <Combobox onDismiss={closeDropdown} />;
    }
    render(<Harness />);
    pressEscape(screen.getByRole("textbox", { name: "picker" }));
    expect(closeDropdown).toHaveBeenCalledTimes(1);
    expect(closePopover).not.toHaveBeenCalled();
  });

  it("closes the modal when a floating panel above it declines", () => {
    // The claims walk. The panel is topmost but focus is in the modal, so it
    // declines — and the layer beneath must act. Without the walk, nobody would.
    const closeModal = vi.fn();
    const closePanel = vi.fn();
    function FloatingPanel({ onClose }: { onClose: () => void }) {
      const panelRef = useRef<HTMLDivElement | null>(null);
      useDismissable({
        open: true,
        kind: "layer",
        onDismiss: onClose,
        claims: claimsWhenFocusWithin(panelRef),
      });
      return (
        <div ref={panelRef}>
          <button type="button">note</button>
        </div>
      );
    }
    render(
      <>
        <Modal open onClose={closeModal} ariaLabel="Editor">
          <button type="button">field</button>
        </Modal>
        <FloatingPanel onClose={closePanel} />
      </>,
    );
    pressEscape(screen.getByRole("button", { name: "field" }));
    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(closePanel).not.toHaveBeenCalled();
  });

  it("closes the inner modal only, when modals nest", () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    render(
      <>
        <Modal open onClose={closeOuter} ariaLabel="Create project">
          <button type="button">outer field</button>
        </Modal>
        <Modal open onClose={closeInner} ariaLabel="Setup wizard">
          <button type="button">inner field</button>
        </Modal>
      </>,
    );
    pressEscape(screen.getByRole("button", { name: "inner field" }));
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them**

```bash
npx vitest run src/app/dismissal-integration.test.tsx
```

Expected: PASS, 5 tests.

- [ ] **Step 3: Prove case 3 was actually broken**

This is the case that justifies the whole change, so confirm it is not vacuous. In `use-dismissable.ts`, temporarily change the listener registration to capture:

```ts
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
```

Run the file again. "closes only the dropdown when a combobox sits inside a popover" must FAIL — the popover claims the key before React's delegation reaches the input. Restore the bubble registration and re-run.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/dismissal-integration.test.tsx
git commit -m "test(a11y): pin Escape ownership across modals, popovers and pickers"
```

---

### Task 9: Release 0.203.0

**Files:**
- Modify: `src/app/version.ts:5-8`, `src/app/version.ts:252` (end of `APP_HIGHLIGHT_KEYS`)
- Modify: `package.json` (`version`)
- Modify: `CHANGELOG.md` (new entry at the top, above `## [0.202.4]`)
- Modify: `src/app/i18n.ts` (EN string), `src/app/i18n.de.ts` (DE string)
- Modify: `AGENTS.md` (the Escape-protocol bullet)

- [ ] **Step 1: Bump the version**

`src/app/version.ts`:

```ts
export const APP_VERSION = "0.203.0";
export const APP_BUILD_DATE = "2026-07-27"; // 0.203.0: Escape dismissal stack (Beukes)
```

`package.json`: set `"version": "0.203.0"`.

- [ ] **Step 2: Add the highlight key**

Append to `APP_HIGHLIGHT_KEYS` in `src/app/version.ts`, after `"versionHighlight02023"`:

```ts
  "versionHighlight0203",
```

- [ ] **Step 3: Add the EN string**

In `src/app/i18n.ts`, beside `versionHighlight02023`:

```ts
  versionHighlight0203: "Accessibility: Escape now closes exactly one thing. Whatever you opened last is what closes — a dropdown inside a dialog closes the dropdown, not the dialog and your unsaved edit with it — and the help panel, the RACI picker and the guided tour no longer take the dialog behind them down as well. A floating panel only answers Escape when you are actually working in it.",
```

- [ ] **Step 4: Add the DE string**

★★ Do NOT use the Edit tool on `i18n.de.ts`. It corrupts umlauts, curls double quotes (which bites umlaut-free strings too), and the file is CRLF — a node replace whose anchor uses `\n` silently no-ops. Patch via a node utf8 write matching `\r\n`, then grep-verify. The `i18n-encoding` test BANS ASCII substitutes (`fuer`, `druecken`) and `\u00XX` escapes.

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");
const anchor = "  versionHighlight02023:";
if (!s.includes(anchor)) { console.error("anchor missing"); process.exit(1); }
const line = "  versionHighlight0203: \"Barrierefreiheit: Escape schließt jetzt genau eine Sache. Was zuletzt geöffnet wurde, wird geschlossen — ein Auswahlfeld in einem Dialog schließt das Auswahlfeld, nicht den Dialog samt ungespeicherter Änderungen — und das Hilfefenster, die RACI-Auswahl und die geführte Tour reißen den dahinterliegenden Dialog nicht mehr mit. Ein schwebendes Fenster reagiert nur noch auf Escape, wenn darin gearbeitet wird.\",\r\n";
fs.writeFileSync(p, s.replace(anchor, line + anchor), "utf8");
'
grep -c "versionHighlight0203" src/app/i18n.de.ts
```

Expected: `1`.

- [ ] **Step 5: Verify the i18n gates**

```bash
npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts
```

Expected: both pass. `tsc` enforces EN/DE key parity; the encoding test enforces real umlauts.

Then confirm no mojibake landed:

```bash
node -e 'const s=require("fs").readFileSync("src/app/i18n.de.ts","utf8");const m=s.match(/.*versionHighlight0203.*/);console.log(m&&m[0]);'
```

Expected: the line prints with `schließt`, `geöffnet`, `Änderungen`, `reißen` intact — no `?`, no `Ã`, no `\u00`.

- [ ] **Step 6: Add the CHANGELOG entry**

Insert above `## [0.202.4] - 2026-07-27 "Beukes"`:

```markdown
## [0.203.0] - 2026-07-27 "Beukes"

Escape now closes exactly one thing, decided by what you opened last rather
than by which listener happened to register first.

- **Whatever you opened last is what Escape closes.** 0.202.3 and 0.202.4 fixed
  this case by case; the rule is now explicit and applies everywhere. A
  dropdown inside a dialog closes the dropdown. A menu inside a dialog closes
  the menu. The dialog — and whatever you had typed into it — stays.
- **The help panel, the RACI picker and the guided tour join in.** All three
  still took the dialog behind them down. The tour overlay had even been
  marking the key as handled, which achieved nothing, because the dialog had
  already closed by the time it did.
- **A floating panel only answers Escape when you are working in it.** The
  notes window already behaved this way; the help panel now does too. Opening
  help, then a task editor, then pressing Escape while typing no longer closes
  help and leaves the editor up.
- Fixes a case introduced by 0.202.4: a picker inside a menu lost both its
  dropdown and the menu to a single keypress.

Internally this replaces listener-phase ordering with an explicit stack of open
layers. Escape goes to the topmost layer that claims it; keyboard focus
containment in dialogs asks a separate question, so a menu floating above a
dialog can never let Tab escape it.
```

- [ ] **Step 7: Rewrite the AGENTS.md Escape-protocol bullet**

The current bullet (`★★★ ESCAPE PROTOCOL — preventDefault marks it consumed`) documents capture phase as load-bearing, and this release removes that. Replace it with a block that:

- Leads with the stack as the arbiter: `dismissal-stack.ts` + `use-dismissable.ts`, `escapeOwner()` for Escape, `isTopmostOfKind(token,"modal")` for Tab.
- Keeps `preventDefault` / `defaultPrevented` as the boundary with element-scoped handlers, and keeps the note that `stopPropagation` cannot do this job (React 19 delegates on `document`, the node `Modal` listens on).
- Records the open-order precondition verbatim from the spec, including why it is asserted rather than detected (portals).
- Records the three load-bearing rules: `[open]`-only deps, `claims()` read at event time, register only when you can act.
- Records who is deliberately OUT: `global-search-box`, the five combobox pickers, `chat-panel` — and corrects the standing error that `global-search-box` closes from a document listener. It does not; its document listener is the ⌘K shortcut.
- Deletes the capture-phase guidance entirely, including "a DOCUMENT-level closer must register at CAPTURE, not bubble" and the "STILL NOT PARTICIPATING" list, which is now empty for document-level closers.
- Keeps the TEST-TOPOLOGY TRAP paragraph unchanged — all three traps still apply.

- [ ] **Step 8: Commit**

```bash
git add src/app/version.ts package.json CHANGELOG.md src/app/i18n.ts src/app/i18n.de.ts AGENTS.md
git commit -m "release: 0.203.0 — Escape closes exactly one thing"
```

---

### Task 10: Full gate run

**Files:** none — verification only.

- [ ] **Step 1: Every blocking gate, in CI order**

```bash
npm run lint
npx tsc --noEmit
npm run test:coverage
npm run dup:check
npm run size:check
npm run build
```

Expected: all exit 0. Coverage floors are blocking (global lines 92 / funcs 91 / branch 80 / stmts 89) and `test:run` does not enforce them, so `test:coverage` is the one that counts. `dup:check` should improve — eight hand-rolled listener blocks became one hook.

- [ ] **Step 2: axe, on a fresh isolated server**

```bash
PORT=3100 npm run dev
```

In another shell:

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium
PORT=3100 npm run stop
```

Expected: 85 checks pass (5 schemes × 16 views + 5 Kanban variants).

★★ A fresh port matters: Playwright's `reuseExistingServer` will attach to a stale `:3000` whose Tailwind has not regenerated, producing phantom failures that a prod build passes. Nothing here touches `globals.css`, so this is a precaution rather than a likely failure — but a stale server has cost about five debug cycles before.

- [ ] **Step 3: Manual keyboard check**

axe has no rule for Escape ownership, so the gate is silent on regressions here. Walk these by hand in the dev server:

1. Open a task, open the ⚙ field-visibility menu, press Escape → menu closes, editor stays, edits intact.
2. In the same editor, open the assignee picker, press Escape → dropdown closes, editor stays.
3. Open the notes window from a row badge, open the task editor, type, press Escape → editor closes, notes stays.
4. Open the help panel, open a task editor, press Escape → editor closes, help stays.
5. Open a RACI picker in the stakeholder matrix, press Escape → picker closes, the matrix's dialog stays.
6. In any open dialog, Tab past the last control → focus wraps to the first, and does so with a menu open on top.

- [ ] **Step 4: Push**

```bash
git push -u origin feature/dismissal-stack
```

Do not open the MR or merge without an explicit instruction.

---

## Self-review

**Spec coverage.** Every spec section maps to a task: pure module → 1; hook and `claimsWhenFocusWithin` → 2; the two-kinds question → 3; the migration table's eight rows → 3, 4, 5, 6, 7; the four integration cases → 8 (plus the second-Escape case, which the spec implies and the plan makes explicit as a fifth); the three load-bearing rules → enforced by mutation checks in 1, 2 and by the `hasEscape` boolean in 6; release → 9; risk mitigation (18 inherited call sites, WCAG 2.4.3) → full suite in Task 4 Step 4, Tab test in Task 3, manual check 6 in Task 10.

**Placeholders.** None. Task 7 Step 4 and Task 6 Step 4 name test files that may not exist and say exactly what to do in that case rather than leaving it open.

**Type consistency.** `DismissalKind`, `pushDismissal`, `popDismissal`, `isTopmostOfKind`, `escapeOwner`, `claimsEscape`, `resetDismissalStack`, `useDismissable`, `DismissableOptions`, `claimsWhenFocusWithin` are used with identical names and signatures in every task that references them. `pushDismissal(token, kind, claims?)` is called with two arguments by `Modal` and `use-focus-trap` (no predicate) and three by the hook — matching the optional third parameter.

**One known soft spot.** Task 6 Step 2 cannot make its test fail on a clean first run, because a module that never registers and a module that registers correctly are indistinguishable from the outside. The step says so and gives the temporary unconditional push as the way to prove the guard. Do not skip it.
