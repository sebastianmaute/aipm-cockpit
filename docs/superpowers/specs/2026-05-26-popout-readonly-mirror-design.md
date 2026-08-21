# Popout Read-Only Mirror — Design Spec

**Date:** 2026-05-26
**Status:** Approved (design); pending spec review
**Topic:** Fix popout-triggered data loss; make popout windows true read-only mirrors.

---

## Problem

Repro (Chrome, local-file backend): open the app → **Resources** → pop the tab
out → **close the popout window**. The browser reports that file writing is
forbidden by security policy, and the workspace file on disk is **gone**.

This is data loss, not corruption: the original file is deleted.

## Root Cause (confirmed via systematic-debugging)

Two compounding causes:

### Cause 1 — the popout induces a redundant write in the main window

`use-storage-backend.ts` gates only the **save** effect on `isPopout`
(line ~123, `if (args.isPopout) return;`). The **load** effect (line ~75) is
**not** gated. So a popout:

1. Loads the workspace from the shared file handle (read-only load — fine).
2. That load flips its sync state from empty → loaded, a genuine post-mount
   change.
3. `useBroadcastSync`'s send effect (`broadcast-sync.ts:79-94`) broadcasts the
   loaded state.
4. The main window's receive handler (`broadcast-sync.ts:62-69`) applies it via
   the workspace setters **without** setting `suppressNextSaveRef`.
5. The main window's save effect fires — a file write triggered **purely by the
   mirror window opening**.

The existing `lastSeenRef`-init-to-mount-value fix only suppresses the popout's
*initial empty* broadcast; it does not suppress the *post-load* broadcast.

### Cause 2 — `writeHandle` is not atomic-safe under a blocked write

`storage.ts` `writeHandle` (1816-1829) guards `createWritable()` (maps a blocked
open to `StorageNotReadyError("local-file-write-blocked")`), but the subsequent
`await writable.write(content)` and `await writable.close()` (1827-1828) are
**unguarded**. `createWritable()` writes to a `.crswap` temp and atomically
renames it over the original on `close()`. If Chrome blocks the write around
that atomic replace, the original can be left deleted.

Cause 1 supplies the unnecessary write; Cause 2 makes that write destructive
when blocked.

## Goals

1. A popout window must never trigger a file write in any window.
2. A blocked write must never leave the original file deleted (defense-in-depth).
3. A popout is a **read-only mirror**: it reflects the main window's state and
   does not offer edits that would silently vanish.

## Non-Goals

- Changing the storage backend model or the single-writer rule.
- Making popouts independently persist (they intentionally never write).
- A per-control "disable every button" lockdown (rejected as not lightweight;
  see Change 3).
- E2E coverage of Chrome's File System Access blocking behavior (not
  reproducible in jsdom — covered by a manual smoke test).

---

## Design

Three independent changes.

### Change 1 — One-way sync: popout receives, never sends

**File:** `src/app/broadcast-sync.ts`, `src/app/use-storage-backend.ts`

Add a `canSend` parameter to `useBroadcastSync`:

```
useBroadcastSync(kind, value, applyIncoming, enabled = true, canSend = true)
```

- The **receive** listener effect continues to gate on `enabled` only — the
  popout must keep receiving so its mirror stays live.
- The **send** effect gates on `enabled && canSend` (early-return when either is
  false). All other send logic (the `lastSeenRef` reference-equality skip)
  is unchanged.

In `use-storage-backend.ts`, pass `canSend={!isPopout}` to **all nine**
`useBroadcastSync` calls (tasks, raid, absences, shifts, resources, roles,
disciplines, grades, activityLog).

Effect: a popout never broadcasts, so the main window never receives the
popout's loaded state, so the main window never fires the redundant save.
Cause 1 eliminated.

The popout's own load effect stays as-is (read-only `backend.load()` from the
shared handle gives the popout correct initial state without writing).

### Change 2 — Guard the write in `writeHandle` (defense-in-depth)

**File:** `src/app/storage.ts`

Wrap `writable.write(content)` and `writable.close()` in a try/catch. On
failure, attempt `writable.abort?.()` (so the `.crswap` temp is discarded and
the atomic rename never runs, leaving the original intact), then throw
`StorageNotReadyError("local-file-write-blocked")` — the same hint already
mapped to the `storageWriteBlocked` toast in `use-storage-backend.ts:134`.

This is independent of Change 1: even if some other path triggers a blocked
write, the original file survives and the user gets the existing targeted toast
instead of a silent deletion.

### Change 3 — Read-only mirror lockdown (lightweight chokepoint)

**Files:** `src/app/read-only-guard.ts` (new), `src/app/task-manager.tsx`,
`src/app/i18n.ts` (EN + DE). `makeEditGuard` lives in its own module so it is
unit-testable in isolation; `ReadOnlyMirrorBanner` is a small component in
`task-manager.tsx` (or its own file if it grows).

A popout can no longer persist (save-gated) or sync out (Change 1), so any edit
made in a popout is purely local and lost on close — confusing UX. The lockdown
removes that confusion without a heavy per-control rewrite.

**Inventory (popout-able tabs):** `reports` and `resource-report` are already
read-only. The other six (`chat`, `gantt`, `raid`, `resources`, `activity`,
`address-book`) have edit affordances. Every *workspace-committing* action
funnels through handlers consumed in `TaskManagerInner` from three hooks
(`useResourcePlanner`, `useTaskSubmit`, `useTaskRowHandlers`) plus the gantt-bar
update handler and `handleClearActivityLog`. The raw `useWorkspace` setters
**cannot** be gated — the popout needs them to receive its mirror — so the
chokepoint is at these UI commit handlers, not the setters.

**Mechanism:**

1. A guard helper:

   ```ts
   // returns a wrapped handler that no-ops (with a toast) when read-only
   function makeEditGuard(isReadOnly: boolean, notify: () => void) {
     return <A extends unknown[]>(fn: (...args: A) => void) =>
       (...args: A): void => {
         if (isReadOnly) { notify(); return; }
         fn(...args);
       };
   }
   ```

2. In `TaskManagerInner`, build the guard once from `isPopout`:

   ```ts
   const guard = makeEditGuard(isPopout, () =>
     showToast("info", t(lang, "popoutReadOnly")));
   ```

   Wrap the committing handlers (save/delete/assign/role/discipline/grade/
   utilization/plan-window/resource-add-edit-delete/raid-save-delete/
   create-mitigation-task/task-submit/toggle-complete/gantt-bar-update/
   clear-activity-log) before passing them to the panels. View-only handlers
   (search, sort, filter, view toggles, note-expand, jump-to-task/raid) are
   **not** wrapped — the mirror stays useful.

3. A persistent banner: render `{isPopout && <ReadOnlyMirrorBanner />}` near the
   top of `TaskManagerInner` (consistent with the existing `{!isPopout && …}`
   banner blocks). Text: "Read-only mirror — make changes in the main window."

4. Chat: its mutating tools route through the same guarded handlers, so they are
   blocked automatically. If any chat tool writes workspace state directly
   (not via a shared handler), the plan gates the tool dispatch in popout. Chat
   message send itself stays enabled (read-only Q&A about the data is harmless).

**New i18n keys (EN + DE):** `popoutReadOnly` (toast), `popoutReadOnlyBanner`
(banner).

---

## Data Flow (after fix)

```
Popout opens
  └─ load effect: backend.load() (read-only) → sets mirror state
       └─ send effect: canSend=false → NO broadcast        ← Change 1
Main window edits something
  └─ send effect: canSend=true → broadcast
       └─ Popout receive listener: applies → mirror updates (never saves)
Main window save effect: writes file (sole writer)
  └─ writeHandle: write/close guarded; blocked → abort temp,
       throw local-file-write-blocked → toast, original intact  ← Change 2
User attempts edit inside popout
  └─ guarded handler: isPopout → toast "edit in main window", no-op  ← Change 3
```

## Error Handling

- Blocked write → `StorageNotReadyError("local-file-write-blocked")` →
  existing `storageWriteBlocked` toast; original file preserved.
- Popout edit attempt → `popoutReadOnly` info toast; no state change.

## Testing

**Unit (Vitest + RTL):**

1. `broadcast-sync` send-gating: with `canSend=false`, mounting and changing
   `value` applies incoming messages but **never** calls `postMessage`; with
   `canSend=true` (default) it broadcasts post-mount changes as today.
   (Mock `BroadcastChannel`.)
2. `use-storage-backend`: assert that with `isPopout=true` no outbound sync
   fires on a state change (popout sends nothing). (Extends existing
   `use-storage-backend.test.tsx`.)
3. `makeEditGuard`: returns a wrapper that calls through when not read-only, and
   no-ops + notifies when read-only.
4. `storage.ts writeHandle`: when `write`/`close` reject, it calls `abort` (when
   present) and throws `StorageNotReadyError` with hint
   `"local-file-write-blocked"`. (Mock the writable.)

**Manual smoke (not unit-testable — Chrome FSA):** run the exact repro
(Resources → pop out → close popout) against a real local file and confirm the
file survives and no security-policy deletion occurs.

## Files Touched

- `src/app/broadcast-sync.ts` — `canSend` param; gate send effect.
- `src/app/use-storage-backend.ts` — pass `canSend={!isPopout}` to 9 calls.
- `src/app/storage.ts` — guard `write`/`close` in `writeHandle`.
- `src/app/task-manager.tsx` — guard wrapper, wrap commit handlers, banner.
- `src/app/i18n.ts` — `popoutReadOnly`, `popoutReadOnlyBanner` (EN + DE).
- `src/app/read-only-guard.ts` (new) — `makeEditGuard`; `ReadOnlyMirrorBanner`
  lives in `task-manager.tsx`.
- Tests: `broadcast-sync.test.ts(x)`, `use-storage-backend.test.tsx`,
  `read-only-guard.test.ts`, `storage` writeHandle test.
