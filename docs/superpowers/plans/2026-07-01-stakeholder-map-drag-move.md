# Stakeholder Map Drag-to-move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag a stakeholder chip between quadrants of the Influence/Interest 2×2 matrix to rewrite its `influence`/`interest` attributes, reflected live in the stakeholders pane and edit modal.

**Architecture:** A pure `applyQuadrantMove(s, quadrant)` engine (preserve-Medium rule) in `stakeholders.ts`; native HTML5 DnD in `stakeholder-map-panel.tsx` gated on a new optional `onSaveStakeholder` prop; one-line wiring in `workspace-section.tsx` reusing the existing `handleSaveStakeholder` (functional updater + `localModifiedAt` stamp + `stakeholder.updated` activity log). No new persisted field.

**Tech Stack:** Next.js (forked) + React + TypeScript, Tailwind v4 AIPM tokens, Vitest + Testing Library.

**Reference:** `docs/superpowers/specs/2026-07-01-stakeholder-map-drag-move-design.md`

---

## Task 1: Pure `applyQuadrantMove` engine

**Files:**
- Modify: `src/app/stakeholders.ts` (add after `quadrantFor`, ~line 30)
- Test: `src/app/stakeholders.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/stakeholders.test.ts` (import `applyQuadrantMove`, `QUADRANT_TARGET` alongside the existing `stakeholders.ts` imports; reuse or add a `makeStakeholder` helper — see note below):

```ts
import { applyQuadrantMove } from "./stakeholders";
import type { Stakeholder } from "./types";

// Minimal builder — only the fields applyQuadrantMove reads/copies matter.
function mkStakeholder(over: Partial<Stakeholder> = {}): Stakeholder {
  return {
    id: 1,
    name: "S1",
    organization: "",
    category: "Sponsor",
    influence: "Low",
    interest: "Low",
    raci: {},
    stakeholderIds: [],
    ...over,
  } as Stakeholder;
}

describe("applyQuadrantMove", () => {
  it("sets both axes High for manage-closely", () => {
    const moved = applyQuadrantMove(mkStakeholder(), "manage-closely");
    expect(moved).not.toBeNull();
    expect(moved!.influence).toBe("High");
    expect(moved!.interest).toBe("High");
  });

  it("keep-satisfied: High influence, interest untouched when already low-band", () => {
    const moved = applyQuadrantMove(mkStakeholder({ interest: "Medium" }), "keep-satisfied");
    expect(moved!.influence).toBe("High");
    expect(moved!.interest).toBe("Medium"); // preserved, not flattened to Low
  });

  it("demotes High to Medium when dragged out of the high band", () => {
    const moved = applyQuadrantMove(
      mkStakeholder({ influence: "High", interest: "High" }),
      "monitor",
    );
    expect(moved!.influence).toBe("Medium");
    expect(moved!.interest).toBe("Medium");
  });

  it("returns null on a no-op drop (same quadrant, nothing to demote)", () => {
    expect(applyQuadrantMove(mkStakeholder({ influence: "Medium", interest: "Low" }), "monitor")).toBeNull();
  });

  it("round-trip is not identity (Low -> keep-satisfied -> monitor yields Medium)", () => {
    const up = applyQuadrantMove(mkStakeholder({ influence: "Low", interest: "Low" }), "keep-satisfied");
    expect(up!.influence).toBe("High");
    const back = applyQuadrantMove(up!, "monitor");
    expect(back!.influence).toBe("Medium"); // documented preserve-Medium quirk
  });

  it("does not mutate the input", () => {
    const s = mkStakeholder({ influence: "Low", interest: "Low" });
    applyQuadrantMove(s, "manage-closely");
    expect(s.influence).toBe("Low");
    expect(s.interest).toBe("Low");
  });
});
```

Note: check the top of `stakeholders.test.ts` for an existing stakeholder factory; if one exists, use it (with overrides for `influence`/`interest`) instead of `mkStakeholder`, and drop the `category: "Sponsor"` guess in favour of whatever the existing factory uses. The `as Stakeholder` cast covers any fields omitted above; verify `Stakeholder`'s required fields in `types.ts` and extend the builder if tsc complains.

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run src/app/stakeholders.test.ts -t applyQuadrantMove`
Expected: FAIL — `applyQuadrantMove is not a function` (not yet exported).

- [ ] **Step 3: Implement the engine**

In `src/app/stakeholders.ts`, immediately after `quadrantFor` (after line 30), add. Confirm `InfluenceInterest` is already imported at the top (it is — line 4); no import change needed.

```ts
/** Which axes a quadrant asserts as High: [highInfluence, highInterest]. */
export const QUADRANT_TARGET: Record<StakeholderQuadrant, readonly [boolean, boolean]> = {
  "manage-closely": [true, true],
  "keep-satisfied": [true, false],
  "keep-informed": [false, true],
  monitor: [false, false],
};

/** Preserve-Medium: raise to "High" on the high side; on the low side demote a
 *  "High" to "Medium" but leave existing Medium/Low untouched. */
function axisTarget(current: InfluenceInterest, wantHigh: boolean): InfluenceInterest {
  if (wantHigh) return "High";
  return current === "High" ? "Medium" : current;
}

/** Apply a quadrant drop to a stakeholder. Returns a new Stakeholder, or null
 *  when nothing changes (no-op drop) so callers skip a spurious save. */
export function applyQuadrantMove(
  s: Stakeholder,
  quadrant: StakeholderQuadrant,
): Stakeholder | null {
  const [hi, ht] = QUADRANT_TARGET[quadrant];
  const influence = axisTarget(s.influence, hi);
  const interest = axisTarget(s.interest, ht);
  if (influence === s.influence && interest === s.interest) return null;
  return { ...s, influence, interest };
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run src/app/stakeholders.test.ts -t applyQuadrantMove`
Expected: PASS (all 6).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/stakeholders.ts src/app/stakeholders.test.ts
git commit -m "feat(stakeholders): pure applyQuadrantMove (preserve-Medium quadrant drop rule)"
```

---

## Task 2: Native DnD in the map panel

**Files:**
- Modify: `src/app/stakeholder-map-panel.tsx`
- Test: `src/app/stakeholder-map-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/stakeholder-map-panel.test.tsx`. Inspect the existing tests first for the render helper + how stakeholders are built; reuse them. The DnD test needs a `dataTransfer` stub because jsdom's `fireEvent.drop` does not populate one.

```ts
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { StakeholderMapPanel } from "./stakeholder-map-panel";

// Build two stakeholders; reuse the existing factory in this file if present.
const monitorStakeholder = /* influence:"Low", interest:"Low", id:1, name:"Alice" */;
const highStakeholder = /* influence:"High", interest:"High", id:2, name:"Bob" */;

function dt(id: string) {
  const store: Record<string, string> = { "text/plain": id };
  return { getData: (k: string) => store[k] ?? "", setData: vi.fn(), dropEffect: "", effectAllowed: "" };
}

describe("StakeholderMapPanel drag-to-move", () => {
  it("chips are draggable when onSaveStakeholder is provided", () => {
    render(
      <StakeholderMapPanel lang="en-US" stakeholders={[monitorStakeholder]} onSaveStakeholder={vi.fn()} />,
    );
    const chip = screen.getByText("Alice").closest("[draggable]");
    expect(chip).toHaveAttribute("draggable", "true");
  });

  it("chips are NOT draggable without onSaveStakeholder (read-only)", () => {
    render(<StakeholderMapPanel lang="en-US" stakeholders={[monitorStakeholder]} />);
    expect(screen.getByText("Alice").closest("[draggable]")).toBeNull();
  });

  it("dropping on a quadrant calls onSaveStakeholder with the moved stakeholder", () => {
    const onSave = vi.fn();
    render(
      <StakeholderMapPanel lang="en-US" stakeholders={[monitorStakeholder]} onSaveStakeholder={onSave} />,
    );
    const cell = screen.getByTestId("quadrant-manage-closely");
    fireEvent.drop(cell, { dataTransfer: dt("1") });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 1, influence: "High", interest: "High" });
  });

  it("a no-op drop (same quadrant) does not call onSaveStakeholder", () => {
    const onSave = vi.fn();
    render(
      <StakeholderMapPanel lang="en-US" stakeholders={[monitorStakeholder]} onSaveStakeholder={onSave} />,
    );
    fireEvent.drop(screen.getByTestId("quadrant-monitor"), { dataTransfer: dt("1") });
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

Fill the two `/* ... */` builders from the file's existing pattern (or inline objects `as Stakeholder`, matching Task 1's builder). `monitorStakeholder` must be Low/Low so a monitor drop is a genuine no-op.

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run src/app/stakeholder-map-panel.test.tsx -t "drag-to-move"`
Expected: FAIL — `onSaveStakeholder` prop unknown / chips not draggable / no drop handler.

- [ ] **Step 3: Add the prop + import the engine**

In `src/app/stakeholder-map-panel.tsx`:

Extend the import from `./stakeholders`:
```ts
import { quadrantFor, applyQuadrantMove, type StakeholderQuadrant } from "./stakeholders";
```

Add the prop to `StakeholderMapPanelProps`:
```ts
  /** Save an edited stakeholder (drag-to-move). Omit for read-only popouts —
   *  chips are then non-draggable and cells accept no drop. */
  onSaveStakeholder?: (s: Stakeholder) => void;
```

Destructure it in the component signature:
```ts
export function StakeholderMapPanel({ lang, stakeholders, onOpenStakeholder, onSaveStakeholder }: StakeholderMapPanelProps) {
```

- [ ] **Step 4: Add the drop handler + editable gate**

Inside the component body (after the `byQuadrant` memo, before `return`):

```ts
  const editable = !!onSaveStakeholder;

  function onDropInto(q: StakeholderQuadrant, e: React.DragEvent) {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain"));
    const s = stakeholders.find((x) => x.id === id);
    if (!s) return;
    const moved = applyQuadrantMove(s, q);
    if (moved) onSaveStakeholder?.(moved);
  }
```

Ensure `React` types are available for `React.DragEvent` — add `import type React from "react";` at the top if not already present (the file currently imports only `useMemo` from react; add the type import).

- [ ] **Step 5: Wire cells as drop targets**

On the quadrant cell `<div>` (the one with `data-testid={q.testId}`), add — only when `editable` — drag handlers and a highlight. Use local state for the hovered quadrant so the ring shows on drag-over:

```ts
  const [dragOverQ, setDragOverQ] = useState<StakeholderQuadrant | null>(null);
```
(add `useState` to the react import: `import { useMemo, useState } from "react";`)

Cell `<div>`:
```tsx
<div
  key={q.id}
  data-testid={q.testId}
  onDragOver={editable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } : undefined}
  onDragEnter={editable ? () => setDragOverQ(q.id) : undefined}
  onDragLeave={editable ? (e) => { if (e.currentTarget === e.target) setDragOverQ(null); } : undefined}
  onDrop={editable ? (e) => { onDropInto(q.id, e); setDragOverQ(null); } : undefined}
  className={`flex flex-col gap-1.5 overflow-auto rounded-lg border border-line p-3 ${q.tintClass} ${
    dragOverQ === q.id ? "ring-2 ring-AIPM-green" : ""
  }`}
>
```

- [ ] **Step 6: Make chips draggable**

On the existing chip `<button>` (the `onOpenStakeholder` branch), add when `editable`:
```tsx
draggable={editable || undefined}
onDragStart={editable ? (e) => {
  e.dataTransfer.setData("text/plain", String(s.id));
  e.dataTransfer.effectAllowed = "move";
} : undefined}
```
Leave the read-only `<span>` branch (no `onOpenStakeholder`) unchanged — it is never draggable. Note: a chip is only rendered as a `<button>` when `onOpenStakeholder` is set. If a caller passes `onSaveStakeholder` but not `onOpenStakeholder`, chips would be plain `<span>`s and thus not draggable. In practice both are passed together (see Task 3), but to be safe, the `draggable` chip must be a `<button>`; do NOT add drag to the `<span>` branch. The panel test in Step 1 passes `onSaveStakeholder` only — so also pass `onOpenStakeholder={vi.fn()}` in the "draggable" and "drop" tests, matching real usage. Update those two test renders accordingly.

- [ ] **Step 7: Run tests — verify they pass**

Run: `npx vitest run src/app/stakeholder-map-panel.test.tsx`
Expected: PASS (new + existing).

- [ ] **Step 8: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/app/stakeholder-map-panel.tsx --max-warnings=0`
Expected: exit 0 both. (Watch for unused `StakeholderQuadrant`/`useState` — all should be used.)

- [ ] **Step 9: Commit**

```bash
git add src/app/stakeholder-map-panel.tsx src/app/stakeholder-map-panel.test.tsx
git commit -m "feat(stakeholders): drag chips between influence/interest quadrants"
```

---

## Task 3: Wire the save handler in workspace-section

**Files:**
- Modify: `src/app/workspace-section.tsx` (the `<StakeholderMapPanel>` mount, ~line 712-716)

- [ ] **Step 1: Locate the mount**

Run: `grep -n "StakeholderMapPanel" src/app/workspace-section.tsx`
Read the JSX block (around line 712) to see the current props (`lang`, `stakeholders`, `onOpenStakeholder`) and how `isPopout` / `handleSaveStakeholder` are already in scope (both are — `handleSaveStakeholder` is destructured near line 114, `isPopout` is a prop).

- [ ] **Step 2: Add the prop**

Add to the `<StakeholderMapPanel …>` mount, mirroring the `!isPopout` gate the deep-link handler uses:
```tsx
onSaveStakeholder={isPopout ? undefined : handleSaveStakeholder}
```
Confirm the existing `onOpenStakeholder` on that mount already uses an `isPopout ? undefined : …` gate; match its exact style. If `onOpenStakeholder` is passed unconditionally there, still gate `onSaveStakeholder` on `!isPopout` (mutation must be popout-safe; `handleSaveStakeholder` is `guardEdit`-wrapped in task-manager, but gating here also removes the drag affordance).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Manual verification note (no automated e2e for this view)**

The stakeholder-map view is not in the axe gate and has no dedicated e2e. Verify by eye in `npm run dev`: open Stakeholders → Influence/Interest map, drag a chip into another quadrant, confirm (a) the chip moves, (b) opening that stakeholder's editor shows the updated influence/interest, (c) the stakeholders pane row reflects it, (d) the drop-target highlight is the green ring only (no off-palette colour). Popouts: confirm chips are not draggable.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-section.tsx
git commit -m "feat(stakeholders): wire map drag-to-move save handler (popout-gated)"
```

---

## Task 4: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Lint**

Run: `npx eslint src/app/stakeholders.ts src/app/stakeholder-map-panel.tsx src/app/workspace-section.tsx --max-warnings=0`
Expected: exit 0 (a `--max-warnings=0` unused import/var is FATAL in CI).

- [ ] **Step 3: Unit tests (affected)**

Run: `npx vitest run src/app/stakeholders.test.ts src/app/stakeholder-map-panel.test.tsx`
Expected: all PASS.

- [ ] **Step 4: Confirm no persisted-field / codec drift**

No new `Workspace` field was added → no CSV/MD/Turso/IndexedDB/JSON write-path or golden-fixture change is expected. Confirm `git status` shows only `stakeholders.ts(.test.ts)`, `stakeholder-map-panel.tsx(.test.tsx)`, `workspace-section.tsx`, and the two docs files — nothing under `__fixtures__/` or the codec modules.
