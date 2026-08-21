# Slice A — Budget↔task linking (bulk op · task-modal field · Manual % inline)

_Opened 2026-07-28 against 0.206.0 "Shawl". Fourth slice of the 8-slice UX-batch roadmap
(`2026-07-27-ux-batch-roadmap-design.md`); order C → D → F → **A** → E → S6 → S7 → B._

★ This file is gitignored (`.gitignore:76:/docs/superpowers/`) — local-only by explicit decision.
★★ At slice close, re-archive this whole tree to `_archive-slice-docs-2026-07-28-slice-a.zip`,
**merging the previous archive's unique entries** and asserting the superset property before
trusting it. The current archive (`…-slice-f.zip`) holds 338 entries; the working tree holds far
fewer. A plain walk-the-tree zip is a strict SUBSET and destroys ~300 historical documents.

---

## 1. Goal

Make the budget↔task relationship editable from the **task** side, and make a bucket's manual
completion editable without opening the bucket modal. Three user-visible controls:

1. **Bulk op** — select N tasks in Open Points → assign them all to a budget bucket (or unlink).
2. **Task-modal field** — a "Budget bucket" select in the task editor.
3. **Manual % inline** — an editable Manual-% cell on each bucket card in the Budget panel.

Plus the infrastructure the user asked for alongside them: **all budget-bucket writes become
undoable and activity-logged** (they are neither today).

## 2. Grounding — verified against 0.206.0

| Assumption | Reality |
|---|---|
| A task carries a bucket id | **No.** `BudgetBucket.taskIds: number[]` — the *bucket* owns tasks. Every new control writes `budgets`, never `tasks`. |
| Manual % is missing | Exists: `BudgetBucket.percentComplete?: number`, edited in `budget-bucket-modal.tsx:501`, i18n `budgetPercentComplete` = "Manual % complete". Missing only as an inline control. |
| Tasks bulk edit is the shared `BulkEditPanel` | **No.** Tasks use a bespoke `BulkEditModal` (390 ln) driven by `useTaskForm`'s `BulkEditDraft`. The data-driven panel serves the other four registers. |
| Bucket writes are undoable/logged | **Neither.** `budget-panel.tsx` calls `props.onChangeBuckets(fullArray)` at 8 sites; `handleChangeBudgets` (`task-manager.tsx:1875`) is `useCallback(next => setBudgets(next))`. No `budget.*` `ActivityKind`, no `budget` `UndoEntityKey`. |
| Hour cells commit on blur | **No.** `HoursCell` (`budget-panel.tsx:108`,`:121`) commits **per keystroke** via `onChange`. |
| The task editor can reach `useWorkspace()` | `TaskFormFields`' own unit tests render it bare — a context read there throws. Data must arrive as props. |
| A new task has an id at edit time | No. Id is minted at save. `useTaskEditorBuffer` already exists for exactly this (stages RAID + links, flushes on `flush(parentId)`). |

**Persistence:** `taskIds` and `percentComplete` are already in `BUDGETS_CSV_COLUMNS`
(`csv-codecs-core.ts:195` — covers CSV + Turso single + tenant), `BUDGETS_MD_COLUMNS`
(`markdown-columns.ts:187`), `sanitize-entities.ts:618`, and the JSON/IDB whole-object paths.
**Zero write-path work, zero golden regeneration, no migration.**

## 3. Decisions (locked)

| # | Decision | Rationale |
|---|---|---|
| D1 | Manual % goes **inline in the Budget panel** (editable), not as a report column | asked; the report column can follow later if wanted |
| D2 | **One bucket per task.** Picking bucket B removes the task from every other bucket | "which budget does this task charge to"; makes it impossible for one task to inflate two buckets' derived completion |
| D3 | **Full** undo + activity logging for *all* bucket writes, not only the new ones | consistency; budget was the last register with silent writes |
| D4 | Implemented as a **boundary hook + intent meta**, not a per-op CRUD hook | keeps `budget-panel`'s array math in place (8 one-line call-site changes vs relocating ~80 lines); one funnel covers every future bucket write |
| D5 | Bulk field lives **inside** the existing `BulkEditModal` | consistent with its 10 other fields |
| D6 | The inline % input's **placeholder shows the task-derived %** | makes the override relationship visible without opening the modal |

**Non-goals:** no `Task.budgetBucketId` field; no bucket column in the Budget *report*; no bucket
control on the Kanban card or the inline task row; no change to the bucket modal's existing
multi-task picker (the bucket side stays many-tasks — D2 constrains only the task-side controls).

---

## 4. Design

### 4.1 `budget-task-link.ts` — new pure module

i18n-free, clock-free (the caller passes `stamp`), no React. Coverage-gated → genuinely tested,
**no `coverage.exclude` entry**.

```ts
export function bucketIdForTask(
  buckets: readonly BudgetBucket[], taskId: number,
): number | null;

export function moveTasksToBucket(
  buckets: readonly BudgetBucket[],
  taskIds: readonly number[],
  target: number | null,
  stamp: string,
): readonly BudgetBucket[];
```

Semantics:

- `bucketIdForTask` returns the **first** bucket (in array order) whose `taskIds` contains the id,
  else `null`. D2 makes multiple matches unreachable through the new controls, but a workspace
  edited through the bucket modal (or imported) can still hold them — the function must not throw
  or pick nondeterministically.
- `moveTasksToBucket` removes every id in `taskIds` from every bucket's `taskIds`, then appends
  the ones not already present to `target`. `target === null` = unlink only.
- **A no-op returns the input array BY REFERENCE.** Nothing changed ⇒ no undo entry, no
  `localModifiedAt` churn, no autosave write. This is the guard that stops "assign to the bucket
  it is already in" from pushing a meaningless undo entry.
- Only buckets whose `taskIds` actually changed get a new object identity and a fresh
  `localModifiedAt` (mirrors `applyBucketOrder`'s existing rule in `budget-panel.tsx:337`).
- An unknown `target` id (not in `buckets`) is a **no-op returning the input by reference** — it
  must never degrade into a silent unlink.
- Duplicate ids in `taskIds`, and ids already present in the target, are deduped.

### 4.2 `use-budget-buckets.ts` — the commit boundary

Replaces `handleChangeBudgets`. One line out, one line in — `task-manager.tsx` has **1 line** of
ratchet headroom (2973 vs baseline 2974), so this must stay line-neutral.

```ts
const { commitBuckets } = useBudgetBuckets({ budgets, setBudgets, capture, captureComposite, logActivity });
```

`commitBuckets(next: BudgetBucket[], meta?: BucketCommitMeta)`:

1. Diff `prev` → `next` by id: `created` (id only in next), `deleted` (id only in prev),
   `edited` (id in both, structurally different).
2. Nothing in any bucket ⇒ **return without capturing, logging, or setting state.**
3. Capture: `capture({ setter: setBudgets, kind, removed: deleted, edited, fromArray: prev,
   name: meta?.name, entityKey: "budget" })`.
4. Log: `logActivity(kind, [meta?.name ?? count])`.
5. `setBudgets(next)`.

`kind` resolution: `meta?.kind` wins; otherwise derived — any `deleted` ⇒ `budget.deleted`, else
any `created` ⇒ `budget.created`, else `budget.updated`. So a call site that passes no meta is
still logged correctly, just without a name.

`BucketCommitMeta = { kind?: ActivityKind; name?: string; tasksPart?: CompositeFragment }`. When
`tasksPart` is present (built by the caller via `capturePart`) the commit uses `captureComposite`
instead, with `parts: [tasksPart, budgetsPart]` — this is what makes a bulk apply that edits task
fields **and** re-links buckets a single undo entry. `commitBuckets` still owns **only**
`setBudgets`; the caller applies its own `setTasks`. The hook captures both arrays, it does not
write both.

**Registration lockstep** (the calendarEvent landmine — a missed entry silently drops the name
from every undo toast while restore keeps working, and eight reviews missed it once):

| File | Edit |
|---|---|
| `activity-log.ts` | `ActivityKind` += `budget.created` \| `budget.updated` \| `budget.deleted`; `ACTIVITY_KIND_TO_KEY` += the three (`activityBudgetCreated/Updated/Deleted`) |
| `undo/use-undo-stack.ts` | `UndoEntityKey` += `"budget"`; `ENTITY_SINGULAR.budget`; `ENTITY_PLURAL.budget` (bulk shows a count); `ENTITY_KEY_SET` += `"budget"` |
| `i18n.ts` / `i18n.de.ts` | `activityBudgetCreated/Updated/Deleted`, `undoEntityBudget`, `undoEntityBudgets` |

`activityGroupOf` needs no change — `budget.*` falls to `"general"`, which is correct.

`onChangeBuckets` widens to `(next: BudgetBucket[], meta?: BucketCommitMeta) => void` in
`budget-panel.tsx` and `workspace-section-types.ts`. **`meta` is optional**, so every existing
caller and test compiles unchanged.

Call-site meta (`budget-panel.tsx`, one argument each): `addBucket` → `{kind:"budget.created",
name}` · `updateBucket` → `{kind:"budget.updated", name}` · `removeBucket` →
`{kind:"budget.deleted", name}` · `setCell` / `setDisciplineCell` / `applyBucketOrder` / the modal
save at `:674` → `{kind:"budget.updated", name}`.

**Coverage:** try `use-budget-buckets.ts` **measured** first — slice C proved a new `.ts` hook can
pass the gate on the consuming panel's suite, and "exclude UI glue" is a fallback, not the default.

### 4.3 `HoursCell` commit boundary

Without this, D3 turns typing `40` into 2 undo entries and 2 activity rows.

- Local `draft` state seeded from the prop value; `onChange` updates the draft only.
- Commit on **blur** and on **Enter**; **Escape** reverts the draft and blurs.
- A `committedRef` guard so blur-after-Enter cannot double-commit (the `useInlineCellEdit`
  pattern; that hook itself is not reusable — its `InlineField` union is task-row-specific).
- Commit only when the parsed value **differs** from the prop, so tabbing through cells writes
  nothing.
- The readonly (budget-follows-plan) input keeps `readOnly` and stays uncommitted.
- The displayed value while not editing keeps coming from the prop, so an undo/redo that changes
  the underlying number is reflected immediately.

### 4.4 Manual % inline (Budget panel)

A numeric input in each bucket card header, beside the name/PO line.

- `aria-label={`${t(lang,"budgetPercentComplete")} – ${bucket.name}`}` — **row-unique**. Budget is
  in `A11Y_VIEWS` and scanned across 5 schemes, and axe reports *missing* names, never *duplicate*
  ones; N identical "Manual % complete" labels is a WCAG 2.4.6 failure that passes the gate.
- Same draft/blur/Enter/Escape commit discipline as 4.3 (it writes through the same boundary).
- Blank clears to `undefined`, **not `0`** — `bucketPercentComplete` treats a manual `0` as a real
  override that wins over the derivation (`budget-earned-value.ts:29`), so clearing to `0` would
  pin the bucket at 0 % forever.
- Clamp 0–100 through the same path the modal uses (`budget-bucket-modal.tsx:227`); out-of-range
  input is clamped, non-numeric is rejected (draft reverts).
- Placeholder = the derived value from `bucketPercentComplete(bucket, tasks)` when there is one,
  else `—`. The panel already takes the list — but as **`tasks?: readonly Task[]`
  (`budget-panel.tsx:178`), which is OPTIONAL**: a caller that omits it (and every existing test
  that does) must fall back to `—`, never crash and never render a derived value of 0 %. Reuse
  that prop; do not add a second tasks prop.

### 4.5 Task-modal field

- A `<select>` in `TaskFormFields`: `(none)` + one option per bucket, labelled by bucket name.
- **Props, not context**: `budgetBuckets: readonly BudgetBucket[]`, plus the selection value and
  setter. Optional props with sane defaults so the bare-render tests are untouched.
- Rendered only when the budget module is enabled (`isModuleEnabled("budget", features)` — passed
  in, since the fields component already receives its gating flags as props).
- **Selection state lives in the editor buffer**, not in `TaskFormDraft` — a bucket link is not a
  `Task` field and must not leak into the task's sanitizer/serializer.
  - Extend `useTaskEditorBuffer` with `pendingBucketId: number | null | undefined`
    (`undefined` = untouched), `stageBucket(id)`, and a `flush(parentId)` arm that calls the new
    `applyBucket(parentId, bucketId)` dep. `discard()` clears it.
  - **Edit mode** seeds from `bucketIdForTask(budgets, editingId)` when the editor opens, and
    applies on submit against `editingId`.
  - **Create mode** stages, then `flush(mintedId)` applies after the id exists — the exact reason
    the buffer exists.
- `applyBucket` calls `moveTasksToBucket(budgets, [taskId], bucketId, stamp)` → `commitBuckets`.
  Because 4.1 returns by reference on a no-op, opening and saving a task without touching the
  field writes nothing.
- Jira-linked tasks are **not** excluded — the bucket link is local data Jira does not own.

### 4.6 Bulk op

- `task-form-context.tsx`: `BulkEditField` += `"budgetBucket"`; `emptyBulkEdit()` gains
  `budgetBucket: ""` and `enabled.budgetBucket: false`.
- `bulk-edit-modal.tsx`: one more `BulkEditFieldRow` with a `<select>` — `— none —` (unlink) plus
  one option per bucket. The row needs `budgetBuckets` as a prop (the modal is presentational).
- `use-bulk-operations.ts` `applyBulkEdit`: when `enabled.budgetBucket`, compute
  `nextBuckets = moveTasksToBucket(budgets, [...selectedIds], value, stamp)`.
  - Task fields also enabled ⇒ **one** `captureComposite` (`kind: "bulk.edit"`, parts = tasks +
    budgets) then both setters.
  - Bucket alone ⇒ `commitBuckets(nextBuckets, {kind:"budget.updated"})` and **no** `setTasks`
    call — the existing "only managed fields were enabled → nothing local to write" branch
    (`use-bulk-operations.ts:206`) already models this shape.
- `budgets`/`setBudgets` come from the `useWorkspace()` call the hook already makes
  (`use-bulk-operations.ts:57`).
- Bucket assignment is **not** a Jira-managed field, so it is not covered by the
  `jiraBulkManagedFieldsNote` and applies to Jira-synced rows too.

### 4.7 i18n (EN + DE)

New keys: `activityBudgetCreated`, `activityBudgetUpdated`, `activityBudgetDeleted`,
`undoEntityBudget`, `undoEntityBudgets`, `taskBudgetBucket` (field label),
`budgetBucketNone` (the `— none —` option). Reuse `budgetPercentComplete` +
`budgetPercentCompleteHint` for the inline cell.

★ `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts — patch via a node utf8 write, then
grep-verify. Positional placeholders are 0-based (`{0}`).

---

## 5. Test plan

Every test below must be **mutation-proved**, and the roadmap's rule applies: assert the headline
claim **first**, and read *which* assertion failed — `expected false to be true` from a
precondition is not proof.

**`budget-task-link.test.ts`** (pure, the bulk of the value)
- move adds to target and removes from the previous bucket in one call
- multi-task move across several source buckets
- `target: null` unlinks without adding anywhere
- **no-op returns the same reference** (`expect(out).toBe(input)`) — assert reference identity, not
  deep equality; deep equality passes for a fresh copy and proves nothing
- unknown target id ⇒ input by reference, **and the ids are still linked where they were** (the
  mutation that turns this into an unlink must fail)
- untouched buckets keep their **object identity** and their old `localModifiedAt`
- `bucketIdForTask` returns the first match when a workspace holds a duplicate link

**`use-budget-buckets.test.tsx`**
- created / deleted / edited each produce the right kind and one capture
- an unchanged array ⇒ **no capture, no log, no setBudgets**
- explicit `meta.kind` overrides the derivation
- `tasksPart` present ⇒ `captureComposite`, not `capture`

**Undo lockstep** — extend the existing sweep in `undo/use-undo-stack.test.tsx` (it already walks
every row-entity prefix in `ACTIVITY_KIND_TO_KEY` and fails on a generic label). `budget` must be
picked up by that sweep with **no test-side allowlisting**; verify by deleting the `ENTITY_KEY_SET`
entry and watching the sweep go red.

**`HoursCell`** — typing 3 characters commits **once** on blur; Escape reverts and commits nothing;
Enter commits and a following blur does not commit twice; an unchanged value commits nothing.

**Manual % inline** — blank clears to `undefined` (assert the committed patch, not the rendered
value: `0` and `undefined` both render as an empty box, so a value assertion is vacuous here);
`>100` clamps; the accessible name contains the bucket name; two buckets ⇒ two **distinct**
accessible names (the axe blind spot).

**Task modal** — create mode: save a new task with a bucket selected ⇒ the *minted* id lands in
`bucket.taskIds` (seed a workspace where the pre-mint id is already taken by another row, so a
regression to the open-time id is caught); edit mode: switching buckets moves the id; opening and
saving with the field untouched writes **nothing** to budgets.

**Bulk op** — N tasks to one bucket in one apply; unlink; combined with a task field ⇒ **one** undo
entry; **write-direction** coverage (slice C's lesson: its read path was covered while removing
both persistence calls left the whole suite green) — assert the budgets setter was actually called
with the new links, not merely that the modal closed.

## 6. Gates, headroom, risks

| File | Now | Cap | After |
|---|---|---|---|
| `budget-panel.tsx` | 683 | 800 | +4.3/4.4, the roomy one |
| `task-form-fields.tsx` | 721 | 800 | +4.5 — **79 lines, tight**; if it goes over, extract the field, do not raise the cap |
| `task-manager.tsx` | 2973 | 2974 (baseline) | **1 line** — the hook swap must be line-neutral |
| `tasks-section.tsx` | 1069 | 1073 | 4 lines |
| `workspace-section.tsx` | 960 | 966 | 6 lines |
| `bulk-edit-modal.tsx` | 390 | 800 | fine |
| `use-bulk-operations.ts` | 419 | 800 | fine |
| `budget-bucket-modal.tsx` | 762 | 800 | **untouched** |

★ The ratchet is a design input, not an obstacle (slice F): if a file is over, extract — do not run
`check-file-sizes.mjs --update`, because every later slice cites the precedent.

Other gates: **axe** — Budget is scanned × 5 schemes; run
`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Budget"` before pushing, on a fresh
isolated port if `globals.css` was touched (it should not be). **dup:check** is blocking — the
draft/commit logic in 4.3 and 4.4 is the same shape twice; extract one small shared helper rather
than copy-paste it. **Coverage** floors are blocking and `test:run` does not enforce them.

**Risks**

1. *`HoursCell` commit-boundary regression.* It is the only change to behaviour that already ships.
   A user who types and immediately clicks a different view could lose the keystroke if commit is
   wired to blur alone and the unmount skips it — commit on Enter **and** blur, and verify the
   modal-close path.
2. *Undo entity half-wired.* Covered by the sweep test above; do not merge without watching it
   fail on a removed registration.
3. *Composite fragment ordering.* `captureComposite`'s **first** non-null fragment is the primary
   delete whose id-remap drives cascades. Bulk edit deletes nothing, so ordering is cosmetic here —
   but pass the tasks fragment first to match every other composite call site.
4. *Derived-% placeholder cost.* `bucketPercentComplete` runs per bucket per render; it is a filter
   over `taskIds`, so trivial — but do not compute it inside the input's render on every keystroke;
   derive it once per bucket.

## 7. Release chain

Bump `src/app/version.ts` (`APP_VERSION` + milestone codename — grep `CHANGELOG.md` **with the
quotes**, ~145 used; `Goss` was verified free at slice F), add the `CHANGELOG.md` entry. Slices C,
D and F shipped with **no** `versionHighlight*` key; this slice adds user-visible controls plus an
undo/logging behaviour change, so it likely **does** warrant one — confirm against `git show` of
the previous release commit, and if added, append to `APP_HIGHLIGHT_KEYS` with EN + DE strings.

Close by re-archiving per the header rule (merge + superset assertion).
