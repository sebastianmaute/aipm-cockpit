# Task status — the `status` ⟺ `completedDate` pair, and the closed/delivered split

Owns the task completion model: the pair invariant, every path that writes it and the mechanism
each one holds it by, why the load funnels do NOT repair a split pair, the
`isTaskClosed`/`isTaskDelivered` split, and the derivations that read one half or the other.

Does NOT own the Jira sync wire layer (`docs/AGENTS/integrations.md`), the Kanban board, the task
editor or the Open Points toolbar (all `AGENTS.md`), or the undo stack itself. One fact, one doc:
this file links there rather than restating them.

★★★ **`applyStatusChange` IS NOT THE SOLE WRITER OF THE PAIR.** FIVE paths write it — this engine
plus the FOUR below, each with a mechanism of its own — so do NOT "complete the pattern" by routing
one through another. That is the recurring defect on this surface, and every prohibition below
exists because someone tried it.

## The invariant and the engine

`Task.status` (To Do/In Progress/On Hold/In Review/Cancelled/Done) is the SOURCE OF TRUTH for
"done", but `completedDate` is AUTO-MANAGED to keep the invariant
**`status==="Done" ⟺ completedDate set`** — so the ~30 existing completedDate-based derivations were
left untouched.

Pure i18n-free engine `task-status.ts`: `applyStatusChange(task,next,today)` is the writer for every
LOCAL status mutation — form save, the inline dropdown, bulk edit, the Mark-done CTA, the AI
dispatcher and `handleCreateLinkedTask` all route through it.

## The five writers, and the mechanism each holds the pair by

**The engine** (above) writes both fields itself.

**Jira sync's three PATCH-APPLICATION sites** (pull, create, read-only): `issueToTaskFields` derives
BOTH fields from one `statusKey` read (`completedDate` through its `isDone` boolean, `status`
through `jiraCategoryToStatus`), so that patch's pair cannot drift.

**The Jira CONFLICT merge** (`handleResolveConflicts`): its `completedDate` branch writes
`merged.status` beside the date, BOTH from the side the user picked — remote from
`conflict.remoteStatus` (filled at the conflict-QUEUE site off a fourth `issueToTaskFields` patch),
local from `original.status`.

**Template import** (`sanitizeSeedTask`): its two reads of the seed are independent, so it ends by
calling `reconcileStatusFromDate`, which trusts the DATE for every status but `Cancelled` — a date
forces `Done`, a `Done` with no date demotes to `DEFAULT_TASK_STATUS`, and a `Cancelled` row's stray
date is CLEARED instead (status wins there — Cancelled is closed, never delivered).

**Undo/redo RESTORE** — `use-undo-stack.ts`'s `merge(patch)` writes a captured partial straight onto
the live row, and holds the pair only because `TASK_UNDO_GROUPS` (`undo/field-groups.ts`) forces
`status` and `completedDate` into ONE entry; delete that array row and the invariant breaks with
tsc, lint and every sweep below green — only `field-groups.test.ts` pins it
(`docs/open-followups.md` §180 is the adjacent gap).

## Prohibitions — do not route one path through another

★★★ DO NOT ROUTE EITHER JIRA PATH THROUGH `applyStatusChange` — it would stamp `today` over Jira's
real resolution date (`AGENTS.md`'s Kanban bullet carries the same reason for the pull path). The
prohibition on `reconcileStatusFromDate` stands too, but its long-stated reason ("it would rewrite a
reopened issue's genuine 'In Progress' into 'To Do'") is FALSE: that input falls through BOTH guards
and is returned by reference. The true reason is that it is a strict NO-OP on every Jira patch — it
writes `status` only for a date on a row that is neither Done nor Cancelled, `issueToTaskFields`
always pairs a truthy `completedDate` with `status === "Done"`, and `jiraCategoryToStatus` can never
emit `Cancelled` — so routing either arm through it buys nothing rather than protecting anything.
The hazard that IS real runs the OTHER way: a stale LOCAL date beside a non-Done status would be
promoted to Done — the §227 local-arm question, DEFERRED there; do not act on it without the user.

## Re-derive the two sets — never trust a list

★★ Re-derive both sets rather than trusting any list here: the engine's callers with
`grep -rn "applyStatusChange(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."` — which
also returns the declaration itself and one `change-log.ts` COMMENT, so it is not a caller count —
and the pair-writers with a sweep admitting BOTH the property-literal and the ASSIGNMENT shape (a
bare `completedDate:` misses `templates.ts` and the conflict merge outright;
`docs/open-followups.md` §180 carries a form that returns all four).

★★ BOTH shapes are STRUCTURALLY BLIND to the undo RESTORE above — neither returns a hit anywhere in
`src/app/undo/` — and the `use-task-row-handlers` hits they DO return are only the BEFORE/AFTER
capture; the write is in another file. `i18n`/`jira-conflicts-modal` are LABEL maps and the two
`*-codecs-decode` hits are load paths. Read the hit, don't count it.

## Load does NOT repair a split pair

★★★ THE LOAD-PATH REPAIR IS `migrateTask`, NOT `migrateTaskStatus` (no such function exists), AND
IT IS WEAKER THAN THIS DOC USED TO CLAIM. It runs on all six load paths but only backfills an
ABSENT/INVALID status (`completedDate` set → Done, else To Do) — `if (statusOk && createdOk) return
task;` short-circuits FIRST, so a *valid but inconsistent* `status:"To Do"` + `completedDate` pair is
NOT repaired. The invariant is held by the WRITERS, not at load — and only FOUR of the five hold it
UNCONDITIONALLY; the CONFLICT merge holds it only GIVEN CONSISTENT INPUT (below). That is a claim
about the paths in `src`, NOT about the DATA: an older build, a hand edit or a third-party template
can still have stored a split pair, and nothing reconciles it on load. §182 (`sanitizeSeedTask`) and
§183 record what each used to do and what a split pair costs. The old wording made readers conclude
load normalises the pair, and write that into code and commit messages.

★★ Do NOT close the remaining DATA gap by teaching `migrateTask` to reconcile: it runs on all six
load paths, so that changes every backend's load behaviour.

## The conflict merge is a PASS-THROUGH, not a normaliser

★★★ THE ONE THAT NEEDS THAT QUALIFIER: the CONFLICT merge is a PASS-THROUGH, not a normaliser.
`merged` is seeded `{ ...original }` and `status` is written exactly ONCE, so the `pick === "local"` arm assigns `original.status` over itself — a no-op. An
ALREADY-split local row therefore survives a local pick, and that same pick fires
`transitionIssueTo(…, "done")` while the row reads "In Progress". Reproduce — READ the hits, do not
count them; the file's own comment about this rule matches:
`grep -nE "merged: Task|merged\.status" src/app/use-jira-sync.ts`.

## Closed vs delivered (`task-closed.ts`)

`isTaskFinished`=Done|Cancelled; Cancelled is terminal-but-NOT-completed (excluded from
overdue/next-actions/health-red).

★★ SINCE 0.213.0 THE CALLER MUST SAY WHICH QUESTION IT IS ASKING — pure `task-closed.ts` exposes
`isTaskClosed(task)` (= `isTaskFinished`, Done|Cancelled → "will this be worked on again?": overdue,
schedule RAG, forecast, workload, row styling, chasing, the Gantt status filter, milestone at-risk)
and `isTaskDelivered(task)` (= `!!completedDate` → "was it delivered?": the completion-% NUMERATOR,
earned value, on-time/late, and anywhere a real date is shown). Cancelled is CLOSED but never
DELIVERED. Reading `!!completedDate` as "closed" is the bug that made cancelled tasks keep reporting
as open and overdue.

★★ THE CONSUMER LIST THAT USED TO SIT HERE WAS WRONG IN BOTH DIRECTIONS — it named eleven modules,
omitting two real importers and including one that imports NEITHER half of the split (only the
module's third export, `isTaskOutOfScope`, which the list never mentioned). Derive it, never quote
it:
`grep -rn "from \"./task-closed\"" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."`
prints each importer WITH the names it takes, which is the part a bare file list cannot carry.

## What the derivations count, and the surfaces

★ Completion-% counts Done only in the NUMERATOR, but since 0.213.0 cancelled work is dropped from
the DENOMINATOR (`dashboard.ts` `computeDashboardProgress`), so a project with cancelled scope can
reach 100%. Reports carry a third `cancelled` bucket — a cancelled task is neither open nor
completed there, and never overdue. UI labels via `task-status-ui.ts` (AIPM palette tokens only).

★ The table status column key is **`taskStatus`** — the pre-existing `"status"` col key is the
RAG/health DOT (header "Health"/DE "Ampel").

★ The tasks view ("Open Points") IS in axe `A11Y_VIEWS`, so the inline status `<select>` needs a
row-UNIQUE label (`Status – <task>`).
