# Timelog booking review — TL1: comments, interval job, delta

**Date:** 2026-08-23
**Status:** design approved, unstarted
**Closes:** `docs/open-followups.md` §224
**Opens:** the TL1–TL4 arc below; §616 (probe for an undocumented TimeLog approval write)

---

## Problem

Timelog bookings are fetched only on demand. Nothing polls, and a fetch replaces the cached
aggregates without ever saying what changed. Separately, the booking's own **comment** — the one
field that would let a human cross-check what was booked against what was done — is not read at
all.

The end goal the user stated is larger than this slice: accept or refuse individual bookings, and
have the AI assistant read them and learn from those decisions. That goal is decomposed below;
this spec designs **TL1** only.

---

## Scope — the decomposition

Four slices, each shippable on its own.

| | Scope | Depends on |
|---|---|---|
| **TL1** *(this spec)* | comment on the wire · per-booking drill-down · interval job · delta per person per role | — |
| **TL2** | upstream verdicts, read-only: `TimeRegistrationApprovalStatus`, `RejectedRegistrations`, `LastRejectedComment` | TL1 |
| **TL3** | redaction rules — Turso table, Settings UI, JSON import/export, deny + non-person allow | — |
| **TL4** | AI reads bookings; learns from upstream and local verdicts | TL2, **TL3** |

★★★ **TL3 before TL4 is not a preference.** It is the only thing standing between employee
free-text comments and a third-party model API. TL4 must refuse to run when rules cannot be
loaded — see "Cross-cutting decisions" below.

---

## Cross-cutting decisions — settled now, inherited by TL2–TL4

Recorded here so later slices do not re-litigate them.

### 1. The app is a READ front-end for TimeLog's approval; it does not write back

Verified 2026-08-23 against the public REST documentation by sweeping **all 63 documented
services** for any method named `approve|reject|decline|deny`. The only three hits are
`approvaltimesheet_getstatusbyperiodwithrejectedtimetrackingitems`,
`approvaltimesheet_resubmitrejectedtimeregistrations` and
`timeregistration_deleteapprovedabsence` — two readers and the employee's own resubmit.

Every `approval/timesheets/*` method is employee-side: `submit-time-registrations`,
`submit-dates`, `submit-period`, `resubmit-rejected-time-registrations`, and the
`get-status-by-*` readers. **The manager's approve/reject action is not exposed.**

★★ This is a claim about the DOCUMENTED API only. TimeLog's own UI can plainly reject — its read
models carry `RejectedRegistrations`, `LastRejectedComment` and `RecentRejectedComment` — so an
undocumented endpoint almost certainly exists. This repository already depends on one
undocumented endpoint (`/v2/projects/{id}/time-registrations`), but that is a READ. Hanging
writes into a system that drives invoicing and payroll on a reverse-engineered endpoint is a
different risk class: it can change without notice, and a wrong write is not fixed by a redeploy.
Recorded as §616; a decision to write back is a separate slice with its own security review.

**The consolation is the point:** rejections and their comments are readable. A manager's
verdict, with its reason, is a real corpus of human accept/reject decisions — which is what TL4
needs — obtained with zero write risk.

### 2. Pseudonyms are STABLE, and the map never leaves the device

Each person gets a stable synthetic id, consistent across fetches and sessions. A recipient
model therefore sees a synthetic id and never a name, while we retain the ability to correlate a
person's history — without which "learn from acceptance or rejection" can only ever learn about
text, never about a pattern of behaviour.

Re-identification is possible **locally only**, by whoever holds the map. Stability gives the
recipient no more information than a per-request scheme would; the difference is entirely in what
*we* can correlate before sending.

### 3. Redaction rules live in Turso ONLY

Rules are a new table, **out of `TABLE_NAMES`** — otherwise a workspace save's per-table `DELETE`
sweep wipes them. They are not workspace data: never exported, never in `CONFIG_KEYS`.

`operating_guides` is the near-exact template — Turso-only, out of `TABLE_NAMES`, and its DDL
already carries `enabled`, `priority` and `built_in`, which is precisely the "user-set rules win"
mechanic. Verify the precedent with:

```
grep -n "CREATE TABLE IF NOT EXISTS operating_guides" src/app/operating-guide-schema.ts
grep -rn "not.toContain" src/app/learning-store-turso.test.ts
```

★★★ **Turso-only rules make TL4 Turso-GATED, and the gate is a safety property, not a nav
convenience.** In file mode there are no rules, so an ungated TL4 would send *unredacted* comments
to Anthropic. It must refuse visibly, the way the documents-images slice refuses under Safe Mode.
Nav-gating via `TURSO_ONLY_VIEWS` is not sufficient on its own; the panel runtime-guards too, and
gates on `tursoConfig !== null` rather than on `storageConfig.kind === "turso"`.

★ Rules are per-Turso-DB, so a team shares them. One person's edit changes what leaves for
everybody — the Settings surface must say so.

### 4. Rules are DENY plus ALLOW, with ALLOW restricted to non-person entities

A rule may add redaction, or exempt a term the automatic rules would have caught. **An ALLOW rule
may never un-redact a person or a customer** — only project names, codenames, task titles and
similar non-person entities.

The reasoning, kept because it will be re-argued otherwise: over-redaction genuinely degrades the
feature (an AI cross-checking comments in which every project is `[redacted]` cannot do much), and
that failure is visible and recoverable. Under-redaction is silent and **unrecoverable once
sent**. Restricting ALLOW to non-person entities keeps the escape hatch that makes the feature
useful without letting a rule edit become a personal-data disclosure.

### 5. Redaction matches against our OWN entity lists, not generic PII regexes

Resources, stakeholders, customers, project names and task titles are all known to the workspace.
A deterministic replace against those lists is far more reliable than guessing at PII. This is a
TL3 decision recorded here because it is what makes TL3 tractable.

★★ A pseudonymous author id attached to raw comment text is theatre — "Call with &lt;name&gt; re: the
&lt;customer&gt; migration" re-identifies everyone in it regardless of what the author is called. The
free-text pass is the real work, not the id substitution.

---

## What already exists — verified 2026-08-23

- **`TimelogTimeItem`** carries nine fields and **no comment**. Neither `mapTimeItem` (v1) nor
  `mapV2TimeItem` (v2) reads one.
- **Individual bookings are transient.** They are fetched, passed to `aggregateActuals`, and
  discarded. What survives is `byBucket[bucketId][periodKey]`, `byResource[resourceId]` and
  `unattributed`.
- **The cache is per-device `localStorage`.** `timelog-actuals-store.ts`'s own header: "NOT a
  Workspace field — never exported, never in Turso, cleared by app-reset's sweep."
- **`ActualsCacheEntry`'s only required field is `fetchedAt`.** `aggregates`, `users`,
  `projectRefs` and `partial` are all optional, and a directory-only "Load people" persists an
  entry with **no** `aggregates`. "No baseline yet" is a real state, not a defensive branch.
- **Nothing polls.** `useTimelogSync` is on-demand by contract; every fetch runs under `runGuarded`
  and raises a BLOCKING modal with a Cancel button.
- **`useCalendarAutoSync` is NOT the precedent it looks like** — it is push-on-content-change keyed
  by a `contentKey`, not an interval pull. Citing it leads to the wrong design.
- **The job runner already has the notification path.** `use-scheduled-job-runner.ts` takes a
  `notify(title, body)` and calls it on success only, recording failures in history without
  notifying — deliberately, to avoid failure spam.
- **Per-role attribution is one hop and needs no new data.** `Resource.roleId` is an FK to
  `Role.id` (nullable), and `TimelogUserLink` already maps `timelogUserId` to `resourceId`.
- **No AI path touches bookings today.** Clean slate:
  `grep -rniE "timelog|booking" src/app/chat-tools.ts src/app/ai-*.ts` returns nothing.

### The v1/v2 split — the one open probe

| Path | Endpoint | Comment available? |
|---|---|---|
| per-user (self/org) | `/v1/time-tracking-item/get-by-date` | **yes** — `Comment` is on the v1 read model |
| per-customer/project | `/v2/projects/{id}/time-registrations` | **UNKNOWN** — undocumented publicly |

The v1 model carries far more than the nine fields we map: `Comment`, `AdditionalTextField`,
`TimeRegistrationApprovalStatus`, `InvoiceStatus`, `StartTime`, `EndTime`, `TaskName`,
`CustomerName`, `Created`, `LastModified` and others.

**Task 1 of the plan is a devtools probe** of the v2 response for a comment-like key. The fallback
is decided in advance rather than improvised: **route comment-bearing fetches through v1 and clamp
by project.** Per-registration enrichment via the v1 by-id endpoint is rejected — it is N+1
against an endpoint that already returns a project's whole history unpaged.

---

## TL1 design

### Comment on the wire

One optional field on `TimelogTimeItem`, populated by both mappers. Absent (not empty string) when
the source row carries none, so "the endpoint does not supply comments" stays distinguishable from
"the person left it blank" — the delta and the future review surface mean different things by
those two.

### Per-booking baseline — a fingerprint, never the text

The device store gains a per-booking record beside the aggregates: **id, date, hours, billable
hours, and a short hash of the comment.**

★★★ **The text is deliberately NOT stored.** Consequence, accepted: the delta can report *"comment
changed"* and show the **new** text (it is in hand from the fetch) but can never show a
before/after diff. Two reasons, and the second is the load-bearing one:

1. Full comment text for every booking across the cached projects would put megabytes of free-text
   into `localStorage`, which has no eviction and a hard per-origin ceiling.
2. It would be the one copy of employee free-text living **outside Turso, unredacted, on every
   device** — and it would survive every code path TL3 later adds, because TL3 governs what leaves
   for the model, not what a cache wrote months earlier.

Capped with oldest-eviction, mirroring the existing `MAX_PROJECTS` shape in the same store.

### The interval cadence

`JobCadence` gains an interval variant carrying an `everyMinutes` number.

★★ `currentSlot` is meaningless for an interval — every existing cadence is a wall-clock SLOT, and
the catch-up property is a property *of* slots. `isDue` therefore branches: for the interval
variant it is elapsed-based — never run, or `now` minus `lastRunAt` at least `everyMinutes`.

★ That answers §224's explicitly-deferred question **by construction**: a window missed while the
app was closed fires **once on next open**, never N times.

★★ `everyMinutes` floors at 5 to match `TICK_INTERVAL_MS`. A smaller configured value is a lie the
UI would be telling; floor it in the sanitizer, not in the picker alone.

★★ Widening `ScheduledJob.type` off its single-member union touches the store, the settings
section, the runner's dispatch and the sanitizer. A persisted `type` that no longer parses must
**degrade, not silently drop the job**.

`nextRunAt` gains the matching interval branch — `lastRunAt` plus the interval, or `now` plus the
interval when it has never run — so the settings surface can show a real next-run time.

### The delta engine

Pure, i18n-free, **clock-free** (`now` passed in). Takes baseline plus current, returns added /
changed / removed per booking, grouped by resource and then by role via `Resource.roleId`.

Four states it must NAME rather than smother:

- **No baseline yet** → "first pull". Never "everything is new".
- **A null `roleId`** → an explicit unassigned-role group. Not folded into another role.
- **An unlinked TimeLog user** → the existing `unattributed` bucket, as today.
- **A `partial` fetch** → ★★★ **reported, never stored as the new baseline.** `canApplyToBudget`
  requires a non-partial entry for a reason: a short aggregate ERASES the missing project's real
  booked hours on apply. A partial background fetch overwriting the baseline would make the next
  delta wrong in both directions with nothing to report it. ★★ Read `partial` as `=== true`;
  ABSENT MEANS COMPLETE, deliberately (§172).

### Surfaces

- **Time bookings view** — a per-booking drill-down under each person, and a delta section
  summarising what changed since the previous pull.
- **Settings, the scheduled-jobs section** — the interval job, its cadence, and its run history,
  through the existing job UI rather than a bespoke one.
- **Notification** — the runner's existing `notify` path, carrying the delta summary. Success
  only; a failed pull records to history and stays quiet, matching the existing job.

### Two hard rules

★★★ **A background pull NEVER applies.** Applying writes actuals onto the plan and is
confirm-gated (`timelog-apply-confirm.tsx`). A timer that applies is silent data mutation. The job
notifies; the human applies.

★★★ **The quiet path is a SEPARATE entry point from `useTimelogSync`.** Its every fetch raises a
blocking modal with a Cancel button — correct for a gesture, unacceptable on a timer. A modal
appearing every 30 minutes over whatever the user is doing is worse than no polling at all.

---

## Error handling

- **Unconfigured integration or a degraded crypto path** → the job **skips and says why**; it must
  never fail. ★ The token (`timelogApiToken`) is device-sealed but NOT passphrase-wrappable —
  `isPassphraseLocked` is only ever asked about `anthropicApiKey` and `tursoAuthToken` — so it
  hydrates on load and needs no unlock. A locked secret is not among the skip conditions.
- **A 401/403** sets `tokenInvalidAt` through the existing path; the job does not retry in a loop.
- **A partial fetch** notifies with the shortfall named and leaves the baseline untouched.
- **A malformed persisted job type** degrades to disabled-and-visible, never a silent drop.

## Testing

- Pure engines (the `isDue`/`nextRunAt` interval branches, the delta) get unit tests plus property
  tests for the interval arithmetic — the existing property-test shape.
- The four delta states each get an explicit test; "no baseline" and "partial" are the two that
  regress silently.
- ★ The baseline-not-overwritten-on-partial test must seed a **non-empty** prior baseline, or it
  passes for the wrong reason.
- The mapper change is pinned for both v1 and v2 shapes, including the absent-versus-empty
  distinction.
- A test that the quiet path raises **no** modal — the regression that would otherwise ship
  unnoticed.

## Out of scope for TL1

Upstream approval status and rejection reasons (TL2). Redaction rules, the Settings rules UI and
their JSON import/export (TL3). Anything AI (TL4). Our own accept/reject verdicts. Any write to
TimeLog. A before/after comment diff — precluded by the fingerprint decision above.

## Verify the shape claims

```
grep -n -A 3 "export type JobCadence" src/app/scheduled-jobs/types.ts
grep -n "TICK_INTERVAL_MS" src/app/use-scheduled-job-runner.ts
grep -n -A 9 "interface ScheduledJob " src/app/scheduled-jobs/types.ts
grep -n -A 12 "export type TimelogTimeItem" src/app/timelog-types.ts
grep -n -A 8 "export type ActualsCacheEntry" src/app/timelog-actuals-store.ts
grep -n "roleId" src/app/types.ts
grep -n "CREATE TABLE IF NOT EXISTS operating_guides" src/app/operating-guide-schema.ts
```
