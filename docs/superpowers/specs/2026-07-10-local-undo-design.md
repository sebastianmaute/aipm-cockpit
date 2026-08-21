# Local Undo for Destructive Edits — Design (audit #11)

_2026-07-10. Addresses audit finding #11: destructive edits (bulk edit, clear-all, entity
deletes) are confirm-gated but **unrecoverable in file/IDB mode** — version history is Turso-only.
This design adds a local, in-memory, multi-level undo that works on every backend._

## Goal

A local undo that lets a user reverse the last ~10 destructive operations (deletes, clear-all,
bulk edits) across **every entity**, on **any backend**, within the session. No persistence,
no redo, no server round-trip. Correct under interleaving — undoing an older op must not clobber
edits made after it.

## Decisions (locked in brainstorming)

| Decision | Choice |
|----------|--------|
| Coverage | ALL destructive ops, every entity (deletes + clear-all + bulk-edit) |
| Persistence | In-memory only (session-scoped; gone on reload) |
| Depth | Multi-level stack, cap ~10 (evict oldest) |
| Restore mechanism | Item-level inverse restore (before-images, upsert by id) |
| Surfaces | Toast action button + Ctrl/⌘Z + top-bar control |
| Redo | Out of scope (YAGNI) |

## Architecture

### Core insight — one restore primitive for all op-types

Every destructive op reduces to *"here are the before-images of the rows I touched"*:

- **Delete** → before-images = the removed rows (absent from the new array)
- **Bulk edit** → before-images = the pre-edit versions of the changed rows (still present)
- **Clear-all** → before-images = the entire prior array (all absent)

Undo is a single pure upsert-by-`id`:

```ts
// undo/undo-stack.ts (pure, i18n-free, clock-free)
export type BeforeImage<T> = { index: number; item: T };

export function applyUndoRestore<T extends { id: number }>(
  current: readonly T[],
  before: readonly BeforeImage<T>[],
): T[] {
  const present = new Set(current.map((r) => r.id));
  const out = current.slice();
  for (const { index, item } of before) {
    if (present.has(item.id)) {
      out[out.findIndex((r) => r.id === item.id)] = item;   // present → revert (bulk-edit)
    } else {
      out.splice(Math.min(index, out.length), 0, item);      // absent → re-insert (delete/clear)
    }
  }
  return out;
}
```

This touches **only** the rows the op touched, keyed by id — so an unrelated edit made between
the op and the undo is left intact. That is the correctness win over a whole-array snapshot/replace.

### Stack model (pure)

- `pushUndo(stack, entry, cap = 10)` → new stack with `entry` on top, oldest evicted past `cap`.
- `popUndo(stack)` → `{ entry, rest }` (or `null` when empty).
- `dropEntry(stack, id)` → stack without the entry (toast-action already ran, or entity gone).

An `UndoEntry`:

```ts
export interface UndoMeta {
  id: number;              // monotonic, React key + toast/undoById target
  kind: ActivityKind;      // "task.deleted" | "bulk.edit" | "change.deleted" | …
  count: number;           // rows touched (toast text + top-bar badge)
  timestamp: string;       // ISO, captured at push (in the impure context, not the pure engine)
}
export interface UndoEntry {
  meta: UndoMeta;
  restore: () => void;     // closure: () => setX(prev => applyUndoRestore(prev, before))
}
```

The `restore` thunk is the only impure part. `meta` is display data.

### Provider + hook

`UndoProvider` (`undo/undo-context.tsx`) — mounted above the entity hooks and the header, mirrors
`useWorkspace()`. Holds `useState<UndoEntry[]>`. Exposes:

```ts
interface UndoApi {
  capture<T extends { id: number }>(opts: {
    setter: Dispatch<SetStateAction<readonly T[]>>;
    kind: ActivityKind;
    before: readonly T[];     // the touched rows (full objects)
    fromArray: readonly T[];  // resolve each row's original index
  }): void;                   // builds BeforeImage[], pushes entry, fires the Undo toast
  undo(): void;               // pop top, run its restore, log activity, toast "Restored N"
  undoById(id: number): void; // toast-action path — restore + drop that specific entry
  stack: readonly UndoMeta[]; // for the top-bar control
  canUndo: boolean;
}
```

`capture` reads the **live entity array from `useWorkspace()`** at gesture time (NOT inside a
setter updater — React purity bans side effects there). Fresh for discrete user gestures; two
destructive gestures in the same tick is not a real user path, so no staleness risk.

`undo`/`undoById` run the restore thunk, drop the entry, log an `"undo"` activity, and fire a
`Restored N items` toast.

## Coverage

Every destructive handler wires one `capture()` call before mutating (~2 lines each):

```ts
// use-change-log.ts handleDeleteChange
const doomed = changes.find((c) => c.id === id);
if (doomed) capture({ setter: setChanges, kind: "change.deleted", before: [doomed], fromArray: changes });
setChanges((prev) => prev.filter((c) => c.id !== id));
```

Wired into:

- **Tasks:** single delete, clear-all (`handleClearAll`), bulk-edit (`applyBulkEdit`)
- **RAID:** delete, bulk-edit
- **Changes:** delete, bulk-edit
- **Stakeholders:** delete, bulk-edit
- **Milestones:** delete, bulk-edit
- **Resources / roles / disciplines / grades:** delete
- **Absences / shifts:** delete

Bulk-edit is not a deletion but is lossy; it captures the selected rows' pre-edit before-images
and reverts via the same primitive.

**Excluded (out of scope, future work):** AI write-tool and inline-AI-edit mutations (single-item,
sanitizer-gated, not a destructive gesture); normal single-field create/update (not lossy).

## Surfaces

All three call the one `useUndo()` API. Toast = per-op (by id); hotkey + top-bar = stack top.

### 1. Toast action button

Extend the minimal toast infra (today: single toast, text-only, 4s auto-dismiss):

- `Toast` model gains optional `action?: { labelKey: TranslationKey; run: () => void }`.
- Add `showToastAction(kind, text, action)` — a new function; existing text-only `showToast`
  calls are untouched (back-compat).
- The toast render component renders a trailing `<button>` when `action` is present (labeled,
  `INTERACTIVE` atom, palette-safe).
- On capture, the provider fires `showToastAction("info", "Deleted 5 tasks",
  { labelKey: "undo", run: () => undoById(id) })`. Undoes **that** op by id; no-op if already undone.
- 4s auto-dismiss unchanged — the toast is the immediate affordance; the stack outlives it.

### 2. Keyboard Ctrl/⌘+Z

`use-undo-hotkey.ts` — global `document` keydown, mirrors the existing search ⌘K shortcut:

- Fires on `(e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey`.
- **Guard:** ignore when the active element is `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable` —
  native field undo wins there (must not hijack typing).
- `preventDefault` + `undo()` (stack top). Mounted once; serves modern + classic.

### 3. Top-bar undo control

`undo/undo-control.tsx` — presentational button:

- Wired into **both** header mounts (`buildShellChrome` `topBarMenus` + classic `AppHeader` — the
  both-mounts landmine; miss one and it's invisible in that layout).
- Disabled when `!canUndo`; shows a stack-depth badge.
- **Top bar ⇒ axe-scanned in every view** → solid `aria-label` (e.g. `Undo — <last action label>`),
  never a bare icon.
- `isPopout` → not rendered (popouts are read-only mirrors).

## Data flow

```
user destructive gesture
  → handler snapshots touched rows from useWorkspace() (live)
  → capture({setter, kind, before, fromArray})
      → build BeforeImage[] (item + original index)
      → pushUndo(stack, {meta, restore})
      → showToastAction("Deleted N", Undo)
  → handler mutates via setX(prev => …)

undo (toast / ⌘Z / top-bar)
  → run entry.restore()  →  setX(prev => applyUndoRestore(prev, before))
  → dropEntry / popUndo
  → logActivity("undo", …)
  → showToast("Restored N items")
```

## Error handling & edge cases

- **Row since removed by a later op:** the by-id upsert skips a gone row (bulk-edit revert) or
  re-inserts it (delete) — never crashes.
- **Empty stack:** hotkey and control are no-ops; control disabled.
- **Backend save:** restore fires the normal debounced save. An undo *adds* rows (delete/clear
  restore) or reverts fields (bulk-edit) — never a mass deletion — so it passes the persistence
  data-loss guard without arming the destructive-save bypass.
- **Reload:** stack is gone (in-memory by design); the destructive save already committed, so
  there is nothing to undo anyway.

## Testing

- **Engine** (`undo-stack.test.ts`): re-insert-at-index (delete), revert (bulk-edit), full restore
  (clear-all), **interleaved-edit-preserved** (the correctness win), cap eviction, `popUndo`/`dropEntry`.
- **Context** (`undo-context.test.tsx`): capture pushes + fires toast, `undo` pops + restores,
  `undoById`, cap, `"undo"` activity logged.
- **Hotkey** (`use-undo-hotkey.test.ts`): fires on ⌘Z; **no-op inside INPUT/TEXTAREA/contentEditable**.
- **Per-hook regression:** "delete → undo restores the row" for each entity hook.
- **Toast:** action button renders and fires `run`.
- **axe:** top-bar undo button labeled (gate scans it in every view).

## Files

**Create:** `undo/undo-stack.ts` · `undo/undo-context.tsx` · `undo/undo-control.tsx` ·
`use-undo-hotkey.ts` (+ tests each).

**Modify:** `use-toast.ts` · `toast-context.tsx` · the toast render component (add `action`);
`use-bulk-operations.ts` · `use-change-log.ts` · `use-stakeholders.ts` · `use-resource-planner.ts`
· `milestones-panel.tsx` · the task-delete handler (wire `capture`); `task-manager.tsx` (mount
`UndoProvider` both return branches + control into both header mounts + hotkey); `activity-log.ts`
(`"undo"` kind + `ACTIVITY_KIND_TO_KEY`); `i18n.ts` / `i18n.de.ts` (`undo`, `undoRestored` `{0}`,
`undoTooltip`, per-op undo labels, `activityUndo`).

## Constraints

- **No persisted Workspace field, no golden regen, no new backend write path** — undo is pure
  in-memory React state.
- **React purity:** `capture` reads live scope, never side-effects inside a setter updater; no
  `Date.now()`/`new Date()` in a render body (timestamp captured in the context callback).
- **i18n:** EN/DE parity (tsc-enforced); edit `i18n.de.ts` via node utf8 write, CRLF `\r\n`
  anchors, real umlauts (`i18n-encoding` bans ASCII subs).
- **Size:** `task-manager.tsx` near the ratchet — run `npm run size:check`; keep the wiring minimal.
- **Provider is real logic (a stack)** → coverage-gated (tested), NOT excluded like UI-glue hooks.

## Out of scope (future)

- Redo.
- Persistent (cross-reload) undo.
- Undo of AI write-tool / inline-AI-edit mutations.
