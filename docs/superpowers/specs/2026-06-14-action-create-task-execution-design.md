# Execution Depth — "Create Task" from a Signal (Slice 1)

**Date:** 2026-06-14
**Status:** Approved (brainstorm) — ready for implementation plan
**Feature area:** `action-row.tsx`, `task-manager.tsx` (surface only — engine untouched)

---

## Goal

Make Action-Center items **do something**, not just deep-link. The first executable CTA:
turn any signal into a **pre-seeded follow-up task** in the existing task editor (the user
reviews and saves — propose-then-confirm). For RAID signals the new task links back into
`linkedTaskIds` (both-way traceable); every signal seeds a `From: <source> — <why>` note.

This is **slice 1** of the "execution depth" roadmap (from the From-Reports-to-Next-Best-Action
seed). It establishes the executable-CTA UX + dispatcher that later kinds (assign-owner,
draft-message, escalate, re-baseline) will follow. Those are OUT of scope here.

## Background

The Action Center ([[action-center]], [[next-actions-confidence-robinson]]) renders
`SuggestedAction`s whose only CTAs today are `open` (deep-link) and `snooze`. Every action just
sends the user to the record; they do the work by hand. The engine (`next-actions/`) is **pure /
i18n-free** and stays that way — a `SuggestedAction` already carries everything the surface needs
to seed a task: `source`, `cta` (entity id), and the `title` / `why` `I18nText`. So this slice is
**entirely surface-side**; no engine, no `ActionInput`, no schema change.

The task editor is driven by `useTaskForm()` in `task-manager.tsx`, exposing
`form / setForm / editingId / setEditingId / taskModalOpen / setTaskModalOpen`. Opening a blank
new-task editor = set a form, `editingId = null`, `setTaskModalOpen(true)`. Seeding = set a
**pre-filled** form the same way.

## Decisions taken during brainstorming

1. **First executable CTA = create-task** (broadest reach, reuses the editor, lowest risk).
2. **Authority = propose-then-confirm:** click opens the editor **pre-filled**; the user edits and
   saves. No instant/auto creation.
3. **Traceability = link-where-supported + note:** RAID → real `linkedTaskIds` FK on save; ALL
   sources → a `From:` reference line prepended to the seeded description. No new persisted field.

---

## Architecture (surface only)

```
SuggestedAction (unchanged) ── source, cta.id, title, why
        │
action-row.tsx ─ "Create task" button (when source !== "task-due",
        │          tasks module enabled, not read-only popout)
        │          onClick → stopPropagation → onCreateTask(action)
        ▼
task-manager.tsx ─ onCreateTask(action):
        seed = {
          taskName:    t(lang, action.title.key, ...action.title.params),
          description: t(lang, "actionCreatedFromNote",
                         t(lang, SOURCE_LABEL[action.source]),
                         t(lang, action.why.key, ...action.why.params)) + "\n\n",
          ...blank-task defaults (the same the existing "add task" entry uses)
        }
        setForm(seed); setEditingId(null); setTaskModalOpen(true)
        if action.source === "raid": pendingLinkRaidIdRef.current = Number(action.cta.id)
        else:                        pendingLinkRaidIdRef.current = null
        ▼
handleSubmit (existing task-save path) — on a NEW task (editingId === null) save success:
        const raidId = pendingLinkRaidIdRef.current
        if (raidId != null) link the saved task id into that RAID item's linkedTaskIds
        pendingLinkRaidIdRef.current = null
```

### Units / responsibilities

- **`action-row.tsx`** — renders the new affordance; decides visibility; delegates via a new
  `onCreateTask?: (action: SuggestedAction) => void` prop (threaded down from `ActionsPanel`).
  No business logic.
- **`actions-panel.tsx`** — passes `onCreateTask` through to each `ActionRow` (and a
  `canCreateTask` boolean it receives from the surface for the module/popout gate, OR the gate
  lives in the surface and `onCreateTask` is simply absent when disabled — see below).
- **`task-manager.tsx`** — owns `onCreateTask` (the dispatcher) and the `pendingLinkRaidIdRef`
  + the `linkedTaskIds` append in `handleSubmit`. This is the only file that knows about tasks.
- A small **pure seed helper** `buildTaskSeedFromAction(action, lang, t)` (new file
  `action-task-seed.ts`) builds `{ taskName, description }` so it is unit-testable without React.

### Gating

`onCreateTask` is wired (button shown) only when ALL hold:
- `action.source !== "task-due"` (the task already exists; Open is the real action) — decided in
  `ActionRow`.
- the **tasks module is enabled** (`isModuleEnabled("tasks"/ open-points module, settings.features)`)
  — decided in the surface; when disabled, the surface passes `onCreateTask={undefined}` and
  `ActionRow` renders no button.
- **not a read-only popout** — the surface already knows `isPopout`; same `undefined`-prop gate.

No expert/mode gating: create-task is confirm-first and benign. (Revisit when escalate/re-baseline
land.)

## Data flow / traceability

- **Note (all sources):** seeded `description` begins `From: <translated source label> — <translated
  why>` + a blank line, then the user's cursor. One-way, human-readable provenance.
- **FK (RAID only):** RAID is the sole source with a task back-reference (`RaidItem.linkedTaskIds`).
  The new task id doesn't exist until save, so the dispatcher stashes the source RAID id in a ref
  and `handleSubmit` appends the saved id to that item's `linkedTaskIds` (immutably; via the
  existing `setRaid` setter). Both-way traceable: the RAID item's linked-tasks view shows it.

## Error handling / edge cases

- **Cancel editor** → no task created; `handleCancelEdit` clears `pendingLinkRaidIdRef`. No partial
  state, no dangling link.
- **Source RAID item deleted** between click and save → guard: only append if
  `raid.some(r => r.id === raidId)`; otherwise silently skip the FK (the task is still created with
  its note).
- **Edit (not create) submit** → the FK append runs ONLY when `editingId === null` (a genuine new
  task), so editing an existing task never mis-links.
- **Multiple tasks from one action** → each new id appends; harmless.
- **Action persists in the inbox** after task creation — auto-dismiss / "what did we do about
  red" lifecycle is the deferred loop-layer slice, explicitly NOT here.

## Testing

- `action-task-seed.test.ts` (pure): `buildTaskSeedFromAction` produces the right `taskName` and
  `From:` note for each source label; params interpolated; uses the action's translated title/why.
- `action-row.test.tsx`: "Create task" button renders for a raid/budget action, is ABSENT for a
  `task-due` action and when `onCreateTask` is undefined; clicking calls `onCreateTask(action)` and
  does NOT also trigger the row's Open handler (stopPropagation); button is a real keyboard-reachable
  `<button>`.
- `task-manager` (or an extracted dispatcher test): on create-from-raid then save, the RAID item
  gains the new task id in `linkedTaskIds`; a non-RAID source never mutates `linkedTaskIds`; the
  deleted-source guard skips cleanly; editing an existing task does not link.
- i18n EN/DE parity for `actionCreateTask` + `actionCreatedFromNote` (real umlauts via node write
  if DE needs them; tsc enforces parity).
- Full gate: tsc, lint (0 warnings), vitest, e2e 12-view axe (the new button must be reachable +
  labelled).

## Out of scope (explicit)

- Other executable CTAs (assign-owner, draft-message, escalate, re-baseline) — later slices reusing
  this affordance pattern.
- Auto-dismiss / lifecycle tracking / outcome data (the loop-layer slice).
- Surfacing create-task on the inline action-chips (Open Points) surface — follow-up.
- Any engine / `ActionInput` / schema change.

## Release

0.84.0, new minor codename "Cherryh" (C.J. Cherryh — first 0.84.x release). Bump
`src/app/version.ts` (APP_VERSION + APP_MILESTONE + build-date comment), add a `CHANGELOG.md`
entry, append a `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE strings). Per
[[gitlab-ci-and-ops]] + AGENTS.md release checklist.
