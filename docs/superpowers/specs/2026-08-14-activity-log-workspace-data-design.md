# Activity log as workspace data (B1) — design

**Date:** 2026-08-14
**Status:** approved, not yet planned
**Sub-project:** B1 of the "AI recall" arc. See *Out of scope* for B2 and §148.

## Goal

Promote the activity log from a per-device `localStorage` blob to persisted workspace data, so the
audit trail survives a device change, an app reset and a project export, and so it can be attributed
to the project it belongs to.

This is worth shipping on its own merits. It is also a prerequisite for **B2** (AI recall of past
actions as chat context), which cannot honestly read the log in its current form.

## Why it cannot stay as it is

Measured against the current tree, not assumed:

- `ActivityEntry` carries `{id, timestamp, kind, args, changes?}` — **no project id**.
- `loadActivityLog()` takes **no arguments** and reads one global key, `aipm-cockpit:activity-log`.
- Its own doc comment states: *"Per-device only (localStorage) — NOT a persisted Workspace field,
  excluded from exports/Turso."*
- `clearAppConfig()` wipes every `aipm-cockpit:*` key, so an app reset destroys the log.
- `ACTIVITY_MAX_ENTRIES` is 500.

So on a device that has opened several projects, the log is one undifferentiated stream spanning all
of them, with no field that could separate them after the fact. Any consumer — a human reading the
Activity view, or the AI in B2 — will attribute the whole stream to whichever project is open.

## Decisions

Each was an explicit fork; the rejected options are recorded because the reasons outlive the choice.

| Decision | Choice | Why |
|---|---|---|
| Where it lives | Workspace data | Rejected: per-project scoping inside localStorage (keeps it device-bound and reset-fragile); dropping the log from B2's scope; feeding it as-is with a prompt caveat (a hedge in a prompt is not a guard — the model still attributes entries to the current project). |
| Storage shape | **Meta-blob**, one JSON row keyed `activityLog` | Mirrors `insights` / `documents` / `documentVersions` exactly. Rejected: a real `ENTITY_SPECS` table — workspace save does a per-table DELETE and re-INSERT, so an append rewrites every row either way, and the workspace load already pulls everything, so server-side queryability buys nothing until something reads outside the load. |
| Export policy | **Storage-only** | Persisted on all six paths, absent from `EXPORT_SECTION_KEYS`. Rejected: full inclusion (every client-facing export would carry `changes` — old and new values for up to 12 fields per update). |
| Multi-device | Unique ids + union on load and save | Rejected: plain last-write-wins (silent history loss is the one property an audit trail must not have); union-by-content-tuple (collapses two genuinely identical actions, silently and undetectably). |
| Existing local entries | **Dropped** | Rejected: read-only legacy view (dual-source Activity view for months); one-time import prompt (a multi-project user clicking yes mis-attributes everything). |

## Data shape

```ts
export interface ActivityEntry {
  /** Globally unique: `"<deviceId>-<counter>"`. Was a number, monotonic only
   *  within one device's log — which is exactly why two devices collide. */
  id: string;
  timestamp: string;                    // unchanged, ISO 8601 UTC
  kind: ActivityKind;
  args: (string | number)[];
  changes?: readonly FieldChange[];
}
```

`Workspace` gains `activityLog?: readonly ActivityEntry[]`. The 500-entry cap is retained and is now
per project rather than per device, so total stored volume grows with project count.

`deviceId` is a new per-device `localStorage` value under `aipm-cockpit:device-id`, owned by
`activity-log.ts` behind an exported `getDeviceId()` that mints lazily on first call. It is not a
secret and must not join the `SecretId` union. `clearAppConfig()` wipes it; a regenerated id is
harmless, because the only property required of it is non-collision with other devices.

Mint with `crypto.randomUUID()` where available, falling back to a timestamp-plus-random string.
`getDeviceId()` is called from append paths (event handlers), never from a component render body —
the repo's `react-hooks` purity rule makes `Date.now()` / `Math.random()` in a render body fatal.

### The `id` type change

`id: number → string` ripples to its use as a React key — `activity-log-panel.tsx` renders
`<tr key={entry.id}>`, and `dashboard-panel.tsx` reads the log via `loadActivityLog()`. Mechanical,
but it is the one type change that leaves this file.

## The six write paths

New persisted `Workspace` field means all six, or data silently drops on the missed backend. This
mirrors `insights` at every step, which is what keeps the slice small:

| Path | Shape |
|---|---|
| JSON | Additive field in `workspaceToJson` (only emitted when non-empty, so legacy files stay clean) + `sanitizeActivityLog` on the way in via `jsonToWorkspace` |
| CSV | New `config,<json>` single-row section in `csv-codecs-config.ts`, emitted on non-empty |
| Markdown | Fenced json blob in `markdown-codecs-core.ts` |
| Turso single | `meta` row keyed `activityLog`; dirty check `prev.activityLog !== next.activityLog` |
| Turso tenant | Same — `meta` is already per-project |
| IndexedDB | Own KV key in `browser-backend.ts`, delete-on-absent so a cleared log does not reload stale |

No `ENTITY_SPECS` row. No `TABLE_NAMES` entry — it rides `meta`, so the per-table DELETE on save does
not apply to it.

### Storage-only, not export-gated

`workspaceToCsv(ws, config?)` already draws this distinction: **no `config` (storage) emits every
section for round-trip fidelity; a `config` (document export) emits only enabled sections.** Being
"storage-only" therefore costs no data on any backend — it means simply not adding an
`EXPORT_SECTION_KEYS` entry, and gating emission on the array being non-empty.

Two precedents already do this and carry a comment saying so: `documents` (*"there is no `documents`
key in EXPORT_SECTION_KEYS, so emission is gated purely on the array being non-empty"*) and the
field-visibility config. Follow their comment convention — the asymmetry between what is stored and
what is exported reads as a bug to anyone who finds it without one.

### ★★★ `isWorkspaceEmpty` — and the answer here is the INVERSE of `documents`

`isWorkspaceEmpty` feeds the LOAD guard that refuses an incoming empty workspace when the current one
is populated. `documents` was deliberately **added** to it, because "only documents" is an ordinary
state (someone drafting a charter before entering any task) and without it a transient empty read
wipes them.

**`activityLog` must NOT be added.** The log is auto-appended by ordinary use, so a workspace carrying
only log entries and no user records would read as non-empty, slip past the guard, and let a transient
empty backend read replace a populated project. Adding it would convert a data-loss guard into a
data-loss vector. This inverts the `documents` precedent, and the next reader will assume it followed
it — say so in the code.

It must equally stay out of `nonEmptyCollectionCount` / `workspaceRecordCount`, which feed the
SAVE-time mass-deletion thresholds: widening those changes when saves are refused for every existing
project (see `docs/open-followups.md` §98), and auto-generated rows would inflate the counts.

**`SCHEMA_VERSION` needs no bump.** Measured, not assumed: `git log --oneline -S "SCHEMA_VERSION = "
-- src/app/workspace.ts` returns a single commit — the original extraction from `storage.ts` — so the
constant has never been bumped since, and the commit that added `documents` to the JSON path
(`2ef2adf0`) did not touch it. An additive optional field does not move it.

## Merge

Pure, i18n-free `mergeActivityLogs(a, b)`: union by `id`, sort by `timestamp`, cap to the 500 newest.
Invoked when a workspace arrives (initial load, project switch, Turso pull) and again immediately
before writing.

**This narrows the window; it does not close it.** An entry appended on device A between device B's
load and B's save is still lost. Closing it fully requires append-level writes, which the meta-blob
shape cannot express. That trade is accepted deliberately — state it in the code so a later reader
does not record it as solved.

### ★★ Reference-equality dirty check (inherited landmine)

The dirty check is `prev.activityLog !== next.activityLog`, so an in-place `push()` silently skips the
save. Every append must produce a new array. This has already bitten `documents`.

## Migration

The old `aipm-cockpit:activity-log` key is deleted on first load; the workspace log starts empty.

A single-project user loses history they could read yesterday, with no way back. That warrants a
`CHANGELOG.md` entry and a `versionHighlight*` key (EN + DE, appended to `APP_HIGHLIGHT_KEYS`) — not
silence.

## Testing

- **Pure merge engine** — union, dedupe, ordering, cap-to-newest, empty/undefined inputs. Property-test
  candidate: `merge(a, b)` and `merge(b, a)` must agree on membership, and the result must never exceed
  the cap.
- **Six-path round-trip** — append → save → load → identical, once per backend.
  `entity-persistence-registry.test.ts` is the existing guard for this class.
- **Golden fixture regen** — a legitimate new-section format change for CSV and Markdown, not a mask
  over a format diff. Regenerate from the serializers; do not hand-edit.
- **Storage-only** — assert `workspaceToCsv(ws)` contains the section and `workspaceToCsv(ws, config)`
  does not. Without this, the export exclusion is untested and will drift.
- **`isWorkspaceEmpty`** — a workspace holding ONLY activity entries must still report empty. This is
  the test that pins the inversion above; write it before the field is added and watch it fail.
- **Reference equality** — appending must change array identity. Mutation-test it: an in-place variant
  must go red, or the assertion is vacuous.

## Risks

| Risk | Handling |
|---|---|
| `isWorkspaceEmpty` inversion is silently "corrected" by a later contributor following the `documents` precedent | Comment at the site + a dedicated test that fails if it is added |
| Merge window presented as closed | Comment states the residual case explicitly |
| Storage-only asymmetry read as a bug | Follow the `documents` comment convention |
| `id` type change missed at a render site | tsc catches it; `npx tsc --noEmit` after the change |
| Golden fixtures regenerated to mask a real diff | Regenerate only from the serializers, and only in the commit that adds the section |

## Out of scope

- **B2 — AI recall.** Hybrid delivery: a thin always-on digest so the model knows history exists, plus
  pull tools for depth, over four sources (past chat threads, this activity log, decision rationale in
  RAID/changes/milestones, and the AI's own past writes and rejected recommendations). Depends on B1
  for the activity source. Its own spec.
- **§148** — `retryLoad`'s clobber in `use-chat-threads.ts`. Independent of both; already specced in
  `docs/open-followups.md` (hoist a shared guard taking `startedOn`; do **not** reuse the mount-fetch
  effect body wholesale, since it clears `pendingRetryRef`/`latestSeqRef` on project switch and
  `retryLoad` must not).
- Promoting any other per-device store to workspace data.
