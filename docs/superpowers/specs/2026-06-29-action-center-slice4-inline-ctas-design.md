# Action Center Roadmap — Slice 4: Inline CTAs — Design

**Date:** 2026-06-29
**Status:** Approved (design)
**Roadmap position:** Slice 4 of 4 (Ranking/noise ✓ → Layout ✓ → New providers ✓ → **Inline CTAs**)
**Branch:** `feat-action-center-slice4` (off `feat-action-center-slice3`; stacks 1+2+3+4)

## Problem

The Action Center surfaces problems but the fix means leaving for the entity editor. Slice 4 adds four one-click/inline resolutions so the user resolves common signals in place.

## Goals

Four inline resolutions, gated to the rows where they apply, mutating the workspace via the established bundle pattern (built in `task-manager`, popout→`undefined`, threaded to `ActionRow`):
1. **Assign owner** — on unassigned tasks (extend the existing RAID-only assign).
2. **Mark done** — complete a task.
3. **Clear blocker** — clear a task's `blockers`.
4. **Reschedule** — push a task's due date (new popover).

## Non-Goals

- No group-aware CTA gating: CTAs gate off the row's PRIMARY action (slice-1 grouping shows the primary). On a collapsed row only the primary signal's specific CTA shows; **Mark done is the exception — task-level (any `open-points` cta)**. Documented limitation; Open is always available. (A group-aware pass is a possible future enhancement.)
- No confirm dialog on Mark done / Clear blocker — both reversible (reopen / re-enter) and popout-disabled. (Destructive-irreversible actions would need confirm; these aren't.)
- No bulk apply, no new persisted Workspace field — all four ride existing single-item save paths + `sanitizeTask`.

## Architecture

### Surface (preserves the slice-2 declutter)
In `action-row.tsx`, gated by the primary `action`:
- **Assign owner** (inline popover) — reuse the existing `AssignOwnerBundle`/`ResourcePicker` dialog. Extend `canAssign` to ALSO match `action.source === "task-attention" && action.why.key === "actionTaskWhyUnassigned"` (keep the existing RAID-noOwner match). Mutually exclusive with Reschedule by primary reason → ≤1 inline popover.
- **Reschedule** (inline popover) — new `reschedule-popover.tsx` (mirrors `EscalatePopover`: `open` state, `popRef`, focus + Escape effects, `role="dialog"`, a `<input type="date">` + confirm button). Gated `canReschedule = reschedule != null && action.source === "task-due" && action.cta.kind === "open"`.
- **Mark done** (`[⋮]` menu item) — gated `onMarkDone != null && action.cta.kind === "open" && action.cta.view === "open-points"` (task-level: shows on any task row, incl. task-attention + task-due).
- **Clear blocker** (`[⋮]` menu item) — gated `onClearBlocker != null && action.source === "task-attention" && action.why.key === "actionTaskWhyBlocked"`.

`hasMenu` (slice 2) extends to include `onMarkDone`-applicable and `onClearBlocker`-applicable so the `[⋮]` renders when those apply.

### Bundles / handlers (task-manager, mirror `assignOwnerBundle`)
All `useMemo`, `isPopout ? undefined`, functional `setTasks(prev => …)` updaters, run the edited task through `sanitizeTask`, then `recordLearning(action, "acted")` + `showToast`. The task entity id = `Number(action.cta.id)` when `cta.kind === "open"`.

- **Assign (extend existing `assignOwnerBundle.onAssign`):** route by `action.cta.view`: `"raid"` → existing `applyOwnerAssignment(raid,…)`+`setRaid`; `"open-points"` → set the task's `assignee`/`assigneeEmail`/`resourceId` from the picker value via `setTasks(prev => prev.map(t => t.id===id ? sanitizeTask({...t, assignee: v.name, assigneeEmail: v.email, resourceId: v.resourceId ?? undefined}) : t))`, toast `actionOwnerAssigned`.
- **`onMarkDone(action)`:** `setTasks(prev => prev.map(t => t.id===id ? applyStatusChange(t, "Done", todayISO()) : t))`; toast `actionTaskCompleted`. (`applyStatusChange` is the SOLE status writer — keeps the `status==="Done" ⇔ completedDate` invariant; do NOT hand-set status.)
- **`onClearBlocker(action)`:** `setTasks(prev => prev.map(t => t.id===id ? sanitizeTask({...t, blockers: ""}) : t))`; toast `actionBlockerCleared`.
- **`rescheduleBundle`** (`RescheduleBundle = { onReschedule: (action, isoDate: string) => void }`): `setTasks(prev => prev.map(t => t.id===id ? sanitizeTask({...t, dueDate: isoDate}) : t))`; guard `isValidIsoDate(isoDate)` (reuse from `action-rebaseline`); toast `actionRescheduled`.

Each is `isPopout ? undefined` so popouts stay read-only and the row hides the control.

### Threading (5 layers — mirror existing `assignOwner`/`escalate`)
`task-manager.tsx` (build) → `workspace-section-types.ts` `WorkspaceSectionProps` (add `onMarkDone?`, `onClearBlocker?`, `reschedule?`) → `workspace-section.tsx` (pass to `<ActionsPanel>`) → `actions-panel.tsx` (`ActionsPanelProps` + pass to `ActionRow`) → `action-row.tsx` (`ActionRowProps` + consume). All new props OPTIONAL (back-compat with the ~30 ActionsPanel/ActionRow test sites).

### i18n (EN + DE)
| Key | EN | DE |
|---|---|---|
| `actionMarkDone` | `Mark done` | `Als erledigt markieren` |
| `actionClearBlocker` | `Clear blocker` | `Blocker entfernen` |
| `actionReschedule` | `Reschedule` | `Neu planen` |
| `actionRescheduleTitle` | `New due date` | `Neues Fälligkeitsdatum` |
| `actionRescheduleConfirm` | `Update` | `Aktualisieren` |
| `actionTaskCompleted` | `Task marked done` | `Aufgabe als erledigt markiert` |
| `actionBlockerCleared` | `Blocker cleared` | `Blocker entfernt` |
| `actionRescheduled` | `Due date updated` | `Fälligkeitsdatum aktualisiert` |

DE via node utf8 write (umlauts: `Fälligkeitsdatum`, `erledigt`); verify parity via tsc.

## Testing

- **`reschedule-popover.test.tsx`**: opens on click; confirm with a date fires `onReschedule(action, iso)`; invalid/empty date disables confirm; Escape closes.
- **`action-row.test.tsx`**: Assign popover shows on a `task-attention:unassigned` row (not on an overdue-primary row); Reschedule popover shows on a `task-due` row; Mark done item in `[⋮]` for any `open-points` row and fires `onMarkDone`; Clear blocker item shows only for `actionTaskWhyBlocked` primary and fires `onClearBlocker`; the existing slice-2 menu/contextual behavior intact.
- **`task-manager` handler tests** (or the existing action-handler test file): each handler uses a functional `setTasks` updater (assert N-in-one-tick safety like the bulk-edit pattern), routes by id, mark-done goes through `applyStatusChange` (Done ⇒ completedDate set), clear-blocker empties blockers, reschedule sets dueDate + rejects invalid; assign routes task vs raid by `cta.view`; each is `undefined` under `isPopout`.
- `npx tsc --noEmit`, `npm run lint`, `npm run test:run`. The `actions` view is NOT axe-gated → eye-verify the new popover/menu items (keyboard + labels) in light/dark/Mockup.

## Acceptance
- Unassigned / blocked / overdue / due-soon task rows expose the matching one-click resolution in place; resolving updates the workspace and the action drops out next compute.
- Mark done routes through `applyStatusChange`; all mutations use functional `setTasks`; popouts show none of these controls.
- Slice 1–3 behavior unchanged. All gates green.
