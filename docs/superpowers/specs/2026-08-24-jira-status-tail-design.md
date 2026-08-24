# Jira / task-status tail — design

**Slice:** `fix/jira-status-tail` → **0.258.0 "Mandelo"**
**Date:** 2026-08-24
**Branch point:** `main` at `08a3b26e` (0.257.1 "Shepard")
**Closes:** `docs/open-followups.md` §226, §228. **Narrows:** §227.

---

## 1. Goal

Close the two Jira/status defects that are wrong under any reading, make a remote
status change visible to the user instead of dropping it, and turn the question all
three follow-ups end on — *how many stored rows are actually split?* — from
unanswerable into a number.

## 2. Background — one root cause, three symptoms

`docs/AGENTS/task-status.md` states the invariant: **`status === "Done"` ⟺
`completedDate` set**. It is held by the WRITERS, not at load. `migrateTask` runs on
every load path but short-circuits before repairing a *valid but inconsistent* pair.
Three of the five writers hold the invariant unconditionally; the Jira CONFLICT merge
and the undo RESTORE hold it only given consistent input.

So a **split pair** can exist in stored data — written by a build older than 0.257.0,
hand-edited, or imported from a third-party template — and nothing reconciles it.
§226, §227 and §228 are all consequences of that gap, and all three end on the same
sentence: nothing has counted such rows, and nothing can without reading real
workspaces.

This slice does **not** close the data gap. It ships the changes that are defects
regardless of whether any row is split, and it ships the counter that should decide
whether the remaining question is worth answering.

## 3. What ships

### 3.1 §227a — the outbound Jira write reads the wrong half of the pair

`handleResolveConflicts` (`use-jira-sync.ts`) guards its transition on the DATE:

```ts
if (completionChanged && merged.completedDate && !conflict.remoteDone) {
  await transitionIssueTo(creds, conflict.jiraKey, "done");
}
```

`taskFieldsToJiraFields` pushes `summary`, `priority`, `labels`, `description` and
`duedate` — **no status**. So `transitionIssueTo` is the only route by which local
completion reaches Jira on this path, and it consults `completedDate` while
`docs/AGENTS/task-status.md` makes `status` the source of truth for "done".

**Change:** guard on `merged.status === "Done"` instead of `merged.completedDate`.

On a consistent pair the two agree and behaviour is unchanged. On a split row the app
stops moving a real Jira issue to Done while the local row reads "In Progress". No
stored field is rewritten, so this changes no promise made to the user.

★ Keep `completionChanged` and `!conflict.remoteDone` in the guard — the first scopes
the write to a resolution that actually touched the pair, the second avoids a
redundant transition.

### 3.2 §228 — one template, two behaviours, separated by a refresh

`templateFromWorkspace` puts LIVE `Task` objects into the seed by reference, and
`applyTemplate` (`template-apply.ts`) hands `tpl.seed` straight to
`remapSeed`/`appendSeed`. That file names no sanitiser, no `migrateTask` and no status
engine. `sanitizeSeedTask` (`templates.ts`) — which §182 taught to reconcile — is
reached only from the localStorage LOAD path in `use-settings.ts`.

Result: save a workspace as a template and apply it in the SAME session and the seed
is copied unreconciled; reload the page and the identical template applies through the
repaired path.

**Change:** export `sanitizeSeedTask` from `templates.ts` and map the seed's tasks
through it inside `applyTemplate`.

★ Same function as the disk path, so the two routes cannot drift. `templates.ts` does
not import `template-apply.ts`, so the new value import creates no cycle (verified:
`grep -rn "template-apply" src/app/templates.ts` returns nothing).

★ Fix at APPLY, not at SAVE. Reconciling in `templateFromWorkspace` would leave
templates saved by older builds unrepaired; apply is the only ingress into a workspace.

### 3.3 §226 — a remote status move the user is never shown

`diffTaskAgainstIssue` (`jira-api.ts`) queues a conflict row for every one of its eight
keys whose local and remote values differ, so every changed field IS offered — except
`status`, which is deliberately not a `ConflictFieldKey`. The merge reaches `status`
only from inside the `field.key === "completedDate"` branch, which requires the two
dates to differ.

When the remote status differs but the date does not — local "In Progress", remote
"To Do", neither carrying a date — no completion row is queued, `status` is never
written, and the row keeps its LOCAL status even though the user picked "remote" for
every field they were shown.

**Change, in three parts:**

1. Queue the completion row when **either** half differs: the existing
   `fieldsDiffer` test on `completedDate` becomes a pair test that also fires on a
   status difference.
2. Carry `localStatus` on the conflict beside the existing `remoteStatus` (which is
   already filled unconditionally at the queue site from a fourth `issueToTaskFields`
   patch).
3. Render the completion row in `jira-conflicts-modal.tsx` as the PAIR — status and
   date on each side — rather than the date alone.

★ The merge is unchanged: it already writes both halves from the side the user picked.

★ The modal already renders `jiraConflictCompletionNote` under this row, telling the
user the pick moves `status` too. That note is currently unreachable in exactly the
case it most needs to be true; this makes it reachable.

★ Nothing is applied silently. `status` remains outside `ConflictFieldKey` — the user
arbitrates the PAIR as one row, never its halves independently, which is the property
§183 established and this preserves.

★ i18n: EN + DE for any new or reworded string. DE takes real umlauts; the
`i18n-encoding` test bans ASCII substitutions.

### 3.4 The measurement

**`countSplitTaskPairs(tasks: readonly Task[]): number`** in `task-status.ts`, defined
as the negation of the documented invariant:

```ts
!!task.completedDate !== (task.status === "Done")
```

One expression. It also catches the `Cancelled`-with-a-stray-date case that
`reconcileStatusFromDate` clears, because such a row has a truthy date and a status
that is not `Done`.

**Surface:** `DiagnosticsPanel` takes an **optional** `splitPairs?: number` prop.

★ It MUST be a prop, not `useWorkspace()`. The panel is mounted TWICE —
`settings-sections/diagnostics-section.tsx` and `recovery-panel.tsx` — and recovery
runs precisely when the workspace is untrustworthy. A context read inside the panel
would be the same class of defect as a Kanban card calling `useTaskRowContext()`.
Settings passes the count; recovery omits it and the row does not render.

**Ring:** log once through `logDiag("warn", …)` with the count when it becomes
non-zero, so the number reaches the exported (redacted) diagnostic bundle a user can
send. Fired from the same consumer that computes it — no load-path edits.

★ NOT logged on every render, and not on every load: one entry per transition to
non-zero. The ring is capped at 200 and a per-render log would evict everything else.

★ No load-path edits at all. `migrateTask` has four call sites (`browser-backend.ts`,
`csv-codecs-decode.ts`, `markdown-codecs-decode.ts`, `workspace.ts`) and there is no
convergence point; `docs/AGENTS/task-status.md` separately forbids teaching
`migrateTask` to reconcile, because it would change every backend's load behaviour.

★ Diagnostics is the right surface BECAUSE this slice does not repair anything.
Telling an ordinary user "3 of your tasks have inconsistent completion data" while
offering no fix is worse than silence. Diagnostics is the support surface, and it
already redacts and exports.

### 3.5 §227b — deferred, with the reason recorded

The conflict merge's LOCAL arm stays a pass-through. Routing it through
`reconcileStatusFromDate` would repair a split pair in place and is a one-expression
change, but it rewrites a field the user was never shown and did not arbitrate, and it
picks the DATE as the winner in a conflict nobody was asked about.

§227 is rewritten to record that the decision is **waiting on what
`countSplitTaskPairs` reports**, not merely unmade. §226 and §228 are closed.

## 4. Explicitly out of scope

- Any repair of already-split stored rows (the data gap). That is a separate slice,
  gated on the counter.
- Teaching `migrateTask` to reconcile — forbidden by `docs/AGENTS/task-status.md`.
- Routing either Jira path through `applyStatusChange` — it would stamp `today` over
  Jira's real resolution date.
- §180 (bulk-edit undo restoring one half alone) — same data gap, different writer.

## 5. Testing

★★ **Every test for 3.1–3.3 needs a deliberately SPLIT fixture.** A consistent-pair
fixture passes whichever way the code decides, which is the same vacuity trap the
register already records for the ID-mint race. Seed the inconsistency explicitly.

| Change | Discriminating assertion |
|---|---|
| 3.1 §227a | `transitionIssueTo` is **not** called for a local pick on a row with a date but `status !== "Done"`; still called when `status === "Done"`. Mutating the guard back to `merged.completedDate` must go red. |
| 3.2 §228 | Applying a template built from a workspace holding a split row produces a RECONCILED row — without a reload. Pair with the existing post-reload path so both routes assert the same outcome. |
| 3.3 §226 | A conflict IS queued when the dates match and the statuses differ; the modal renders both halves; picking "remote" writes `conflict.remoteStatus`. |
| 3.4 counter | Table over the four pair combinations plus `Cancelled`-with-a-date. |
| 3.4 panel | Row renders when the prop is passed and is absent when it is omitted (the recovery mount). |

Gates: `npm run test:run`, `npx tsc --noEmit` (after ANY test edit), `npm run lint`,
`npm run test:shuffle` before push. Coverage floors are enforced in CI only —
`task-status.ts` is a coverage-gated pure engine, so the new function needs real tests
rather than incidental cover.

★ `jira-conflicts-modal.tsx` is a `.tsx` and therefore outside the coverage gate, but
it is reachable from an axe-scanned view; a new row in a table needs no new accessible
name, but re-check if any control is added.

## 6. Release chain

1. Bump `src/app/version.ts` — `APP_VERSION` `0.258.0`, `APP_MILESTONE` `"Mandelo"`,
   `APP_BUILD_DATE`.
2. `CHANGELOG.md` entry.
3. The five ungated version sites: `package.json`, `package-lock.json` (TWO
   occurrences), the README shields badge (version AND codename), and the header on
   all five `docs/CODEMAPS/*.md`.
4. `docs/open-followups.md`: close §226 and §228, rewrite §227. New entries, if any,
   start at **§231** (`origin/main` max is 230, measured).
5. Update `docs/AGENTS/task-status.md` — its "conflict merge is a PASS-THROUGH"
   section describes the transition guard and the local arm, and 3.1 changes one of
   them. Sweep for prose describing the OLD behaviour.

★★ **Re-verify the codename immediately before release.** "Mandelo" returns 0 hits in
`CHANGELOG.md` today. §44 records a reserved codename being consumed by an unrelated
release while a slice sat idle; a name reserved in a spec is not reserved in any sense
the next release can see.

## 7. Decisions recorded

| Question | Decision |
|---|---|
| Fix symptoms, measure, or close the data gap? | Measure + fix the defects. The gap is a later slice, gated on the number. |
| Where does the count live? | Live count in Diagnostics via an optional prop, plus one ring entry when non-zero. |
| Does §226 apply the remote status, or show it? | **Show it.** The user arbitrates the pair as one row. |
| Does §227's local arm normalise? | **Deferred**, pending the counter. |
