# Execution Depth — "Assign Owner" from a Signal (Slice 2)

**Date:** 2026-06-15
**Status:** Approved (brainstorm) — ready for implementation plan
**Feature area:** `action-row.tsx`, `actions-panel.tsx`, `task-manager.tsx` (surface only — engine untouched)

---

## Goal

Make a RAID-no-owner Action-Center item resolvable **inline**: an "Assign owner" button on the
row opens a small popover with the shared `ResourcePicker`; picking a person writes the owner to
the RAID item immediately. No editor round-trip.

This is **slice 2** of the execution-depth roadmap (slice 1 = create-task, 0.84.0
[[action-create-task-execution]]). It reuses the executable-CTA affordance pattern. Out of scope:
the other CTAs (draft-message, escalate, re-baseline), the loop/learning layer, push notifications,
and reassigning *already-owned* items.

## Background

A RAID severity action whose item has **no mitigation owner** is the clearest "assign the owner"
fix. The next-actions engine already marks these: the raid provider sets
`why.key === "actionRaidWhyNoOwner"` (and the full `clarityBonus`) for owner-less severity items
(0.83.0 [[next-actions-confidence-robinson]]). So the surface can detect the assign-eligible rows
**with no engine change** — the no-owner why-key is the marker.

The shared **`ResourcePicker`** (`resource-picker.tsx`) is the canonical owner/assignee picker
(`value: {name,email,resourceId}`, `resources: Resource[]`, `onChange(next)`,
`onCreateResource(name,email)→id`); `raid-edit-modal` already uses it for the RAID owner field.
RAID owner is three fields: `owner` (name), `ownerEmail`, `ownerResourceId`. Writing them is a
`setRaid` update — same surface-only shape as the create-task RAID back-link. No schema change.

## Decisions taken during brainstorming

1. **UX = inline picker popover** (resolve from the inbox, the execution-depth win), not an
   editor round-trip.
2. **Scope = RAID severity actions with no owner only** (detected via
   `why.key === "actionRaidWhyNoOwner"`). Reassign-when-owned is out.
3. **Immediate on pick** — the pick *is* the assignment (no separate confirm; reversible via the
   RAID editor) + a toast.

---

## Architecture (surface only)

```
action-row.tsx
  ─ "Assign owner" button shown when:
        assignOwner != null
        && action.source === "raid"
        && action.why.key === "actionRaidWhyNoOwner"
        && action.cta.kind === "open"
  ─ button toggles a portalled popover anchored to it, containing:
        <ResourcePicker
           value={{ name: "", email: "", resourceId: null }}
           resources={assignOwner.resources}
           onCreateResource={assignOwner.onCreateResource}
           onChange={(next) => { assignOwner.onAssign(action, next); setOpen(false); }} />

actions-panel.tsx
  ─ threads a single optional `assignOwner` prop bundle down to every <ActionRow>.

task-manager.tsx
  ─ builds the bundle (gated !isPopout):
       assignOwner = {
         resources,
         onCreateResource,                      // existing resource-create handler
         onAssign: (action, v) => {
           const id = Number(action.cta.id);
           setRaid(prev => prev.some(r => r.id === id)
             ? prev.map(r => r.id === id
                 ? { ...r, owner: v.name || undefined,
                            ownerEmail: v.email || undefined,
                            ownerResourceId: v.resourceId }
                 : r)
             : prev);
           showToast("info", t(lang, "actionOwnerAssigned", id));
         },
       }
```

### Units / responsibilities

- **`action-row.tsx`** — owns the `open` popover state + renders the button + the portalled
  `ResourcePicker`; no business logic (delegates the write via `assignOwner.onAssign`). The
  `assignOwner` bundle keeps the prop surface to ONE optional prop.
- **`actions-panel.tsx`** — passes `assignOwner` through to each row (both list sites).
- **`task-manager.tsx`** — owns the `setRaid` write + the toast; provides `resources` /
  `onCreateResource` (already in scope). Gated `!isPopout`.
- **Engine (`next-actions/`)** — untouched. The marker is the existing no-owner why-key.

### Prop shape

```ts
interface AssignOwnerBundle {
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
  onAssign: (action: SuggestedAction, value: { name: string; email: string; resourceId: number | null }) => void;
}
// ActionRowProps / ActionsPanelProps gain:  assignOwner?: AssignOwnerBundle;
```

## Data flow / behavior

- Pick a person (or create one via the picker) → `onChange` fires once → `onAssign` writes the
  three owner fields to that RAID item via `setRaid` (immutably, guarded by item-exists) → popover
  closes → toast.
- **After assign**, on the next `computeNextActions`: the raid severity action **re-ranks**
  (clarity `clarityBonus`→`semiClarityBonus`, why `actionRaidWhyNoOwner`→`actionRaidWhySeverity`)
  and the "Assign owner" button disappears (the item now has an owner). The action is NOT
  auto-dismissed — it's still a severity signal; lifecycle auto-dismiss is the deferred loop layer.

## Error handling / edge cases

- RAID item deleted between opening the popover and picking → the `setRaid` `.some(...)` guard
  returns `prev` unchanged (no throw, no toast-on-nothing — guard the toast on the same check, or
  accept the benign toast; prefer: only toast when the item existed).
- Read-only popout → `assignOwner` is `undefined`, button never renders.
- Picker "create new resource" path → `onCreateResource` mints the resource and returns its id;
  `onChange` then carries `resourceId`, so the owner is resource-linked. Reuses existing behavior.
- Empty pick (cleared) → writes `undefined`/`null` (un-assigns) — harmless; the user chose it.

## Testing

- `action-row.test.tsx`: the "Assign owner" button renders for a raid action with
  `why.key === "actionRaidWhyNoOwner"`, is ABSENT for a raid action with `actionRaidWhySeverity`,
  for a non-raid action, and when `assignOwner` is undefined; clicking opens the popover; the
  button does not also trigger the row's Open (stopPropagation).
- Popover → `ResourcePicker` `onChange` calls `assignOwner.onAssign(action, value)` once and closes.
- `task-manager` (or an extracted `onAssign` unit): writes the three owner fields to the right RAID
  item; guarded against a missing id; non-matching ids untouched.
- a11y: the button has an accessible name (`actionAssignOwner`); the popover is keyboard-operable,
  closes on Escape, and manages focus; `ResourcePicker` is already accessible. (axe-critical per
  AGENTS.md — new interactive control needs a label + keyboard.)
- i18n EN/DE parity for `actionAssignOwner` + `actionOwnerAssigned` (real umlauts via node write if
  needed; tsc enforces).
- Full gate: tsc, lint, vitest, e2e 12-view axe.

## Out of scope (explicit)

- Reassigning items that already have an owner.
- Assign-owner on non-RAID sources (tasks/workload have different ownership models).
- Other executable CTAs, the loop/learning layer, push notifications.
- Any engine / `ActionInput` / schema change.

## Release

0.86.0, new minor codename "Hamilton" (Peter F. Hamilton). Standard checklist: bump
`version.ts` (APP_VERSION + APP_MILESTONE + build-date comment), `CHANGELOG.md` entry, append a
`versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE). Per [[gitlab-ci-and-ops]] + AGENTS.md.
