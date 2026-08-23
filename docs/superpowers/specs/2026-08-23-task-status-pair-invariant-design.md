# The `status` / `completedDate` pair invariant — design

**Date:** 2026-08-23
**Closes:** `docs/open-followups.md` §182, §183
**Opens:** §226
**Branch:** `fix/task-status-pair-invariant` (off `origin/main` at `2a1cfdef`)
**Target release:** 0.257.0 "Shepard"

---

## The invariant, and who holds it today

`AGENTS.md` states it: **`status === "Done"` ⟺ `completedDate` set.** It is held by the
WRITERS, not at load — `migrateTask` only backfills an ABSENT or INVALID status and returns a
VALID-but-inconsistent pair untouched.

Four paths write the pair. Verified by reading each one, 2026-08-23:

| Writer | Holds it? | Mechanism |
|---|---|---|
| `applyStatusChange` (`task-status.ts`) | yes | by construction — `Done` stamps a date, every other status clears it |
| Jira PATCH-application (pull / create / read-only, `use-jira-sync.ts`) | yes | `issueToTaskFields` derives BOTH fields from one `statusKey` read, so they cannot disagree |
| `sanitizeSeedTask` (`templates.ts`) | **no** | reads the two fields independently off the raw seed — §182 |
| Jira CONFLICT merge (`handleResolveConflicts`, `use-jira-sync.ts`) | **no** | writes `completedDate`; `status` has no branch — §183 |

The split in `use-jira-sync.ts` is WITHIN one file: its pull path holds the invariant and its
conflict path breaks it. Scope any claim about that file to the path.

## Why a split pair is a real defect

`task-closed.ts` exposes two questions that read DIFFERENT fields — `isTaskClosed` reads
`status`, `isTaskDelivered` reads `completedDate` — and `isTaskOutOfScope` is the conjunction
`isTaskClosed && !isTaskDelivered`. A split pair answers them incoherently, in both directions:

**(a) `Done` with no date** — CLOSED and never DELIVERED, i.e. out of scope.
`computeDashboardProgress` (`dashboard.ts`) leaves it out of the numerator AND removes it from
the denominator, so a task the user just watched go Done stops contributing to completion % in
either term **and raises the percentage reported for every other row**. `computeStats`
(`reports-stats.ts`) files it under `cancelled` — the bucket whose own comment reads "closed
without being delivered" — so a resolved task is reported as cancelled scope.

**(b) a date on a non-`Done` row** — OPEN and DELIVERED at once. The dashboard counts it in the
numerator AND keeps it in the denominator (out-of-scope requires CLOSED, which it is not).
`computeStats` takes the delivered branch first, so it lands in `completed` and in the
on-time/late split and never in `open`. `visible-task-rows.ts` filters hide-finished on
`isTaskClosed`, so the table goes on listing it as an open row while Reports calls it complete.

Same render, two tiles, opposite answers about one task.

---

## Decision 1 — template import (§182): the DATE wins

`sanitizeSeedTask` reads `status: raw.status as Task["status"]` (a bare cast, no validation)
and `completedDate` through `sanitizeIsoDate`, independently, then returns `migrateTask(task)`.
`migrateTask` does not repair the result: its only status write is guarded `if (!statusOk)`, and
a template's valid status makes `statusOk` true.

**Rule adopted:**

| seed | result |
|---|---|
| `completedDate` set | `status = "Done"` |
| no `completedDate`, `status === "Done"` | `status = DEFAULT_TASK_STATUS` |
| anything else | unchanged |

**Nothing is invented and no date is deleted.**

Rejected alternatives, and why:

- **Status wins.** Would have to invent a delivery date for a `Done` seed with no date (the
  import day is a fabricated fact that then flows into on-time/late reporting and earned value),
  or delete a real date for a non-`Done` seed. Both write worse data than they fix.
- **Templates carry no completion at all.** Has a genuine domain argument —
  `templateFromWorkspace` copies live `Task` objects verbatim, so a captured finished task
  re-seeds a NEW project with a delivery date earned in a DIFFERENT one. Rejected as a larger
  behaviour change that discards data the capture deliberately kept; recorded here so the
  argument is not lost.

Rationale for the direction chosen: it is the direction the repo already normalises in
(`migrateTask` derives status from `completedDate` when status is untrustworthy), and `status`
is the LESS validated of the two fields on this exact path.

### Placement

One new pure export in `task-status.ts`, beside `applyStatusChange` and `migrateTask`:

```ts
export function reconcileStatusFromDate(task: Task): Task
```

The narrow name and its docstring are load-bearing. A generic `reconcileStatusPair` is precisely
what a later contributor would apply to the Jira merge — where it is WRONG, because Jira's status
comes from `statusCategory` and not from date presence, so it would overwrite a real remote
status ("In Progress" on a reopened issue) with a guess. The docstring must say FOR SEED/IMPORT
DATA ONLY and say why.

Called from `sanitizeSeedTask` wrapping the existing `migrateTask(task)`, so reconciliation is
the last word. **Order is provably immaterial here** — `sanitizeSeedTask` never assigns
`createdDate`, so `createdOk` is false and `migrateTask`'s `if (statusOk && createdOk)`
short-circuit never fires, and all four quadrants land identically either way. Reconcile-last is
chosen for readability, not for correctness.

★ Do NOT teach `migrateTask` to reconcile instead. It runs on all six load paths, so that would
change every backend's load behaviour, and `AGENTS.md` records that the invariant is held by the
writers and that `migrateTask` only backfills an ABSENT/INVALID status.

---

## Decision 2 — the Jira conflict merge (§183): both halves from ONE side

### What breaks today

`handleResolveConflicts` seeds `const merged: Task = { ...original }` (the LOCAL row) and then
overwrites, per conflict field, whichever side the user picked. `completedDate` has its own
branch. `status` has NO branch and cannot have one: it is not a member of `ConflictFieldKey`,
and `diffTaskAgainstIssue` never offers it.

**Both failure directions are the default path.** `jira-conflicts-modal.tsx` seeds every pick to
`"remote"`, and the merge falls back to `"remote"` again for any key the resolution omits — so
both are reached by opening the modal and pressing confirm without touching the completion row:

- **Local Done, issue reopened in Jira.** The patch's `completedDate` is `undefined`, so it
  differs and is offered. Accepting remote clears `merged.completedDate` and leaves
  `merged.status === "Done"` → direction (a).
- **Local open, issue completed in Jira.** The patch carries a real date, it is offered, and
  accepting remote writes it while `status` stays non-`Done` → direction (b).

Picking LOCAL for `completedDate` is consistent in both directions, because `status` is already
the local one. It is the REMOTE pick — the default — that splits the pair.

It can self-heal: the merge clears `localModifiedAt` and stamps `lastSyncedAt`, so the next sync
in which the issue changes takes the plain pull branch, which writes both fields off one patch. A
row whose issue never changes again stays inconsistent indefinitely.

### The fix

Treat the `completedDate` conflict as what it already is — a COMPLETION decision — and write both
halves from the side the user picked.

`ConflictItem` (`jira-api.ts`) gains one field:

```ts
export type ConflictItem = {
  taskId: number;
  jiraKey: string;
  jiraIssueType?: string;
  /** Whether the remote issue is currently Done (statusCategory.key === "done"). */
  remoteDone: boolean;
  /** The remote issue's mapped workflow status, carried so the conflict merge can
   *  write `status` and `completedDate` from the SAME side. */
  remoteStatus: TaskStatus;
  fields: ConflictField[];
};
```

The construction site needs no new computation — it already builds the patch two lines above:

```ts
const patch = issueToTaskFields(issue, todayNow);
...
conflictItems.push({
  taskId: row.id,
  jiraKey: issue.key,
  jiraIssueType: row.jiraIssueType ?? patch.jiraIssueType,
  remoteDone: isIssueDone(issue),
  remoteStatus: patch.status,   // non-optional: return type is Partial<Task> & { status: TaskStatus }
  fields: diffs,
});
```

and the merge's `completedDate` branch also writes `status`:

```ts
} else if (field.key === "completedDate") {
  merged.completedDate = typeof value === "string" && value ? value : undefined;
  merged.status = pick === "local" ? original.status : conflict.remoteStatus;
  completionChanged = true;
}
```

### Why this option and not the three the register named

- **Add `status` to `ConflictFieldKey`** — produces two independent rows, "Status" and
  "Completed date", so the user can pick local for one and remote for the other. That is a UI
  that lets the broken pair be constructed by hand. Worse than today.
- **Re-derive `status` from the resolved `completedDate`** — date present ⇒ Done; absent ⇒
  unknowable. A reopened issue may be In Progress or To Do and this option has no access to
  which, so it would guess.
- **Route the merged row through `applyStatusChange`** — `completedDate: task.completedDate || today`
  stamps `today` over Jira's real resolution date. This is exactly why every other Jira write
  site bypasses that engine. Already known wrong.

**Why the chosen option is correct rather than merely different:** it holds the invariant by the
SAME mechanism the pull path already uses, not by a new rule. `issueToTaskFields` derives
`completedDate` and `status` from one read of `f.status.statusCategory.key` — `isDone` picks the
date branch, `jiraCategoryToStatus` the status — so the two cannot disagree. Taking both from
that one patch inherits the guarantee. The local side inherits the same guarantee from
`applyStatusChange`, which produced the local row. No date is invented, no status is guessed, and
no pick combination yields a split pair.

### Surface

The completion conflict row must state that the pick also moves the status, or a status change is
hidden behind a date label. One new i18n key pair (EN + DE).

★ `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts there — write it via a node utf8 write
and re-verify. The `i18n-encoding` test BANS ASCII substitutions (`fuer`/`druecken`) and
`\u00XX` escapes.

★ The Jira conflicts modal is NOT in `A11Y_VIEWS`, so no axe run is involved. RTL coverage is the
only coverage this label will have.

---

## What this slice does NOT fix — §226

When the remote **status** differs but the **date** does not — local "In Progress", remote
"To Do", neither carrying a `completedDate` — no completion row is queued, so `status` stays
local. The pair remains internally consistent, so this is not §183; but the conflict path
silently ignores a remote status change, and a user who picked "remote" for every other field
still keeps a stale local status indefinitely.

Filed as **§226**, not fixed here. Fixing it means deciding whether `status` should be diffed at
all on the conflict path, which reopens the "can the user arbitrate this independently" question
Decision 2 deliberately closes.

★ **§225 is deliberately skipped.** It is claimed by the parked branch
`feat/timelog-booking-review-tl1`, which is unpushed, so the number is NOT yet reserved on
`origin/main` (max there is 224 as of 2026-08-23). Taking 225 here would mint the same number
twice — the failure this register has already recorded happening twice (§202 → §214 → §215).
The gap closes when TL1 merges; if TL1 is abandoned, the gap is permanent and harmless.

---

## Testing

Every test below runs under `vitest` in jsdom or node. **Nothing in this slice requires a
workstation, a live Turso database, a Jira instance or a desktop application.**

### `reconcileStatusFromDate` (new, pure)

- All four quadrants: date+Done (unchanged) · date+non-Done (→ Done) · no-date+Done
  (→ `DEFAULT_TASK_STATUS`) · no-date+non-Done (unchanged).
- Idempotence: applying it twice equals applying it once.
- An `fc` property over `status × completedDate` asserting the invariant holds for every input.
  ★ `fc.date()` can emit an Invalid Date whose `.toISOString()` throws — pass
  `{noInvalidDate: true}` or map an integer ms range to `new Date(ms)`.
- A mutation check with a **landed-mutant assertion** (throw if the replace no-ops) and an
  immediate revert. A silent no-op replace produces a green run that reads as proof when it is
  vacuity.

### Template import integration

Through `sanitizeTemplates` (`sanitizeSeedTask` is not exported): an inconsistent seed comes out
consistent, in both directions.

★ No built-in template carries a `completedDate` (`grep -n completedDate src/app/templates-builtin.ts`
returns nothing), so the fixture must be a hand-written template JSON, not a built-in.

### The conflict merge — first-ever coverage of this arm

★★★ **Every existing conflict fixture in `use-jira-sync.test.tsx` mocks `diffTaskAgainstIssue` to
return a `taskName`-only diff** (four sites). The `completedDate` arm of the merge loop has never
executed under the suite, despite four `picks` objects naming `completedDate`. A new test that
forgets to widen that mock **passes against the unfixed code**.

Required cases, each of which must be RED before the fix:

- (a) local Done + date, remote reopened, pick remote → `status` becomes the remote status,
  `completedDate` cleared, pair consistent.
- (b) local open + no date, remote completed, pick remote → `completedDate` set to the remote
  date **and not to today**, `status` becomes `"Done"`, pair consistent.
- (a) and (b) with pick **local** → the local pair survives unchanged.
- A pair-consistency assertion helper applied to the merged row in every case, so the property is
  asserted rather than the two fields being spot-checked.

### Modal

RTL assertion that the completion row carries the new label.

---

## Documentation

- **`AGENTS.md`, task-status bullet.** Its ★★★ block currently states four writers of which two
  hold the invariant "by neither" mechanism. After this slice all four hold it, and the block
  shortens substantially. This rewrite is part of the slice, not a follow-up. ★ A correction is a
  NEW claim and inherits none of the verification of the thing it corrects — re-run a command
  against the REPLACEMENT text.
- **`docs/open-followups.md`** — close §182 and §183 with what was decided and why; open §226.
- **`CHANGELOG.md`** and `src/app/version.ts` → **0.257.0 "Shepard"** (`APP_VERSION`,
  `APP_BUILD_DATE`, `APP_MILESTONE`), plus the five ungated places that also carry the version:
  `package.json` `version`, BOTH `package-lock.json` occurrences (root and `packages[""]`), the
  README shields badge (version AND codename), and the `<!-- Generated: … -->` header on all five
  `docs/CODEMAPS/*.md`.
  ★ The plan must re-verify "Shepard" is unused with a case-INSENSITIVE grep before stamping it: a case-SENSITIVE
  check passed "VanderMeer" while `grep -ci` found it at 0.96.0, which is how this spec first
  named an already-used codename.
  ★ The version may need RE-STAMPING if another branch merges first.

---

## Gates

`npm run test:run` (or a targeted subset during development) · `npx tsc --noEmit` ·
`npm run lint` · `npm run docs:symbols:check` · `npm run docs:claims:check` ·
`npm run size:check`.

★★★ Never read a gate's exit code through a pipe — redirect to a file, check the exit code
unpiped, then read the file.

★ No axe run: the Jira conflicts modal is not in `A11Y_VIEWS`, and this slice adds no control to
a scanned view.

★ Never run two vitest processes concurrently.

---

## Out of scope

- **§181** (`stampField` omitted on four registers' bulk capture). Not the same defect, and the
  register is explicit that deciding it requires first establishing how each of the six backends
  uses `localModifiedAt` — "harmonising the five sites in either direction is a BEHAVIOUR change
  on four registers, not a consistency cleanup". A research slice of its own.
- Diffing `status` on the conflict path — §226 above.
- Any change to `migrateTask`'s load-path behaviour.
- Any change to the three Jira PATCH-application sites, which already hold the invariant.

---

## Release posture

The version bump lands on the branch. **Nothing is pushed, no MR is opened, and nothing is
merged without the user's explicit instruction.**
