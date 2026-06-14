# UI Batch (Trends · Action chips · Manage-Roles · RACI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** 5 independent UI items (A–E) + the action-chip "open the entry" wiring.

**Spec:** `docs/superpowers/specs/2026-06-14-ui-batch-trends-raci.md`

**Pinned facts:**
- `useColumnResize<TId extends string>(...)` (`use-column-resize.ts:8`); `ColumnResizeHandle` (`task-manager-ui.tsx:179`). Mirror `tasks-section.tsx` / `resources-panel.tsx` for usage (state `colWidths`, `<th style={{width}}>`, `<ColumnResizeHandle col=… onMouseDown=startResize/>`).
- pendingOpen deep-link pattern = `raid-panel.tsx:255-266`: `const {pendingOpen, clearPendingOpen} = useWorkspaceTab(); useEffect(()=>{ if(pendingOpen?.view!=="<v>")return; open the item by id if found & not already editing; clearPendingOpen(); }, [...])` with the `// eslint-disable-next-line react-hooks/set-state-in-effect` comment.
- Editors: tasks → `openEditModal(task)` in `task-manager.tsx:881/918` (task-manager owns it + `useWorkspaceTab`); change → `openEdit(item)` `change-panel.tsx:174` (`draft` state); milestone → `setEditing(m)` `milestones-panel.tsx:60`; stakeholder → read `stakeholders-panel.tsx` for its open-edit fn.
- `INNER_TABLE_CLASS`/`VIEW_PANE_CLASS`/`VIEW_PANE_RESIZABLE_CLASS`/`CENTERED_HALF_PANE_CLASS` in `view-styles.ts`. `InfoTooltip` in `info-tooltip.tsx`. RACI picker `raci-chip-picker.tsx`.
- Conventions: `npx vitest run <p>`, `npx tsc --noEmit`, `npx eslint <f> --max-warnings=0`. i18n EN/DE parity + real umlauts. Providers/components stay i18n-free where applicable.

---

## Task 1: i18n keys

**Files:** `i18n.ts`, `i18n.de.ts`.

- [ ] Add EN (after the `actionChips*`/`actionSourceWorkload` blocks):
```ts
  // --- RACI chip picker (0.81.0) ---
  raciSetLabel: "Set RACI",
  raciClear: "Clear",
  versionHighlightUiBatch: "Resizable Trends columns; action chips explain why and open the item; clearer Manage-Roles tooltips; a compact RACI picker",
```
- [ ] DE (real umlauts):
```ts
  // --- RACI-Chip-Auswahl (0.81.0) ---
  raciSetLabel: "RACI setzen",
  raciClear: "Löschen",
  versionHighlightUiBatch: "Größenveränderbare Trends-Spalten; Aktionschips erklären den Grund und öffnen den Eintrag; klarere Manage-Roles-Tooltips; eine kompakte RACI-Auswahl",
```
- [ ] `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts src/app/i18n.test.ts` → PASS (umlauts: `Löschen`, `Größen`). Commit `feat: i18n keys for the UI batch (EN/DE)`.

---

## Task 2: InfoTooltip — normal-case + portal (item C)

**Files:** `info-tooltip.tsx` (+ `info-tooltip.test.tsx` if absent).

Goal: the bubble must (a) render `normal-case` (it inherits `uppercase` from dark `th`), and (b) escape `overflow-hidden` clipping (portal to `document.body`).

- [ ] Rewrite the bubble to a portal positioned from the trigger rect, shown on hover/focus via local state. Replace the component body with:
```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface InfoTooltipProps {
  text: string;
  label?: string;
}

export function InfoTooltip({ text, label }: InfoTooltipProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left + r.width / 2 });
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (!text) return null;
  return (
    <span ref={ref} className="relative inline-flex items-center align-middle">
      <span
        role="button"
        tabIndex={0}
        aria-label={label ?? text}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).focus(); }}
        onKeyDown={(e) => { if (e.key === "Escape") (e.currentTarget as HTMLElement).blur(); }}
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-semibold leading-none normal-case text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      >
        i
      </span>
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <span
            role="tooltip"
            style={{ top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
            className="pointer-events-none fixed z-[100] w-max max-w-[16rem] rounded-md border border-line bg-surface px-2 py-1 text-xs font-normal normal-case text-foreground shadow-md"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
```
(Keeps the focusable `role=button` trigger + aria-label + Escape; the bubble is now `fixed`-positioned in a body portal → no clip. `normal-case` on both spans defeats the inherited `uppercase`.)
- [ ] Test (`info-tooltip.test.tsx`): renders the `i` trigger with the aria-label; focusing/hovering shows the bubble with the text and a `normal-case` class; empty `text` → renders nothing. (jsdom: portal renders into document.body — query via `screen`/`document.body`.)
- [ ] tsc + eslint + test green. Commit `fix(a11y/ui): InfoTooltip normal-case + portal (escapes table-border clip)`.

---

## Task 3: Manage-Roles pane height (item D)

**Files:** `view-styles.ts`, the manage-roles render (find via `git grep -n "CENTERED_HALF_PANE_CLASS\|manage-roles\|RolesEditor" src/app/*.tsx`).

- [ ] Add a fit-height variant in `view-styles.ts`:
```ts
/** Centered, half-width pane that grows with its content but never exceeds the
 *  viewport (then its body scrolls). Used by Manage Roles. */
export const CENTERED_FIT_PANE_CLASS =
  "relative mx-auto flex w-[50%] min-w-[420px] max-h-[calc(100vh-7rem)] min-h-[280px] flex-col overflow-hidden rounded-xl border border-line bg-surface p-6";
```
- [ ] In the Manage-Roles render (the `manage-roles` slot in `workspace-section.tsx` and/or `RolesEditor`/`RolesPanel`), swap `CENTERED_HALF_PANE_CLASS` → `CENTERED_FIT_PANE_CLASS`. Ensure the inner table body has `overflow-y-auto` so when content exceeds the cap, the table scrolls (not the pane). Verify the rate-card no longer leaves a big empty half-screen when short, and is scroll-capped when long.
- [ ] tsc + eslint + run any roles tests. Commit `fix(ui): Manage Roles pane fits content, capped at viewport`.

---

## Task 4: Trends resizable columns + rounded (item A)

**Files:** `trends-panel.tsx`.

- [ ] Give the trends pane the tasks rounded/clip look: ensure the pane wrapper uses `rounded-xl … overflow-hidden` (it already uses `VIEW_PANE_CLASS` rounded; add `overflow-hidden` so the dark `TABLE_HEAD_CLASS` corners clip — or wrap each table so its header clips). Keep the existing scroll.
- [ ] Add resizable columns to BOTH tables (KPI table: KPI/baseline/current/delta; snapshot table: capturedAt/trigger/baseline/actions). Mirror `resources-panel.tsx` (or `tasks-section.tsx`) usage of `useColumnResize` + `ColumnResizeHandle`:
  - one `useColumnResize` per table with stable string col ids and sensible default widths;
  - each `<th>` gets `style={{ width: colWidths[id], minWidth: … }}` + a trailing `<ColumnResizeHandle col={id} onMouseDown={startResize} />` (read `ColumnResizeHandle`'s real prop names at `task-manager-ui.tsx:179` and `startColResize`/`resetColWidths` from the hook).
- [ ] tsc + eslint + (trends test if any) green. Manual: columns drag-resize; headers round at the pane corners. Commit `feat(ui): resizable Trends columns + rounded table style`.

---

## Task 5: Action-chip why-tooltip (item B1)

**Files:** `action-chips.tsx` (+ test).

- [ ] On each chip `<button>` add a native tooltip with the action's *why*:
```tsx
title={t(lang, action.why.key, ...(action.why.params ?? []))}
```
(`SuggestedAction.why` is `{key, params?}` — already on every action.)
- [ ] Append a test to `action-chips.test.tsx`: a rendered chip's `title` contains the resolved `why` text. tsc + eslint + test green. Commit `feat(ui): action chips show a why-tooltip`.

---

## Task 6: Chips open the entry — pendingOpen editor effects (item B2)

**Files:** `task-manager.tsx` (tasks), `change-panel.tsx`, `milestones-panel.tsx`, `stakeholders-panel.tsx`.

For EACH, add the raid-panel deep-link effect (read `raid-panel.tsx:255-266` first). Each opens the matching editor when `pendingOpen.view` matches, then `clearPendingOpen()`:

- [ ] **tasks** — in `task-manager.tsx` (it has `useWorkspaceTab` + `openEditModal`):
```tsx
useEffect(() => {
  if (pendingOpen?.view !== "open-points") return;
  const task = tasks.find((t) => t.id === pendingOpen.id);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-way deep-link opens the edit modal on transition
  if (task) openEditModal(task);
  clearPendingOpen();
}, [pendingOpen, tasks, openEditModal, clearPendingOpen]);
```
(`clearPendingOpen` is on `useWorkspaceTab()` — add it to the destructure at `task-manager.tsx:140`. Confirm `openEditModal` + `tasks` are in scope at the effect site.)
- [ ] **change-panel.tsx** — add `const {pendingOpen, clearPendingOpen} = useWorkspaceTab();` + an effect: `if (pendingOpen?.view !== "changes" || pendingOpen.id === 0) return; const item = changes.find(c => c.id === pendingOpen.id); if (item && draft?.id !== item.id) openEdit(item); clearPendingOpen();`. (Skip id 0 — the change-pending aggregate CTA navigates only.)
- [ ] **milestones-panel.tsx** — effect: `if (pendingOpen?.view !== "milestones") return; const m = milestones.find(x => x.id === pendingOpen.id); if (m && editing?.id !== m.id) setEditing(m); clearPendingOpen();`.
- [ ] **stakeholders-panel.tsx** — READ its edit-open fn + state, then mirror: open the stakeholder by `pendingOpen.id` when `view === "stakeholders"`.
- [ ] Verify `npx tsc --noEmit && npx eslint src/app/task-manager.tsx src/app/change-panel.tsx src/app/milestones-panel.tsx src/app/stakeholders-panel.tsx --max-warnings=0` → clean. `npx vitest run src/app/change-panel.test.tsx src/app/milestones-panel.test.tsx` (if present). Manual: clicking a task/change/milestone/stakeholder chip opens its edit modal.
- [ ] Commit `feat(ui): action chips open the entity editor (tasks/changes/milestones/stakeholders)`.

---

## Task 7: RACI chip picker redesign (item E)

**Files:** `raci-chip-picker.tsx` (+ `raci-chip-picker.test.tsx`).

- [ ] Write the failing test first (`raci-chip-picker.test.tsx`):
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { RaciChipPicker } from "./raci-chip-picker";

describe("RaciChipPicker", () => {
  it("collapsed shows only the selected chip; clicking expands all + clear", () => {
    render(<RaciChipPicker value="A" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    // collapsed: the selected role's trigger is shown; expanded chips hidden until click
    fireEvent.click(screen.getByRole("button", { name: /RACI|A\b/i }));
    // after expand, all four roles + a clear control are present
    expect(screen.getByRole("button", { name: /clear/i })).toBeTruthy();
  });
  it("picking a role fires onChange and collapses", () => {
    const onChange = vi.fn();
    render(<RaciChipPicker value="" onChange={onChange} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { name: /set raci/i })); // placeholder trigger
    fireEvent.click(screen.getByRole("button", { name: "C" }));
    expect(onChange).toHaveBeenCalledWith("C");
  });
  it("clear fires onChange('')", () => {
    const onChange = vi.fn();
    render(<RaciChipPicker value="R" onChange={onChange} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { name: /R\b/i }));
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
```
(Adjust the trigger's accessible name to match the impl — e.g. the collapsed trigger labels itself `raciSetLabel` when empty, or the role letter when set.)
- [ ] Implement: collapsed trigger button (`aria-haspopup`, `aria-expanded`) showing only `value`'s chip (or `t(lang,"raciSetLabel")` placeholder when `""`). Local `open` state. When open, render a small popover `<span>` (absolute, `z-50`, plain buttons — NOT `role=menu`): the four `R/A/C/I` chips + a `✕`/`t(lang,"raciClear")` button. Each button `stopPropagation`; picking a role → `onChange(role)` + `setOpen(false)`; clear → `onChange("")` + close. Outside-click (a `useEffect` document `pointerdown` listener that closes when the click is outside the picker ref) + Escape close. Keep `RaciLegend` + the chip color map. Ensure the popover isn't clipped by the matrix cell — `position:absolute z-50` and verify; if clipped, portal it like InfoTooltip.
- [ ] Run the test → PASS. tsc + eslint clean. The a11y gate must stay green (no nested-interactive — the popover buttons are siblings, the trigger is a plain button).
- [ ] Commit `feat(ui): collapsible RACI chip picker (expand-all + clear + outside-click)`.

---

## Task 8: version + CHANGELOG + full sweep

**Files:** `version.ts`, `CHANGELOG.md`.

- [ ] `version.ts`: `APP_VERSION` → `"0.81.0"`; `APP_MILESTONE` `"Kress"` → **`"Wolfe"`** (Gene Wolfe — unused; verify it's not already in CHANGELOG, pick another unused sci-fi author if so); build-date comment `// 0.81.0 Trends/chips/Manage-Roles/RACI UI batch`; append `"versionHighlightUiBatch"` to `APP_HIGHLIGHT_KEYS`. Update the `0.81.x line is "Wolfe"` doc comment.
- [ ] `CHANGELOG.md` above `## [0.80.2]`:
```markdown
## [0.81.0] - 2026-06-14 "Wolfe"

### Added / Changed
- Trends tables now have resizable columns and match the rounded table style.
- Suggested-action chips show a tooltip explaining why each is flagged and open
  the relevant item (task / RAID / change / milestone / stakeholder) when clicked.
- The RACI picker is now compact: it shows the selected role and expands to all
  roles (plus clear) on click.

### Fixed
- Manage Roles tooltips read in normal case and are no longer clipped by the
  table border; the Manage Roles pane fits its content without exceeding the viewport.
```
- [ ] FULL sweep: `npx tsc --noEmit && npx vitest run && npx eslint src/app --max-warnings=0` → green. `npx playwright test e2e/a11y.spec.ts` → 12/12 (the new popovers must not add nested-interactive violations). Commit `docs: 0.81.0 — Trends/chips/Manage-Roles/RACI UI batch`.

---

## Final verification
- [ ] tsc/vitest/eslint green; a11y spec 12/12 green.
- [ ] Manual: Trends cols resize + rounded; action chip tooltip shows why + click opens editor (task/change/milestone/stakeholder) / navigates (budget/schedule/workload); Manage-Roles tooltips normal-case + not clipped + pane fits viewport; RACI collapses to selected, expands on click, clear works, outside-click closes.
- [ ] Use **superpowers:finishing-a-development-branch**.
