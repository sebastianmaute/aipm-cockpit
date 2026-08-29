# §285 — the second save-guard invariant: destructive-save arming

**Status of this document:** design, approved 2026-08-29. Branch `fix/destructive-save-arming`,
off `main` at `3961777b` (0.263.2 "Okorafor").

**Goal:** every removal route for a slice that COUNTS toward the save-time data-loss guards must arm
the one-shot `allowDestructiveSave` bypass, so a deliberate deletion is not refused by the very guard
the counting armed — and a gate must fail when a new route arrives without that decision.

---

## 1. The problem

§284 added `workspace-slice-policy.test.ts`, which gates **which** slices count toward the
save-time data-loss guards: it parses the `Workspace` type and fails when an array slice carries no
recorded decision in `SLICE_POLICY`.

That is one invariant. There is a second, dependent one that nothing gates:

> Each COUNTED slice's removal routes must call `allowDestructiveSave`, so a user's own deliberate
> deletion is not refused by the guard.

**Seventeen routes do not.** Sixteen of them predate 0.263.1 — tasks, RAID, resources, milestones,
changes, stakeholders, absences, shifts and the reference data were all counted long before the
widening, so this is not a defect the widening introduced. §285 records one instance
(`deleteAllTasks`); the census below found sixteen more.

### How the gap keeps being found by hand

The `delete_document` instance surfaced during the §284 branch only by enumerating removal routes
FROM the counters — the widening never touched `use-document-tools.ts`, so a commit-by-commit review
could not have reached it. That is the argument for a gate that works from the counted set rather
than from a diff, and it is why this slice exists.

---

## 2. What the guard actually refuses — measured, not assumed

`evaluateSaveGuard` (`save-guard.ts`) is pure and returns a verdict from two invariants:

- `fullWipe` — `curCollections === 0 && prevCollections >= 2`
- `massDelete` — `isMassDeletion(prevRecords, curRecords)`
- `refuse` — `(fullWipe || massDelete) && !allowDestructive`
- `forensic` — `curCollections === 0 && prevCollections === 1`

`isMassDeletion(prev, cur, floor = 5, fraction = 0.1)` returns true when at least **5** records were
removed AND at most **10%** of the prior total remains. Those are parameter DEFAULTS, not constants —
read them at `isMassDeletion` rather than trusting this paragraph.

On refusal the save effect calls `recordDataLossEvent` with `refused: true`, emits the
`storageRefusedWipe` toast, and returns WITHOUT writing. The deletion stays on screen; it is never
persisted. The backend still holds the data, so a reload restores it — which is what makes this
survivable, and also what makes it invisible: the user sees an info toast and a UI that already shows
what they asked for.

### 2.1 Reachability, split honestly

This is the part a scope decision must not blur. **A single-record delete cannot trip a refusal on
its own:**

- `massDelete` needs at least 5 records removed; a single delete removes 1.
- `fullWipe` needs `curCollections === 0` with `prevCollections >= 2`; a single delete can only reach
  `curCollections === 0` from a workspace holding one record in one collection, and then
  `prevCollections === 1`, which is `forensic`, not `refuse`.

So the seventeen routes are NOT seventeen equal live defects. Three tiers:

| Tier | Routes | Reachability |
|---|---|---|
| **A — trivially reachable** | `deleteAllTasks`, `handleBulkDeleteResources` | One call clears or bulk-removes; on any register of at least 5 leaving at most 10%, refused today. |
| **B — reachable by aggregation** | the six other AI single-delete routes | Several tool calls in ONE model turn land inside one save debounce window and aggregate. A model deleting six risks from a six-risk register removes 6 and leaves 0, which is refused. |
| **C — defence in depth** | the nine UI single-delete handlers | Each is behind its own confirm dialog; five confirms inside one debounce window is not a realistic user action. Armed for CONSISTENCY with `documents-panel.tsx`, which already arms on every single delete for the aggregate reason, not because a live refusal has been demonstrated. |

**Tier C must not be described as a fixed user-facing bug** — in the CHANGELOG, in the register, or
in a commit message. The CHANGELOG entry covers tiers A and B. Tier C is an internal consistency fix.

---

## 3. The census — seventeen routes

Measured 2026-08-29 on `3961777b`, clean tree.

| Surface | File | Handlers |
|---|---|---|
| AI | `use-chat-dispatcher.ts` | `deleteTask`, `deleteAllTasks`, `deleteResource` |
| AI | `use-register-tools.ts` | `deleteRaid`, `deleteChange`, `deleteMilestone`, `deleteStakeholder` |
| UI | `use-resource-planner.ts` | `handleDeleteRaidItem`, `handleDeleteAbsence`, `handleDeleteShift` |
| UI | `use-resource-directory.ts` | `handleDeleteResource`, `handleBulkDeleteResources` |
| UI | `use-reference-data.ts` | `handleDeleteRole` |
| UI | `use-stakeholders.ts` | `handleDeleteStakeholder` |
| UI | `use-change-log.ts` | `handleDeleteChange` |
| UI | `use-calendar-events.ts` | `handleDeleteCalendarEvent` |
| UI | `milestones-panel.tsx` | `del` |

Already arming, and therefore out of scope: `use-bulk-operations.ts`, `task-manager.tsx`,
`knowledge-panel.tsx`, `documents-panel.tsx`, `documents-asset-section.tsx`,
`use-document-assets.ts`, `use-document-tools.ts`, `use-storage-backend.ts`.

**Reproduce the census — both legs are required.** The file-level count answers a DIFFERENT question
from the handler-level one: a file can mention the identifier for an unrelated pass-through, which is
why §285 records `use-chat-dispatcher.ts` as both mentioning it and not arming `deleteAllTasks`.

Leg 1 — which files remove records from a counted slice at all:

    grep -rnE "set(Tasks|Raid|Absences|Shifts|Resources|Roles|Disciplines|Grades|Budgets|Milestones|Changes|Stakeholders|CalendarEvents|Documents|KnowledgeItems|DocumentAssets)\(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\." | grep -E "filter\("

Leg 2 — per HANDLER, not per file. The control line is not optional: a `sed` range address fails
OPEN, so a moved anchor degrades the count to a guaranteed 0 with no diagnostic — the failure mode
§98 records against itself.

    sed -n '/deleteAllTasks: () => {/,/^      },/p' src/app/use-chat-dispatcher.ts | wc -l
    sed -n '/deleteAllTasks: () => {/,/^      },/p' src/app/use-chat-dispatcher.ts | grep -c allowDestructiveSave

The first is the control and must be non-zero; the second is 0 before this slice and 1 after.
`grep -c allowDestructiveSave src/app/use-register-tools.ts` returns 0 today.

---

## 4. The fix — one line per handler, at a site that already exists

Every one of the seventeen already resolves whether it changed anything, because activity logging
needs the same signal — `milestones-panel`'s `del` opens by resolving a `doomed` milestone,
`use-register-tools`' `deleteRaid` returns false when it finds none, and `deleteAllTasks` captures a
count before emptying.

The arming goes at that site, in the form `documents-panel.tsx` established: call
`allowDestructiveSave` only when the mutation reports it changed something.

**Never unconditional.** The bypass is a one-shot consumed by the next SAVE, so arming a run that
deleted nothing leaks it for an unbounded time: open a confirm for X, a concurrent writer removes X,
confirm anyway, the change flag is false, the bypass stays up, and a later accidental mass deletion
rides through both L3 and Layer B unchecked. `documents-panel.tsx` carries this reasoning in a
comment at its own arming site; it was a fix, not a precaution.

**Optional call, not required.** Every one of these surfaces renders in contexts that supply no
bypass — tests, popouts — so the prop stays an optional callback and every call site uses optional
invocation, matching `DocumentsPanelProps`.

### 4.1 Plumbing

Nearly none, and this is why the slice is shallow despite the file count.

- **`use-chat-dispatcher.ts` (3 handlers): zero plumbing.** `ChatDispatcherArgs` already declares
  `allowDestructiveSave` and already forwards it to `useDocumentTools`. The three handlers reach it
  through the same args object.
- **`use-register-tools.ts` (4 handlers): one optional field** on `RegisterToolsDeps`, plus one line
  at the `useRegisterTools` call site in `use-chat-dispatcher.ts` forwarding it.
- **The seven UI hooks and panels (10 handlers):** each takes the same optional dep from whichever
  owner already constructs it. The owner is `task-manager.tsx` for the hooks and the panel's own
  props for `milestones-panel.tsx`; the plan step for each file names its owner after reading it,
  because the hooks do not share one construction site.

No new abstraction over the seventeen sites. A factory wrapping "delete and arm" would have to model
seven different change-signal shapes and three different setter idioms, and would hide the one line
that matters at each site.

---

## 5. The gate — `destructive-save-arming.test.ts`

Three parts. The first is what §285 asks for; the second is what makes it more than a grep; the third
is what keeps it honest.

### 5.1 Completeness, derived rather than hand-written

`TOOL_DEFS` (`chat-tool-defs.ts`) is an exported array declaring every AI tool by name. Every entry
whose name begins `delete_` or `clear_` must appear in the test's registry with a recorded decision.
A new delete tool fails the suite until someone records one.

★★★ **THE CHECK MUST IMPORT `TOOL_DEFS`, NEVER SCAN ITS SOURCE FILE — and the difference is exactly
the route that motivated this entry.** `TOOL_DEFS` is COMPOSED: it spreads `DOCUMENT_TOOL_DEFS`
(`chat-tool-defs-documents.ts`), where `delete_document` is declared. So a source-level scan of
`chat-tool-defs.ts` finds **seven** delete tools and silently omits `delete_document` — the one whose
missing arming was §285's third instance, and the one a diff-driven review already failed to reach
once. Importing the array yields all of them. Measured 2026-08-29:
`grep -cE 'name: "(delete|clear)_' src/app/chat-tool-defs.ts` returns 7 and
`grep -c delete_document src/app/chat-tool-defs.ts` returns 0, while
`grep -n DOCUMENT_TOOL_DEFS src/app/chat-tool-defs.ts` shows the import and the spread.

★ A composed array can gain another spread later, so the test must assert the RUNTIME count it
enumerates is at least the number of registered routes — a check that reads zero tools passes
everything, the vacuity failure this repo records against its own gates.

This is the same shape as `workspace-slice-policy.test.ts` and it satisfies §285's actual
requirement: the enumeration is driven from the counted set and the tool declarations, NOT from a
diff, so a route in a file the branch never touched is still reachable.

### 5.2 Behaviour, per route, in two SEPARATE test blocks

For each registered route, invoke the handler against a stub that records arming:

- **block 1** — an id that EXISTS, or a non-empty slice for a clear-all: armed exactly once
- **block 2** — an id that does NOT exist, or an already-empty slice: NOT armed

Two mutants die, and each is killed by exactly one block: deleting the arming line kills block 1;
making the arming unconditional kills block 2.

**The two assertions MUST be separate test blocks, not two assertions in one.** Vitest aborts a test
at its first hard assertion, so in a single block the unconditional-arming mutant would leave the
leak assertion unexecuted — proved by nothing, while the suite reports green on the revert. This is
the ordered-spec mutation limitation recorded on the §284 branch; it cost a false "mutation-proved"
claim there and must not be repeated here.

**Each block must be shown to fail against its own mutant before the slice ships,** and the plan
records WHICH mutant backs WHICH block. An unqualified "mutation-proved" over the file is not an
acceptable report.

### 5.3 The bound, written into the test's own docstring

Completeness only works where a declaration exists to enumerate from.

- **AI surface: gated completely.** `TOOL_DEFS` is the declaration.
- **UI surface: hand-registered, completeness NOT gated.** There is no declaration of "routes that
  remove records"; a source scan for a setter called with a filter cannot distinguish a delete from
  an edit, and would need to model seven idioms to try.

The ten UI routes therefore get behavioural blocks like the others, but nothing fails when an
eighteenth UI route is added. That asymmetry goes in the test's docstring in the same words, and is
FILED as a follow-up rather than left implied — a gate whose blind spot is undocumented reads as
covering more than it does, which is the failure class this repo's register exists to prevent.

**Number the follow-up at write time**, not from this document: a register number is reserved only
once it is on `origin/main`, and two branches have already minted the same one. The maximum on
`origin/main` was 288 when this spec was written.

---

## 6. Testing

- **Per-route behavioural blocks** as in 5.2 — 34 blocks over the seventeen routes.
- **Completeness block** as in 5.1 — one, asserting every `delete_` and `clear_` tool in the IMPORTED
  `TOOL_DEFS` is registered, plus the anti-vacuity assertion that the enumeration is non-empty and at
  least as large as the registry.
- **A guard-level block** proving the arming actually reaches the verdict: `evaluateSaveGuard` with
  the bypass armed over a full-wipe input must not refuse. This is what ties the arming to the
  outcome; without it every other block proves only that a callback fired.
- **No new e2e.** The refusal path has no live-database dependency and the unit layer reaches it.
- Existing suites that must stay green and are the likeliest breakage: `use-chat-dispatcher.test.tsx`,
  `documents-panel.test.tsx`, `knowledge-panel.test.tsx`, and whatever covers the seven UI hooks.

### Gates

Run `npx tsc --noEmit` after ANY test edit — it exits **2** on diagnostics, not 1. Never read a gate's
exit code through a pipe; redirect, check unpiped, then read the file. Never run two vitest processes
at once. Logs go in the session scratchpad, never `/tmp`.

`use-storage-backend.ts` and the seven UI files grow by a line or two each. `size:check` counts
`wc -l` plus 1, and `use-storage-backend.ts` has a history of sitting exactly at its baseline (§229) —
read the real number with a `readFileSync().split` line count before budgeting, not with `wc -l`.

Every file under `src/app` is CRLF: never patch with a line-feed-only anchor, and never use the Write
tool on one — it re-lines the file to LF invisibly to `git diff`.

---

## 7. Non-goals

- **The guards themselves.** No change to `evaluateSaveGuard`, `isMassDeletion`, its thresholds, L3
  or Layer B. If the thresholds are wrong, that is a different entry.
- **§98, §241, §242.** Open BY DECISION as records, not because code is broken. Closing them means
  deciding, not fixing.
- **§286, §287, §288.** Slice 2, already designed at the cluster level: the note-log policy
  extraction, the storage-handle capture-and-restore, and the AI-seed allow-list.
- **A UI-surface completeness gate.** Explicitly out — see 5.3. Filed, not built.
- **Refactoring the seventeen sites** behind a shared helper. See 4.1.
- **`isWorkspaceEmpty`.** Untouched, as in the §284 slice.

---

## 8. Release

This slice BUMPS. A false save refusal on a deliberate delete is user-visible for tiers A and B.

- `src/app/version.ts` — APP_VERSION, APP_BUILD_DATE, milestone
- `npm run version:sync` — never hand-edit the other five places; `version-sync-check` is blocking
  and exits **1 on drift**, **2 when it cannot scan at all**
- `CHANGELOG.md` — tiers A and B only, in user-facing language. Never a session URL.
- `docs/open-followups.md` — closing §285 is a FOUR-place edit: the heading, the summary-table status
  cell, the table anchor, and the `**Status:**` witness. A body line must never contain the word
  CLOSED. The new UI-completeness entry needs a conforming `**Status:**` line — an ISO date plus
  either a backticked command or the literal `never machine-verified`.
- Register prose cites SYMBOLS, never a path with a line number — `docs/open-followups.md` is inside
  `doc-claims-check`'s scan set and that gate is a ratchet.
- **Push, MR and merge are gated behind the user saying "release".** The plan must not authorise them.
