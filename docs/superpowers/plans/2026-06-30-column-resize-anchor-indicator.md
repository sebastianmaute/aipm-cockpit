# Stronger Resize-Anchor Indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the column-resize anchor discoverable at rest (always-visible ⋮ grip with hover/drag accent) and strengthen the pane/window resize-corner grip — within the AIPM palette + dual-CI constraints.

**Architecture:** Two files, no call-site changes. (1) Rewrite the single shared `ColumnResizeHandle` (`src/app/task-manager-ui.tsx`) to render an always-visible 3-dot grip that brightens to the table-head accent on hover and during drag — drag-time accent comes free from CSS `:active`, which holds from mousedown to mouseup even after the pointer leaves the element, so no React drag state and no change to `useColumnResize`. (2) Add a `::-webkit-resizer` rule to `globals.css` so every native `resize` corner (panes + resize-textareas) gets an accent-tinted, clearly visible grip.

**Tech Stack:** React + TypeScript, Tailwind v4 (AIPM role tokens in `globals.css`), Vitest + Testing Library, Playwright axe gate. CI: GitLab (lint `--max-warnings=0`, tsc, unit, build, e2e).

**Spec:** `docs/superpowers/specs/2026-06-30-column-resize-anchor-indicator-design.md`

---

## Reference: current code

`src/app/task-manager-ui.tsx:179-194` — the component to replace:

```tsx
/** Drag handle on the right edge of a <th>. Host th MUST be `relative`. */
export function ColumnResizeHandle({
  col,
  onMouseDown,
}: {
  col: string;
  onMouseDown: (col: string, e: React.MouseEvent) => void;
}) {
  return (
    <div
      aria-hidden="true"
      onMouseDown={(e) => onMouseDown(col, e)}
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-white/30 print:hidden"
    />
  );
}
```

Tokens available as Tailwind utilities (registered in `globals.css` `@theme inline`):
`text-table-head-fg`, `text-table-head-accent`, `bg-table-head-accent` — each dual-CI
(AIPM + Mockup) and dark-mode aware. The opacity modifier (`/40`, `/10`) is valid on these
theme colors. **Do not** use `var(--table-head-*)` arbitrary form with a slash modifier — use
the theme utilities so the alpha is generated correctly.

---

## Task 1: Always-visible column grip

**Files:**
- Modify: `src/app/task-manager-ui.tsx:179-194` (the `ColumnResizeHandle` function)
- Test: `src/app/task-manager-ui.test.tsx` (add a `describe("ColumnResizeHandle", …)` block)

- [ ] **Step 1: Write the failing tests**

Add this import line at the top of `src/app/task-manager-ui.test.tsx` — change line 2-4 imports
to include `fireEvent` and `ColumnResizeHandle`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortableTh, PrintButton, ResetSizeButton, ColumnResizeHandle } from "./task-manager-ui";
```

Append this block to the end of the file:

```tsx
describe("ColumnResizeHandle", () => {
  function renderHandle(onMouseDown = vi.fn()) {
    const result = render(
      <table><thead><tr><th>
        <ColumnResizeHandle col="title" onMouseDown={onMouseDown} />
      </th></tr></thead></table>,
    );
    const handle = result.container.querySelector(".cursor-col-resize") as HTMLElement;
    return { handle, onMouseDown };
  }

  it("renders an always-visible grip (an aria-hidden svg with dots)", () => {
    const { handle } = renderHandle();
    expect(handle).toBeTruthy();
    const svg = handle.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg!.querySelectorAll("circle").length).toBe(3);
  });

  it("is decorative and 6px wide with the col-resize cursor", () => {
    const { handle } = renderHandle();
    expect(handle).toHaveAttribute("aria-hidden", "true");
    expect(handle.className).toContain("w-1.5");
    expect(handle.className).toContain("cursor-col-resize");
    expect(handle.className).toContain("print:hidden");
  });

  it("uses palette tokens for rest + hover/drag accent, not off-palette white", () => {
    const { handle } = renderHandle();
    expect(handle.className).toContain("text-table-head-fg/40");
    expect(handle.className).toContain("hover:text-table-head-accent");
    expect(handle.className).toContain("active:text-table-head-accent");
    expect(handle.className).not.toContain("bg-white/30");
  });

  it("invokes onMouseDown with the column id", () => {
    const { handle, onMouseDown } = renderHandle();
    fireEvent.mouseDown(handle);
    expect(onMouseDown).toHaveBeenCalledTimes(1);
    expect(onMouseDown.mock.calls[0][0]).toBe("title");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/task-manager-ui.test.tsx`
Expected: the four new `ColumnResizeHandle` tests FAIL — `ColumnResizeHandle` is not exported in the test's import yet returns the old markup (no `svg`, no `w-1.5`, still has `bg-white/30`). Specifically the grip/`w-1.5`/token assertions fail.

- [ ] **Step 3: Implement the new handle**

Replace `src/app/task-manager-ui.tsx:179-194` (the whole `ColumnResizeHandle` function) with:

```tsx
/** Drag handle on the right edge of a <th>. Host th MUST be `relative`.
 *  Always-visible ⋮ grip so the resize anchor is discoverable at rest; it
 *  brightens to the table-head accent on hover and during the drag. (CSS
 *  `:active` holds from mousedown to mouseup even after the pointer leaves
 *  the element, so the drag-time accent needs no React state.) Decorative —
 *  resize is a mouse enhancement; columns stay usable and ResetColWidths exists. */
export function ColumnResizeHandle({
  col,
  onMouseDown,
}: {
  col: string;
  onMouseDown: (col: string, e: React.MouseEvent) => void;
}) {
  return (
    <div
      aria-hidden="true"
      onMouseDown={(e) => onMouseDown(col, e)}
      className="absolute right-0 top-0 flex h-full w-1.5 cursor-col-resize select-none items-center justify-center text-table-head-fg/40 transition-colors hover:bg-table-head-accent/10 hover:text-table-head-accent active:text-table-head-accent print:hidden"
    >
      <svg viewBox="0 0 2 12" width="2" height="12" fill="currentColor" aria-hidden="true">
        <circle cx="1" cy="2" r="1" />
        <circle cx="1" cy="6" r="1" />
        <circle cx="1" cy="10" r="1" />
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/task-manager-ui.test.tsx`
Expected: PASS (all `ColumnResizeHandle` tests plus the pre-existing `SortableTh`/`PrintButton`/`ResetSizeButton` tests).

- [ ] **Step 5: Typecheck + lint the touched files**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: clean (0 warnings — CI uses `--max-warnings=0`; an unused import is fatal, so confirm `fireEvent`/`ColumnResizeHandle` are both used).

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager-ui.tsx src/app/task-manager-ui.test.tsx
git commit -m "feat(resize): always-visible grip on column-resize handles"
```

---

## Task 2: Strengthen the native pane/textarea resize corner

**Files:**
- Modify: `src/app/globals.css` (append one top-level rule near the existing `.lop-thead th` element rules, ~line 173)

CSS pseudo-elements aren't unit-testable in jsdom, so this task verifies via the palette-sweep
guard (must stay green — the rule introduces no shadow/gradient), the build, and eye-verification.

- [ ] **Step 1: Add the `::-webkit-resizer` rule**

Append to `src/app/globals.css` (after the existing `.lop-thead th { … }` block):

```css
/* Strengthen the native resize-corner grip (panes via useResizable + any
   resize:both textarea). Solid accent corner — palette-safe (no shadow/gradient),
   Chromium/WebKit only; other engines keep their native grip. */
::-webkit-resizer {
  background-color: var(--table-head-accent);
}
```

- [ ] **Step 2: Verify the palette-sweep guard + unit suite still pass**

Run: `npm run test:run`
Expected: PASS — including the palette/chrome sweep test (the new rule contains no
`box-shadow`/`drop-shadow`/`bg-gradient-`/off-palette hex; it references the existing
`--table-head-accent` token).

- [ ] **Step 3: Verify the app builds (globals.css compiles)**

Run: `npm run build`
Expected: build succeeds (a malformed Tailwind/CSS rule would 500 the app / fail compile; a
clean build confirms `globals.css` still compiles).

- [ ] **Step 4: Eye-verify the corner in a dev server**

Run: `npm run dev`, open a resizable pane view (e.g. Steering Committee, Portfolio Health, or
any `useResizable` pane) and grab the bottom-right corner.
Expected: the corner grip is clearly accent-tinted and easy to spot in AIPM-light, AIPM-dark, and
Mockup-light. If the green reads poorly on a light pane surface in any style, introduce a
dedicated `--resizer` token (define in `:root`, `:root[data-style="mockup"]`, and `.dark`,
mirroring the existing role-token pattern) and point the rule at `var(--resizer)` instead.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(resize): accent-tinted native resize-corner grip"
```

---

## Task 3: Eye-verify column grip + axe gate

**Files:** none (verification only)

- [ ] **Step 1: Eye-verify the column grip across styles**

With `npm run dev` running, open a table view (Open Points, Milestones, Changes, RAID, Reports).
Check:
- Resting: faint ⋮ dots visible on the right edge of each resizable header cell (not invisible, not loud).
- Hover: dots turn accent green + faint accent wash.
- Drag (press a grip, move the pointer away, keep button held): dots stay accent for the whole drag (CSS `:active`), and the column resizes live.
- Repeat in AIPM-light, AIPM-dark (`.dark`), and Mockup-light (Settings → Appearance → Style).

If the `:active` accent does NOT persist for the whole drag in any browser, apply the spec's
fallback: expose `activeCol` state from `useColumnResize` (`src/app/use-column-resize.ts` — set
in `startColResize`'s mousedown, clear in `onUp`) and add an `active?: boolean` prop to
`ColumnResizeHandle` that swaps in the accent class; thread `active={activeCol === col}` at each
call site. (Only if eye-verification shows `:active` is insufficient.)

- [ ] **Step 2: Run the axe gate on the touched table views**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"`
Expected: PASS (the grip is `aria-hidden` / decorative — no new accessible-name or keyboard
obligation). The full gate (`npx playwright test e2e/a11y.spec.ts --project=chromium`) runs all
13 views × 3 styles; run it if time allows to confirm no regression anywhere.

- [ ] **Step 3: Final full check**

Run: `npx tsc --noEmit && npm run lint && npm run test:run`
Expected: all green.

---

## Notes for the implementer

- **Do not** change any of the ~14 panels that call `ColumnResizeHandle` (activity-log, budget,
  budget-report, change, change-report, milestones, raid, raid-report, etc.) — the component's
  props are unchanged, so all call sites keep working.
- **Do not** change `useColumnResize` or `useResizable` unless Task 3 Step 1's fallback is needed.
- Keep the handle `aria-hidden` — surfacing it to assistive tech would create a keyboard/label
  obligation (axe-critical) for a control that is a pure mouse enhancement.
- Releasing is a separate, explicitly-authorized step (version bump + CHANGELOG + highlight key) —
  NOT part of this plan. Stop after Task 3.
