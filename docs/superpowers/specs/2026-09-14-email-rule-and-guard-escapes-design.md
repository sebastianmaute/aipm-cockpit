# Email rule and guard-escape batch — design

**Date:** 2026-09-14 · **Branch:** `fix/email-and-guard-batch` (from `origin/main` 2f147f4c)
**Register entries:** §90, §91, §204 fixed; §323 closed by design; §533 closed as an accepted limit.
**Work items:** #127 (§90), #128 (§91), #188 (§204), #238 (§323), #323 (§533).

★★ **Numbering trap.** §533's work item is **#323**; register entry §323's work item is **#238**. Every
commit message, MR description and closure line writes the pair as "§323/#238" and "§533/#323". A bare
"Closes #323" closes §533's issue, not §323's.

## Goal

1. One write-time email rule for every email field in the app: a value that is not a valid address, or
   that contains `,` or `;`, is refused at every write boundary — but only when the value CHANGES. Stored
   values keep loading.
2. Imports clean up the provably-equivalent shapes (`Name <addr>`), keep and flag everything else, and
   never refuse or drop a record.
3. Close three guard escapes: a popout can create a resource (§90), a popout can record and replay undo
   (§91), a project hard delete leaves five side tables behind (§204).
4. Close §323 and §533 with evidence.
5. When a person's email is corrected in the person record, carry the correction to the records it was
   copied into (Part 7).

## Scope

**In:** parts 1–7 below.

**Out:**
- **§299** (undo/redo restore writes no completion/reopening entry). It is an audit-completeness design
  question that touches the three incompatible completion-trend delta shapes (`docs/AGENTS/activity-log.md`)
  and the status census's recursion bound. It is neither data loss nor a guard escape, and would roughly
  double the review surface. It gets its own slice.
- Rebuilding addresses already torn by a past CSV/Markdown/Turso save (§533 residue — undecidable).
- Changing `isValidEmail` itself, `sanitizeEmailList`'s string branch, or any caps (`EMAIL_MAX`,
  `BUDGET_NAME_MAX`).
- Version bump, CHANGELOG, push, MR, tag — only on the user's explicit say.

## User decisions (verbatim outcomes, approved 2026-09-14)

- §533: close as accepted limit, BUT do not allow comma or semicolon in email address fields.
- Fields: ALL email fields.
- Fields with no check today get FULL FORMAT validation too (not just `,` `;`).
- Task inline assignee-email cell format gap: fixed in this batch.
- Imports: "clean up known safe shapes, keep-and-flag the rest, never refuse/drop a record; synced records
  drop only the bad address + diagnostic".
- One big batch (email rule + §90 + §91 + §204 + closures).
- §91: whole undo stack read-only in popouts.
- §204: all five side tables + guard.
- §323: close by design (comment + small test).

### Second round (approved 2026-09-14, answers to the first draft's open questions)

1. **Jira/Timelog settings email and `ContactPersonsControl`:** reuse the existing `FieldError`
   (`field-feedback.tsx`). Typing is never blocked. A changed value is persisted only once it is valid; until
   then the last valid value stays stored. A contact-person add with an unsafe typed email is refused with a
   `FieldError`.
2. **Copied stored emails** (ResourcePicker selection, assign owner, RAID bulk reassign, template linking):
   allowed, never refused; the editor flags the value. PLUS: when the email is corrected in the person record,
   the correction populates to the records it was copied to — see Part 7 (settled 2026-09-14).
3. **Task inline assignee-email cell:** a refused edit reverts to the stored value and shows the existing
   error toast with the invalid-email message.
4. **Explicit-import notice** fires on: file open/switch, template apply, new project from template, AI import
   panel. It shares the single-slot surface `reportImportFor` reports on. Outlook contacts import is a SYNC:
   diagnostic only, no notice.

### Controller rulings

- **Ruling (Q5):** the escalation load leg MAY rescue `Name <addr>` — the normaliser runs before
  `isEscalationEmail` in `sanitizeEntry`. The recovery is provably equivalent and strictly less loss than
  today's drop.
- **Ruling (Q6):** the §204 guard executes EVERY schema DDL in `node:sqlite` and fails on any table that has a
  `project_id` column and is not in `PROJECT_SCOPED_SIDE_TABLES`. Store-local DDL constants are exported where
  needed so the guard can execute them.
- **Ruling (Q7):** Jira and Timelog emails get NO import clean-up. They are typed settings, not imported data.
- **Ruling (Q8):** the plan verifies from code whether the task editor is reachable in a popout; the §90 test
  covers whatever is reachable.

## Global constraints

- **i18n.** `src/app/i18n.ts` (EN) and `src/app/i18n.de.ts` (DE) key sets stay identical (tsc). NEVER
  Edit/Write `i18n.de.ts`: patch it with a node utf8 script, `\u` escapes for umlauts, `\r\n` anchors
  (the file is CRLF; a `\n` anchor silently no-ops). Re-verify the bytes after writing. Real umlauts only.
- **Line endings.** `src/app/*.ts(x)` are CRLF in the working tree (`git ls-files --eol` reports
  `i/lf w/crlf`): Edit tool only, never `sed -i`. Docs are LF.
- **Size ratchet.** LIMIT 1600, counted as `split("\n").length`. `src/app/sanitize-records.ts` measures
  **1600 at HEAD — zero headroom.** Any change there must be line-neutral (replace a call in place, reuse
  an existing import line); new logic goes in a new module. `task-manager.tsx` (3257) is baselined: no new
  lines, no comments there.
- **No hand-rolled UI controls.** Every editor reuses its existing error surface (`ModalFieldError`,
  `FieldError`, `window.alert` in the prompt flows, the ambient error toast). If an editor has no error
  pattern, STOP and ask the user. The settings inputs and `ContactPersonsControl` host the existing
  `FieldError` (second-round decision 1).
- **Tests.** Targeted files only, one at a time:
  `npx vitest run <file> --maxWorkers=1 --reporter=dot > <log> 2>&1; echo EXIT=$?`. Never the full suite,
  never two vitest runs at once, never read an exit code through a pipe. Also `npx tsc --noEmit` and
  `npx eslint --max-warnings=0 src` per task; `npm run size:check`; docs tasks add
  `npm run docs:claims:check`, `npm run docs:symbols:check`, `npm run followups:index:check`.
- **Six write paths.** No new persisted field. Normalised values ride the existing record sanitizers, so
  JSON, CSV, Markdown, Turso single, Turso tenant and IndexedDB all see the same value — the plan must
  still name, per load funnel, which sanitizer applies it (Part 2).
- **Preview ⇔ write parity.** The inline-AI card (`describeEntityCalls` in `inline-ai-edit/plan.ts`) and
  the tool write it previews must judge the same value with the same predicate. Every field that gains a
  write check gains the matching preview rejection in the same task, pinned by a parity case.
- **Byte stability.** `golden-workspace.test.ts` stays green with NO fixture regeneration. Verified at
  HEAD: all 44 email values in `sample-workspace-small.json` are already write-safe, and the two `;` hits
  in the golden CSV/MD are the `contactPersons` cell's own escaped sub-field delimiter, not addresses.
- **No `path:LINE` citations** in docs. Cite symbols.
- **Commits.** `git commit --only <paths>`, never `git add -A`/`.`, never `--amend`. Conventional subject.

---

## 1. Email rule

### Current behaviour at HEAD (evidence)

- `isValidEmail` (`sanitize-core.ts`) is `/^\S+@\S+\.\S+$/` on the trimmed value — it ACCEPTS `,` and `;`.
- `isDelimiterSafeEmail` (`sanitize-core.ts`) refuses `,`/`;`, no format check. Its only consumer is
  `findTornEmail`, which serves `resource.emails` alone (§422).
- `findTornEmail(incoming, stored)`: ARRAY → first delimiter-unsafe member not already present (trimmed)
  in `stored`; STRING → first stored unsafe address contained in the string; no format check on either.
- `isEscalationEmail` (`raid-escalation.ts`) = `isValidEmail && no <>`. It is used by one LOAD leg
  (`sanitizeEntry` → `sanitizeRaidEscalations` / `decodeRaidEscalations` / `lastEscalation`) and THREE
  write legs: `requireEscalationRecipient` (AI `escalate_raid_item`), `escalate-popover.tsx` (`canConfirm`)
  and the escalate handler in `use-action-center-handlers.ts`.
- The "changed-only" rule already exists in one editor: `absence-edit-modal.tsx` `handleSubmit` refuses with
  `errorInvalidEmail` only when `cleanedEmail !== openedEmail`. The resource editor's §422 check is the
  same idea for `emails` (judged against the resource as of modal open).
- i18n: `errorInvalidEmail` (EN+DE) and `resourceErrorEmailDelimiter` (EN+DE, "An additional email
  address cannot contain…").

### Required behaviour

**Predicates (`sanitize-core.ts`):**
- `isWriteSafeEmail(s)` = `isValidEmail(s) && isDelimiterSafeEmail(s)`. `isValidEmail` and
  `isDelimiterSafeEmail` are UNCHANGED.
- `emailWriteRefusal(incoming, stored)` → `"invalid" | "delimiter" | null`, the single scalar rule:
  1. `incoming` trimmed is `""` → `null` (clearing is always legal).
  2. `incoming` trimmed equals `stored` trimmed → `null` (unchanged, even if stored is unsafe).
  3. `!isValidEmail` → `"invalid"`; else `!isDelimiterSafeEmail` → `"delimiter"`; else `null`.
  A create passes `stored = undefined`. `"a,b@x.com"` passes `isValidEmail`, so it yields `"delimiter"`.
- `findTornEmail` becomes the LIST form of the same rule, keeping its name and signature so the §422 call
  sites do not move: a member is refused when it is NEW (not present, trimmed, in `stored`) and not
  `isWriteSafeEmail`. For a STRING, the existing "contains a stored unsafe address" refusal stays, and every
  member the split would produce that is new must also be write-safe. Its docstring and the ★★ line naming
  §533 as open are rewritten in the same commit.

**Dual-use split first (task 1, before any caller changes):**
- `raid-escalation.ts`: keep `isEscalationEmail` as the LOAD predicate for `sanitizeEntry` (unchanged, so
  no stored escalation starts being dropped). Add the write form `isEscalationWriteEmail` =
  `isWriteSafeEmail && no <>`, and move all three write legs to it. The docstring says which is which.
- `sanitizeTimelogConfig`: **no split needed** — it has no production caller (see Corrections). Timelog
  settings load is the raw merge in `use-settings.ts`; the write boundary is the input in
  `timelog-settings.tsx`.

**i18n:** add ONE shared key `errorEmailDelimiter` — EN "An email address cannot contain a comma or a
semicolon.", DE "Eine E-Mail-Adresse darf weder ein Komma noch ein Semikolon enthalten." The resource editor
migrates to it and `resourceErrorEmailDelimiter` is removed (EN + DE + tests). `"invalid"` maps to the
existing `errorInvalidEmail`. AI tool refusals stay unlocalized throws, one shape per field:
`<field> is invalid` / `<field> must not contain "," or ";"`.

**New module for record-level write checks.** `sanitize-records.ts` is at the limit, so RAID
`ownerEmail`, ContactPerson `email` and Stakeholder `email` write checks live in a new small module (for
example `record-email-guards.ts`, re-exported through the `./sanitize` barrel like `absence-email.ts`).
`refuseInvalidAbsenceEmail` moves to the new rule and gains a `stored` argument for the update path.

### Field × boundary matrix

"—" = no such boundary exists at HEAD (verified). Every cell that names a site changes to
`emailWriteRefusal` / `isWriteSafeEmail` / the list rule, judged against the stored value the boundary
already has.

| Field | UI editor | AI tool | Bulk edit | Inline cell | Inline-AI card | Load paths that must NOT change |
|---|---|---|---|---|---|---|
| `Task.assigneeEmail` | `validateTaskForm` (`task-validation.ts`) → `FieldError` | `createTask` (`use-chat-dispatcher.ts`), `buildTaskCleanPatch` (`chat-task-patch.ts`, via `chat-tools-updates.ts`) | `buildBulkEditUpdates` (`bulk-operations-helpers.ts`) | **gap:** `sanitizeInlinePatch` (`task-inline-patch.ts`), fed by the assignee picker in `task-row.tsx` via `tasks-section.tsx` `onInlinePatch` → refused edit keeps the stored value + error toast (see "Task inline cell") | task descriptor `emailFormatFields` (`entity-descriptor.ts`) + `plan.ts` | `buildTaskFromObj` (CSV), `issueToTaskFields` (Jira), `templates.ts` task decode, `contacts.ts` `loadContacts` |
| `Absence.assigneeEmail` | `absence-edit-modal.tsx` `handleSubmit` (already changed-only) | `createAbsence` / `updateAbsence` → `refuseInvalidAbsenceEmail` (`use-register-tools.ts`) | — | — | absence descriptor `emailFormatFields` | `sanitizeAbsence` (`sanitize-entities.ts`) |
| `Shift.assigneeEmail` | `shift-edit-modal.tsx` (no check today) → `ModalFieldError` | — (no shift tool) | — | — | — (no shift descriptor) | `sanitizeShift` |
| `Resource.email` | `resource-edit-modal.tsx` (cap only today) → `ModalFieldError` | `createResource` / `updateResource` (`use-chat-dispatcher.ts`, only `emails` checked today) | — | — | resource descriptor (add `email` to `emailFormatFields`) | `sanitizeResource`, `mergeImportedResources` (Outlook) |
| `Resource.emails` | `resource-edit-modal.tsx` `findTornEmail` | same two, `findTornEmail` | — | — | `plan.ts` `findTornEmail` guard | `sanitizeResource` → `sanitizeEmailList` (string branch unchanged) |
| `Stakeholder.email` | `stakeholder-edit-modal.tsx` (cap only) → `ModalFieldError` | `createStakeholder` / `updateStakeholder` (`use-register-tools.ts`) | — | — | stakeholder descriptor (add `email`) | `sanitizeStakeholder` (`sanitizeText`, cap `BUDGET_NAME_MAX`) |
| `RaidItem.ownerEmail` | `raid-edit-modal.tsx` (bare input) → `ModalFieldError`; inquiry prompt in `handleSendRaidInquiry` (`use-resource-planner.ts`) → `window.alert` | `createRaid` / `updateRaid` (`use-register-tools.ts`, tools `create_raid_item` / `update_raid_item`) | RAID bulk apply (`raid-panel.tsx` `applyBulk`) — the reassign copies `r?.email`: exempt as a copy, never refused | — | raid descriptor (add `ownerEmail`) | `sanitizeRaidItem` (line-neutral), `templates.ts` raid decode |
| `RaidEscalation.toEmail` | `escalate-popover.tsx` `canConfirm` | `requireEscalationRecipient` | — | — | — (not an inline-edit field) | `sanitizeEntry` keeps `isEscalationEmail`, after the normaliser (Ruling Q5) |
| `ContactPerson.email` | `ContactPersonsControl` `addDraft` (`project-form-fields.tsx`) → refused add + `FieldError` under the email input | — (no tool writes `contactPersons`) | — | — | — | `sanitizeContactPerson`, `decodeContactPersons` (reversible, escapes `;`) |
| `JiraConfig.email` | `jira-settings.tsx` input → local draft + `FieldError`; persisted only once valid | — | — | — | — | raw merge in `use-settings.ts` (no clean-up, Ruling Q7) |
| `TimelogConfig.email` | `timelog-settings.tsx` input → local draft + `FieldError`; persisted only once valid | — | — | — | — | raw merge in `use-settings.ts` (no clean-up, Ruling Q7) |

The "derive email from the assignee" prompt flows are write boundaries too and use `window.alert`
already: `onSendInquiry` (`use-task-row-handlers.ts`), the bulk inquiry in `use-bulk-operations.ts`, and
`handleSendRaidInquiry`. They move from `isValidEmail` to `isWriteSafeEmail`. The `isValidEmail(task.assignee)`
"is the assignee text itself an address" reads in the same flows and in the AI `sendInquiry`
(`use-chat-dispatcher.ts`) also move, so an
assignee named `a,b@x.com` is not silently copied into the email field.

### Copied stored emails (decision 2)

A writer that copies a person's STORED email into another record is not a "change" the rule refuses:
`ResourcePicker` selection (every host: task form, task inline cell, RAID, shift, stakeholder, contact person),
`applyAssignOwner` (`action-assign-owner.ts`), the task assign CTA in `use-action-center-handlers.ts`,
`raid-panel.tsx` bulk reassign, `onReassignTask` (workload triage), the `calendar-drag.ts` reassign, and
`template-apply.ts` `linkResource`. The exemption is exact: the incoming value equals, trimmed, the source
record's stored email (the resource or address-book contact the same action picked). A value the user then
types over it is judged by the normal rule. Every editor that shows the field renders the stored-unsafe
value with its `FieldError` (non-blocking), so the copy is flagged, not hidden. The plan names, per site,
how the source value reaches the check.

### Task inline cell (decision 3)

`onInlinePatch` (`tasks-section.tsx`) applies `sanitizeInlinePatch` and today drops a refused key silently.
A refused `assigneeEmail` keeps the stored value (the key is left out of the patch; the other keys apply)
and shows the error toast through the ambient `useToastContext` (`toast-context.tsx`) — the hook the same
pane already uses in `use-tasks-inline-ai-edit.tsx` — with `t(lang, "errorInvalidEmail")` or
`t(lang, "errorEmailDelimiter")`. This is the same `showToast("error", …)` shape used by the other
invalid-email refusals (`use-bulk-operations.ts`, `use-action-center-handlers.ts`). No new prop.
★ The inline assignee cell's email comes from the picker, so with the copy exemption the refusal can only
fire for a value that is not the picked source's stored email. The plan verifies whether that is reachable
and, if not, pins the exemption instead of an unreachable refusal.

### Settings inputs and contact persons (decision 1)

- `jira-settings.tsx` (`update("email", …)`) and `timelog-settings.tsx` (`set({ email })`) bind the input to
  the stored config and write on every keystroke. Each gains a local draft: the input shows the draft, typing
  is never blocked, the config is written only when the draft is `""` or write-safe (changed-only against the
  stored value), and a `FieldError` shows while the draft is refused. The stored value is the last valid one.
- The `FieldError` sits OUTSIDE the wrapping `HintedLabel` / `<label>` and is linked by `aria-describedby`,
  so it does not join the input's accessible name (the Jira file already keeps its storage notice outside
  the label for the same reason).
- `ContactPersonsControl` `addDraft`: an unsafe typed email refuses the add, keeps the draft, and shows a
  `FieldError` under the email input; a copied stored email is exempt (see above).

### Tests

Grep repo-wide (`src`, `e2e`, `scripts`) for every changed symbol before starting each task. At HEAD the
census over `isValidEmail|isEscalationEmail|buildTaskCleanPatch|buildBulkEditUpdates|validateTaskForm|refuseInvalidAbsenceEmail|task-inline-patch|sanitizeTimelogConfig|sanitizeStakeholder|issueToTaskFields`
hits 61 test files, none in `e2e/` or `scripts/` except one comment.

- **ADD:** `sanitize-core` unit tests for `isWriteSafeEmail` and `emailWriteRefusal` (blank, unchanged
  unsafe, changed invalid, changed delimiter, create). One per-boundary test per matrix cell: refused when
  changed, accepted when unchanged-but-unsafe, error text via `t("en-US", …)`. `task-inline-patch.test.ts`:
  the inline cell refuses a changed unsafe email and leaves the other patch keys intact. A card⇔write
  parity case per newly-guarded descriptor field in `plan.sanitizer-parity.test.ts`.
  Copy exemption: per copy site, picking a source whose stored email is unsafe succeeds and stores it, and
  overtyping it with an unsafe value is refused. Task inline cell: a refused email leaves the stored value,
  applies the other keys and calls the ambient toast once with the right message. Settings: typing an unsafe
  Jira/Timelog email never blocks the input, shows `FieldError`, and leaves the stored config at the last
  valid value; clearing and a valid value persist. `ContactPersonsControl`: an unsafe typed email refuses the
  add with `FieldError` and keeps the draft.
- **MIGRATE:** `raid-escalation.test.ts` (the `isEscalationEmail` describe stays for the load leg; add a
  write-leg describe), `escalate-popover.test.tsx` and `use-action-center-handlers.test.ts` (three "would
  otherwise pass isValidEmail" cases now name the write predicate), `resource-edit-modal.test.tsx` (two
  `resourceErrorEmailDelimiter` assertions → `errorEmailDelimiter`), `absence-edit-modal.test.tsx`.
- **RECOMPUTE (review each expectation, justify every change in the commit):**
  `inline-ai-edit/emails-roundtrip.test.ts` — the string cases `findTornEmail("x,y@z.com", …)` and
  `findTornEmail("a@x.com, b@y.com", …)` change meaning once new split members must be write-safe;
  `emails-write-parity.test.ts`; `plan.offered-surface-sweep.test.ts`, `plan.write-path-sweep.test.ts`,
  `plan.model-writable-surface.test.ts`, `descriptor-drift.test.ts` (descriptor `emailFormatFields` sets
  grow); `task-validation.test.ts`, `bulk-operations-helpers.test.ts`, `chat-task-patch.test.ts`,
  `sanitize-stakeholder*.test.ts`, `chat-tools.test.ts` (escalate).
- **Must stay green, unchanged:** `golden-workspace.test.ts`, `codec-roundtrip.property.test.ts`,
  `timelog-sanitize.test.ts`, `use-jira-sync.test.tsx`, `jira-api.test.ts` (Part 2 changes the last two
  deliberately — see there).

### Risks and accepted residue

- **Reassign-to-a-bad-resource.** Resolved by decision 2: a copy of a stored email is exempt, so a
  reassignment is never refused; the unsafe copy is flagged in the editor and corrected by Part 7 once the
  person record is fixed.
- The rule stops NEW unsafe values only. A stored unsafe value survives until someone edits that field.
  This is the design, and the editor shows the field error so the user can see it.
- `isValidEmail` stays loose (`\S+@\S+\.\S+`); "full format validation" means that predicate, not RFC 5322.

---

## 2. Imports

### Current behaviour at HEAD (evidence)

- Every load funnel passes email fields through `sanitizeEmail` (trim + `EMAIL_MAX`) or `sanitizeText`,
  with no format check, except the escalation load leg. `buildTaskFromObj` (CSV) copies `assigneeEmail` raw.
- `issueToTaskFields` (`jira-api.ts`) maps `assignee.emailAddress` through `sanitizeEmail`; `use-jira-sync.ts`
  applies the patch. `mapGraphContact` (`outlook-contacts.ts`) takes `emailAddresses[0]`, and
  `mergeImportedResources` writes it into `Resource.email` (via `handleImportResources`,
  `use-resource-directory.ts`).
- The explicit file open (`onOpenStorageFile`, `use-storage-file-ops.ts`) applies tasks + RAID only and
  reports import diagnostics through `truncationOps.reportImportFor` AFTER its toast (the surface is
  single-slot and replaces). Template apply is `handleApplyTemplate` (`task-manager.tsx`) and
  `new-project-workspace.ts` (`applyTemplate`).

### Required behaviour

- **Pure normaliser** in a new module (for example `email-normalize.ts`), i18n-free:
  - A scalar `Name <addr>` whose inner `addr` is `isWriteSafeEmail` → `addr`.
  - A LIST field (`Resource.emails` only) member holding several addresses → separate members, only when
    every part is `isWriteSafeEmail`.
  - Anything else → returned unchanged. The stored value changes only when the result is provably the same
    address.
- Applied inside the record sanitizers on ALL load paths: `sanitizeAbsence`, `sanitizeShift`,
  `sanitizeResource`, `sanitizeStakeholder`, `sanitizeRaidItem` (line-neutral), `sanitizeContactPerson`,
  and the task load funnels (`buildTaskFromObj`, the JSON task path through `migrateTask`, template task
  decode). The plan names the exact call per funnel and counts to six write paths per field.
- The escalation load leg normalises `toEmail` before `isEscalationEmail` judges it (Ruling Q5), so a
  stored `Name <a@x.com>` loads as `a@x.com` instead of being dropped.
- Jira and Timelog settings emails are NOT normalised (Ruling Q7).
- **Notice only on explicit import actions** (decision 4): `onOpenStorageFile` and the pick/switch path through
  `openFileForBackend` (`use-storage-file-ops.ts`), `handleApplyTemplate` (`task-manager.tsx`), new project from
  template (`new-project-workspace.ts` `applyTemplate`), and the AI import panel (`step0-import-panel.tsx`). One
  notice with the count and the names of records still holding a non-write-safe address. A normal reload is
  silent; the editor field error still shows. Outlook contacts import (`handleImportResources`) is a sync:
  `logDiag` only.
- **Slot.** `reportImportFor(backend, backendNowPointsAtLoadedFile)` (`use-load-truncation.ts`) accepts only a
  backend's `lastImport*` counters and is called only from `use-storage-file-ops.ts`, so the notice cannot pass
  THROUGH it and template apply / the AI panel have no backend to hand it. The notice shares its single-slot
  toast surface instead and obeys the same ordering landmine: it fires AFTER the action's own confirmation
  toast and BEFORE `reportImportFor`, so a data-loss diagnostic wins the slot.
- **Synced records:** `issueToTaskFields` and `mapGraphContact` drop an address that is not write-safe
  after normalising (the record is kept, the field becomes `""`), and `logDiag("warn", …)` records the
  record key and field — never the address itself.

### Affected files / symbols

New normaliser module; `sanitize-entities.ts`, `sanitize-records.ts` (line-neutral), `csv-codecs-decode.ts`,
`task-status.ts` (`migrateTask`) or its caller, `templates.ts`, `jira-api.ts`, `outlook-contacts.ts`,
`use-storage-file-ops.ts` and the template-apply handlers for the notice; i18n key(s) for the notice.

### Tests

- **ADD:** normaliser unit tests (each shape, unchanged cases, a `Name <a,b@x.com>` stays unchanged); one
  load round trip per codec proving a normalised value; `jira-api.test.ts` and an Outlook test for
  drop-plus-diagnostic with the record kept; a notice test per explicit import action (four) and a
  no-notice test on reload and on Outlook contacts import; an ordering test that the notice fires before
  `reportImportFor` on file open; an escalation load test that `Name <a@x.com>` loads as `a@x.com` and
  `Name <a,b@x.com>` is still dropped.
- **MIGRATE:** `raid-escalation.test.ts` load-leg cases that pin a `Name <addr>` drop (Ruling Q5), and
  `use-jira-sync.test.tsx` cases that assert an `assigneeEmail` survives verbatim, if any use
  a non-write-safe address.
- **RECOMPUTE:** `codec-roundtrip.property.test.ts` — a generator that can produce `Name <x@y.z>` now loses
  bytes on load by design; narrow the generator or assert the normalised form, and record why.
  `golden-workspace.test.ts` must stay green with no regeneration.

### Risks and accepted residue

- **Escalation records.** `sanitizeEntry` drops a `toEmail` with `<>` today. Normalising `Name <a@x.com>`
  first LOADS a record that is dropped today — a deliberate load-path change (Ruling Q5).
- **Accepted residue (§533):** an address already torn by a past CSV/MD/Turso save cannot be rebuilt.

---

## 3. §90 — `onCreateResource` in a popout

### Current behaviour at HEAD (evidence)

- `handleCreateResource` (`task-manager.tsx`) mints an id, calls `setResources` and
  `logActivityUser("resource.created")`, and returns the id, with no `isPopout` check.
- It is passed unguarded in the `WorkspaceSection` bag, to `<AppModals>` (which renders `TaskFormModal`
  under `showTaskFormModal` and `ShiftEditModal` under `editingShift`, with no `isPopout` gate on either; only
  its footer block is `!isPopout`), and to `<RaidCreateHost>` (mounted under `!isPopout`). Whether
  `showTaskFormModal` can be true in a popout is not traced here; per Ruling Q8 the plan verifies it from code
  and the §90 test covers every reachable modal. `use-action-center-handlers.ts` passes it twice; the Action Center is not in `POPOUT_TABS`.
- `ResourcePicker` already types it optional and offers the "add" row only when present.
- Precedent in the same bag: `onSendRaidInquiry: isPopout ? undefined : handleSendRaidInquiry`.

### Required behaviour

- `onCreateResource` becomes optional in `workspace-section-types.ts`, `raid-panel.tsx`,
  `raid-edit-modal.tsx`, `app-modals.tsx`, `task-form-modal.tsx`, `task-form-fields.tsx` and
  `shift-edit-modal.tsx`. `raid-create-host.tsx` may stay required (main-window only); `escalate-popover.tsx`
  and `action-cta-controls.tsx` stay required.
- `task-manager.tsx` passes `isPopout ? undefined : handleCreateResource` at the bag and the `<AppModals>`
  mount — single-token edits, no new lines, no comment.

### Tests

- **ADD:** a popout case at the `task-manager.popout-guard.test.tsx` seam asserting the captured
  `WorkspaceSection` props carry no `onCreateResource` (and the `AppModals` prop likewise).
- **MIGRATE:** that file's header paragraph describing `onCreateResource` as "still unguarded".
- Unaffected: every component test that passes `onCreateResource` (optional is a superset);
  `resource-picker.test.tsx` already pins "omits the + Add row entirely when onCreateResource is not
  provided".

### Risks

- A popout user loses "add new person" in the picker with no explanation. Accepted (approved option).

---

## 4. §91 — undo stack in a popout

### Current behaviour at HEAD (evidence)

- `useUndoStack` is called in `task-manager.tsx` before `useWorkspaceTab()` provides `isPopout`;
  `useUndoHotkey(undoApi.undo, undoApi.redo)` follows with no popout condition. Only `undoControlEl` (which
  carries `undoThrough` / `redoThrough`) is `isPopout`-null.
- Every `capture*` (`capture`, `captureFieldEdit`, `captureComposite`, `captureFieldRows`) funnels through
  `pushEntry`, which always calls `showToastAction` with an "Undo" action running `undoById`. So a popout
  bulk apply shows a clickable Undo toast — not only a hotkey.
- `raid-panel.tsx` `applyBulk` calls `onCaptureBulk` before its guarded per-row save.
- Chat: `useUndoBatch(undoApi)` forwards to `captureComposite`, so it is covered by the same funnel. The
  dispatcher and register tools receive `isReadOnly: isPopout` and throw before mutating.
- Precedent for a late-filled ref: `allowDestructiveSaveRef`, filled by an effect and read lazily through
  `depsRef`.

### Required behaviour

- `UseUndoStackDeps` gains an optional `isReadOnly?: () => boolean`, read lazily through `depsRef`. While it
  returns true: `pushEntry` pushes nothing and shows no toast; `undo`, `redo`, `undoById`, `undoThrough`
  and `redoThrough` return without running a runner or logging.
- `task-manager.tsx` feeds it from a ref filled once `isPopout` is known (same shape as
  `allowDestructiveSaveRef`), without moving any hook. Line-neutral: fold into existing lines.

### Tests

- **ADD** (`undo/use-undo-stack.test.tsx`): read-only → each capture pushes nothing and calls no
  `showToastAction`; each of the five restore entry points does nothing and logs nothing; a positive control
  with read-only false. A popout seam case in `task-manager.popout-guard.test.tsx`.
- **MIGRATE:** the "★★ A THIRD unguarded path" header paragraph in `task-manager.popout-guard.test.tsx`
  (its "invisible affordance" claim is wrong — the toast is visible).
- Unaffected: the other `useUndoStack(` callers (the dependency is optional), `use-undo-hotkey.test.ts`.
- **Verify, don't assume:** before closing, enumerate every `captureComposite` site reached by the chat
  dispatcher and confirm each sits after its `isReadOnly` throw; the stack gate covers them either way.

### Risks

- First render reads the ref before the effect fills it. Captures only come from user events after mount,
  so the window is unreachable; the test pins the steady state.

---

## 5. §204 — project hard delete leaves side tables behind

### Current behaviour at HEAD (evidence)

- `hardDeleteProject` (`turso-portfolio.ts`) runs `hardDeleteProjectStatements` (`BEGIN`, `DELETE … WHERE
  project_id = ?` per `TABLE_NAMES` member, delete the project row, `COMMIT`), then a separate try/catch
  around `deleteAllAssetDataForProject` logging `storage.projectSideTableSweepFailed`.
- Project-keyed tables outside `TABLE_NAMES` with no project sweep: `chat_threads` (`CHAT_THREADS_DDL`),
  `committee_report_versions` (`MEETING_REPORT_VERSION_DDL`), `snapshot` and `snapshot_series`
  (`SNAPSHOT_DDL`), `project_versions` (`VERSION_DDL`, whole-workspace payloads). `document_asset_data`
  (`DOCUMENT_ASSET_DATA_DDL`) is swept by its special case.
- Global side tables (no `project_id`): `comm_templates`, `comm_template_versions`, `operating_guides`,
  `action_learning`, and the store-local, non-exported DDL in `scheduled-jobs-store.ts` and
  `color-schemes-store.ts`.

### Required behaviour

- Registry `PROJECT_SCOPED_SIDE_TABLES` (`{ table, ddl }[]`) listing the six tables above (the five plus
  `document_asset_data`, replacing its special case).
- One builder emits, for every entry, its create-if-missing DDL then `DELETE FROM <table> WHERE project_id = ?`.
  Keep the SQL text `DELETE FROM document_asset_data WHERE project_id = ?` and the log key
  `storage.projectSideTableSweepFailed` where tests pin them.
- `hardDeleteProject` runs it as ONE separate, non-fatal pipeline after the tenant transaction, logging a
  failure via `logDiag`. The tenant transaction is unchanged.
- `deleteAllAssetDataForProject` is deleted only if no non-test caller remains; if deleted, its test in
  `document-assets-store.test.ts` migrates and the comment in `workspace-panels.tsx` that names it is swept.

### Tests

- **ADD:** a guard test (Ruling Q6) that executes EVERY schema DDL — every exported `*_DDL`, plus the
  store-local constants in `scheduled-jobs-store.ts` and `color-schemes-store.ts` (exported for it if
  needed) — in `node:sqlite`, reads each created table's columns (`PRAGMA table_info`), and fails on any
  table with a `project_id` column that is neither a `TABLE_NAMES` member nor in `PROJECT_SCOPED_SIDE_TABLES`.
  It carries an anti-vacuity floor (a minimum number of tables seen, and at least one registered hit). A
  `node:sqlite` execute test (reuse the `runStatements` / `bindArg` shape from
  `turso-schema.execute.test.ts`, in a new `turso-portfolio.execute.test.ts`): create tenant + side DDL,
  insert rows for `p1` and `p2` with the real builders, run the hard-delete statements, assert `p1` has 0
  rows in every registered table and `p2` is untouched.
- **MIGRATE:** the three hard-delete tests in `turso-portfolio.test.ts` ("archive/restore/hardDelete emit
  the right statements", "…also cleans the project's asset bytes…", "…still completes … when asset-byte
  cleanup fails", whose `toHaveBeenCalledTimes(2)` stays 2 only if the sweep is one pipeline).
- Unaffected: `turso-tenant-schema.test.ts`, mocks of `hardDeleteProject` in `use-storage-backend.test.tsx`,
  `use-storage-turso-ops.test.ts`, `task-manager.portfolio-mode.test.tsx`. `e2e/version-history-documents.spec.ts`
  names it in a comment only — sweep if falsified.

### Risks and accepted residue

- A libSQL pipeline does not abort on a failing statement (AGENTS.md, `idKind` note), so a partial sweep is
  possible; it is logged and re-runnable. Leaked rows are recoverable; a half-deleted project is not.
- The guard sees only DDL it is handed. A future store that inlines its DDL string without a constant
  stays invisible; the guard's enumeration (exports plus the named store-local constants) is the plan's to
  make discoverable rather than hardcoded where it can.

---

## 6. Closures and register

- **§323/#238.** Add a comment at `onDelete` (`use-task-row-handlers.ts`) stating why it does not arm
  `allowDestructiveSave`: `isMassDeletion` (`workspace-metrics.ts`) needs `prev - cur >= 5` and one delete
  removes one row, and arming would hand a one-shot bypass to the next save. ADD a small test in
  `use-task-row-handlers.test.ts` (or a pure `isMassDeletion` test) that removing one row from any count can
  never trip `isMassDeletion`. Close as "won't arm, by design".
- **§533/#323.** Close as an accepted limit. Reason: `,` and `;` are legal only inside a quoted local part
  (RFC 5321/5322), which this app has no use for; witness = the write-path refusal tests from Part 1. The
  `sanitize-core.ts` and `findTornEmail` sentences calling §533 open are rewritten.
- **§90/#127, §91/#128, §204/#188** close with their fix commits. The §91 body's "invisible affordance"
  and the §204 body's two-table scope are corrected in the closure.
- Closure form per entry, in the fix commit: heading suffix `— CLOSED 2026-09-14`, index row updated,
  `**Status:**` witness naming the pinning test, `**Work item:**` line removed, every falsified body
  sentence found by grepping the changed symbol and old wording. GitLab issues close after merge only.
- New findings during implementation get their own register entries, never folded into these.

---

## 7. Propagation of corrected person emails — settled 2026-09-14

Full research: session scratchpad `propagation-research.md`. The design below is the approved design.

### Current behaviour at HEAD (evidence)

- **Nothing propagates on write.** `handleSaveResource` (`use-resource-directory.ts`) map-replaces the resource
  via a functional `setResources`, captures `captureFieldChanges` → `captureFieldEdit` (`resource.updated`,
  `RESOURCE_UNDO_GROUPS`) and logs `logUpdate("resource.updated", …)`. No linked record is touched. AI
  `updateResource` (`use-chat-dispatcher.ts`) is a separate write path that does not call it.
- **Read-time resolution exists instead, and only partly.** `effectivePersonName` / `effectiveAssignee`
  (`resource-foundation.ts`) make display surfaces show the live name. `effectivePersonEmail` makes the OUTBOUND
  inquiry flows use the live email (`use-task-row-handlers.ts` `onSendInquiry`, `use-bulk-operations.ts`, AI
  `sendInquiry`, `raid-inquiry.ts`, `resources-panel.tsx`). NOT live: the cached field shown in every editor,
  every export and persisted backend, saved templates, the escalate popover (mails the picker value), and
  `stakeholderEmail` (`mailto.ts`), where the stakeholder's OWN stored email wins over the linked resource.
- **The only cascade on a resource is DELETE:** `purgeCalendarFor` removes absences/shifts by FK first, else by
  case-folded name/email with a surviving-twin guard (`recordMatchesRemoved`), as ONE `captureComposite`
  (`capturePart` per array) plus one `resource.deleted` log entry. That is the precedent this part follows.
- **Copy sites that write an FK next to the email:** `ResourcePicker` resource rows (task form, task inline cell,
  RAID, shift, stakeholder, contact person), `applyAssignOwner`, the task assign CTA, `raid-panel.tsx` bulk
  reassign, `onReassignTask`, `calendar-drag.ts` reassign, `buildEscalationEntry` (`toResourceId`), and
  `template-apply.ts` `linkResource` (FK by match; the email is the template seed's own).
- **Copy sites WITHOUT an FK:** RAID → task conversion in `use-resource-planner.ts` (copies `ownerEmail`, not
  `ownerResourceId`), `handleOpenShiftEditor` seeds, the add-absence seed in `resource-calendar-rows.tsx`,
  address-book contact rows (`resourceId: null` by construction), AI `create_task`. `backfillResourceFks` and
  `backfillTaskResourceFks` stamp an FK from a matching cached email at load, so most unlinked-but-matching rows
  gain an FK on the next load anyway.

### User decisions (verbatim outcomes, approved 2026-09-14)

- **Trigger:** ANY change of a person's primary email propagates (answers Q1(a); Q1(b) — only when the old
  email was not write-safe — is rejected).
- **Records reached:** tasks (excluding Jira-synced tasks, `jiraKey` set), RAID owner email, absences, shifts,
  stakeholders, contact persons (answers Q4(a)). NEVER escalations — they record who was actually contacted.
- **Notification:** the person save plus all copy updates are ONE undo entry; the existing Undo toast names the
  count of linked records updated, via a NEW EN+DE i18n string carrying a count placeholder (answers Q6(a)).
  DE is patched with the existing node utf8 script — never Edit/Write `i18n.de.ts` directly (Global
  constraints, i18n).

### Controller rulings

- **Ruling: targets are FK-linked rows only (option A); option B is rejected** — address matching instead of
  FK matching risks rewriting a shared team mailbox, an address-book contact, or a free-text row that merely
  carries the same address as this person, and the load-time backfill (`backfillResourceFks`,
  `backfillTaskResourceFks`, `resource-foundation.ts`) already links most unlinked-but-matching rows on the
  next load, so option B's marginal gain is small — cost if wrong: an address match would silently overwrite
  someone else's stored email on a shared mailbox, which is worse data loss than the stale copy this part
  fixes. (Answers Q2(a).)
- **Ruling: among linked rows, only those whose cached email still equals the resource's OLD primary email,
  compared trimmed and case-insensitively, get the correction** — this is the codebase's existing case-folding
  convention for email equality (`(s ?? "").trim().toLowerCase()`, used throughout `resource-foundation.ts`'s
  `emailToResourceId`/name-and-email index builders and `purgeCalendarFor`'s case-folded match in
  `use-resource-directory.ts`), so the new rule matches how every existing FK/email match in this codebase
  already compares — why: overwriting every linked row regardless of its current value would silently discard
  a user's deliberate per-record override, the same reasoning `absence-edit-modal.tsx`'s changed-only rule
  already uses — cost if wrong: an untrimmed or case-sensitive compare leaves stale copies uncorrected whenever
  storage or an editor varies case/whitespace on load, defeating the propagation with no visible symptom.
  (Answers Q3(a); a blank cached email does not equal a non-blank old value, so it is left untouched — Q3(c)
  is rejected.)
- **Ruling: saved templates and other projects are not updated** — propagation is a workspace-scoped save-time
  helper with no access to template storage or other projects' state, and reaching them needs a second write
  path with its own undo/token story that nobody asked for — cost if wrong: rewriting data the user never
  touched in this session, outside the loaded workspace, silently. (Answers Q5(a).)
- **Ruling: the activity log keeps the single existing `resource.updated` entry; propagated rows get no entry
  of their own** — matches the precedent `purgeCalendarFor`'s delete cascade already sets (one
  `resource.deleted` entry covers its whole cascade), and avoids N audit rows for a mechanical copy — cost if
  wrong: an audit reviewer sees no per-row evidence from this save alone, but the undo entry's before-images
  already carry that detail if it is ever needed. (Answers Q7(a).)
- **Ruling: `ContactPersonsControl`'s add refuses only a TYPED or overtyped email, never one that equals the
  picked resource's or contact's stored email** — this is Part 1 decision 2's copy exemption, which the
  contact-person add already implements ("Settings inputs and contact persons") — cost if wrong: refusing a
  copied stored value blocks the very selection the picker exists for, and exempting a typed value lets an
  unsafe address back in through the one field decision 1 locks down. (Resolves former Open question 2 —
  confirmed as written.)
- **Ruling: the task inline assignee-email cell's email always comes from the picker, so a same-cell refusal
  may be unreachable under the copy exemption; the plan verifies reachability from code and, if unreachable,
  tests the copy exemption in its place rather than an unreachable refusal** — a refusal test whose refusal
  branch can never fire is dead weight that reads as coverage it is not — cost if wrong: shipping a test for
  an unreachable branch passes every run while proving nothing (this repo's session memory already names that
  failure mode). (Resolves former Open question 3.)
- **Ruling: ONE shared pure, i18n-free helper computes the propagation; both `handleSaveResource`
  (`use-resource-directory.ts`) and AI `updateResource` (`use-chat-dispatcher.ts`) call it, pinned by a parity
  test asserting the two paths produce identical resulting arrays for the same before/after resource** — a
  second independent implementation is exactly the per-path drift Part 1's dual-use split (task 1) exists to
  prevent — cost if wrong: the human editor and the AI tool silently diverge on which rows get corrected,
  reintroducing the drift this batch's own global constraints forbid.
  - **Six write paths:** the helper is a pure state change (`(prev, next, arrays) => newArrays`, no
    persistence call) — it satisfies the six-write-paths constraint the same way every other propagated value
    does, by riding existing columns: JSON/CSV/MD/Turso-single/Turso-tenant/IndexedDB all persist whatever is
    in the arrays already, with no new column and no new per-backend code.
  - **Popout guard, verified:** AI `updateResource` already throws `readOnlyError()` on `args.isReadOnly` (the
    popout guard) before its `sanitizeResource`/merge step, so the helper — called after that guard — inherits
    it for free. The human path inherits Part 4's read-only undo stack the same way if the resource editor is
    ever reachable in a popout; the plan still verifies that reachability from code.
  - **Write-concurrency tokens, verified:** the resource side needs no new check — the `update_resource` TOOL
    WRAPPER (`chat-tools.ts`, `case "update_resource"`) already calls `requireToken("resource", current, input,
    …)` before the dispatcher runs. Every row the helper TOUCHES gets a changed CSV projection, so
    `entityToken` invalidates any outstanding `update_*` token the model still holds for that row — `task`,
    `raid`, `stakeholder` and `absence` are `TokenEntity` members (`ai-entity-token.ts`) and are affected;
    `shift` and `contactPerson` are not `TokenEntity` members (no `update_*` tool exists for either) and carry
    no token to invalidate. This is the safe direction: a stale token is refused later, never silently
    accepted.
- **Ruling: `ContactPerson` participates in the same `captureComposite` via a hand-rolled whole-array
  before/after fragment, not `capturePart`** (`capturePart<T extends { id: number }>` requires an id and
  `ContactPerson` has none) — `CompositeFragment` (`undo/use-undo-stack.ts`) is just `{ isPrimary, restore }`,
  and `capturePart` is one producer of it, not the only possible one; the fragment's `restore` swaps the whole
  `contactPersons` array between before/after snapshots, unarmed like `captureFieldPart` (a plain edit removes
  no rows, so nothing needs a one-shot destructive bypass) — why this ruling exists: excluding `ContactPerson`
  would contradict the decision that contact persons are reached, and this file's own constraints list had
  flagged the id-less array as unresolved ("needs its own before-image … or it is excluded") — cost if wrong:
  an id-keyed capture either drops contact-person changes from undo (a corrected contact stays stuck after
  undo) or does not compile against a type with no `id`.

### Records reached — settled matrix

| Field | FK column | Reached | Guard |
|---|---|---|---|
| `Task.assigneeEmail` | `resourceId` | yes | skip when `jiraKey` is set (Jira-synced, read-only, re-synced) |
| `RaidItem.ownerEmail` | `ownerResourceId` | yes | — |
| `Absence.assigneeEmail` | `resourceId` | yes | — |
| `Shift.assigneeEmail` | `resourceId` | yes | — |
| `Stakeholder.email` | `resourceId` | yes | — |
| `ContactPerson.email` | `resourceId` (set only when picked from the registry) | yes | whole-array `CompositeFragment`, not `capturePart` (no id) |
| `RaidEscalation.toEmail` | `toResourceId` | NEVER | history record — rewriting falsifies who was mailed |

### Constraints the design meets

- **Six write paths:** no new field; propagated values ride existing columns, so all six persist them.
- **Scope:** the loaded workspace only. Other projects and saved templates are not reached (ruling above).
- **Undo:** one entry for resource plus copies. When nothing propagates, the existing `captureFieldEdit`
  capture stays as it is. `pushEntry` shows ONE Undo toast, and a second toast would replace it (single slot);
  its current text (`t(lang, "undoToastEdit", primaryCount)`, `i18n.ts`) only ever takes the composite's
  `primaryCount` (1 for a resource edit), so it cannot name the propagated-row count on its own. The plan adds
  one new key (for example `undoToastResourceEmailPropagated`, EN "Edited 1 item and updated {0} linked
  record(s)", `{0}` = propagated count) used in place of `undoToastEdit` for this composite only when the
  propagated count is greater than zero; when nothing propagates the existing text is unchanged.
- **Escalations are history** (who was mailed, when); rewriting `toEmail` falsifies the record. Never reached
  (settled matrix above).
- **Popout and AI concurrency tokens:** see the shared-helper ruling above (both verified from code).
- **Outlook:** the plan checks whether an `assigneeEmail` change on an absence/shift with `outlookEventId`
  triggers a re-push.
- **Interplay with Part 1:** a propagated value is the corrected, write-safe value, so it passes the rule; a
  correction TO an unsafe value is refused at the resource editor before anything propagates.

### Tests

- **ADD:** pure helper unit tests — FK match with equal-old-value (trimmed, case-insensitive) cache updates;
  different cache untouched; blank cache untouched; no FK untouched; `jiraKey` task skipped; escalations
  untouched; unchanged email is a no-op returning the same references. Parity test: `handleSaveResource` and
  AI `updateResource` produce identical resulting arrays for the same before/after resource. Hook test: one
  save produces ONE undo entry (`captureComposite`, including the `ContactPerson` whole-array fragment) and
  one undo restores the resource AND every copy, `ContactPerson` included. Toast test: the count-bearing key
  fires only when the propagated count is greater than zero; the plain `undoToastEdit` text is unchanged when
  nothing propagates. i18n test: the new key's DE string is byte-verified after the node utf8 patch script
  (Global constraints), and `npx tsc --noEmit` still holds EN/DE key parity. Token test: after a propagating
  AI `update_resource` call, a stale `expectedToken` on a touched task/raid/stakeholder/absence row is refused
  by its own `update_*` tool. Activity-log test: a propagating save still logs exactly one `resource.updated`
  entry. Popout seam case in `task-manager.popout-guard.test.tsx` if the resource save is reachable there
  (per the shared-helper ruling); otherwise a test pinning that it is not.
- **RECOMPUTE:** `use-resource-directory` save tests that assert a single `captureFieldEdit` call — a
  propagating save now asserts `captureComposite` with one part per touched array (plus the resource part);
  a non-propagating save keeps the existing `captureFieldEdit` assertion. The AI `updateResource` tests
  asserting a single-part `captureComposite` (`chat-tools.test.ts`) gain propagating-case variants asserting
  the additional parts.

---

## Corrections to research

1. **`sanitizeTimelogConfig` is not dual-use — it has no production caller.** Only `timelog-sanitize.test.ts`
   calls it. Timelog (and Jira) settings load is the raw spread in `use-settings.ts`. The approved design's
   "split `sanitizeTimelogConfig` load vs write" is moot.
2. **`isEscalationEmail` has three write callers, not one:** `requireEscalationRecipient`,
   `escalate-popover.tsx` `canConfirm`, and the escalate handler in `use-action-center-handlers.ts`.
3. **The absence editor does validate:** `absence-edit-modal.tsx` refuses a changed invalid address with
   `errorInvalidEmail` — the changed-only rule's existing precedent.
4. **Steering-committee members do not reuse `ContactPerson`;** the committee stores `memberResourceIds`.
   `ContactPerson` is used only by project meta.
5. **`<RaidCreateHost>` is mounted under `!isPopout`,** so it is not a popout path for §90.
6. **§91's API surface is wider than "undo/redo/undoById":** `undoThrough` and `redoThrough` also run
   runners and must be gated; all four `capture*` funnel through `pushEntry`.
7. **The chat undo batch needs no separate gate:** `useUndoBatch` forwards to `captureComposite`, and the
   dispatcher throws on `isReadOnly: isPopout` first.
8. **`docs:claims:check` does not scan `docs/superpowers/`** (`SKIP_DIRS` in `scripts/doc-claims-lib.mjs`),
   and `docs:symbols:check` scans only AGENTS.md and `docs/AGENTS/`. Neither gate can see this spec.
9. `export function sanitizeTask` does not exist; task email load goes through `buildTaskFromObj` (CSV) and
   `migrateTask` (`task-status.ts`).
10. **`FieldError` exists** in `field-feedback.tsx` (`role="alert"`, pair with `aria-invalid` +
    `aria-describedby`); `ModalFieldError` is in `edit-modal-chrome.tsx`.
11. **`reportImportFor` is not a generic notice slot.** It takes a backend's `lastImport*` counters plus
    `backendNowPointsAtLoadedFile` and is called only from `use-storage-file-ops.ts`. "Reuse its slot" means
    sharing its single-slot toast surface and ordering rule, not calling it (Part 2).
12. **`onInlinePatch` (`tasks-section.tsx`) shows no toast today** and has no toast prop; the ambient
    `useToastContext` is the no-new-prop route (Part 1, "Task inline cell").
13. **The Jira/Timelog settings inputs are controlled by the stored config** and write per keystroke, so
    "persist only once valid" needs a local draft in each; `FieldError` fits without a new control.
14. **Nothing propagates a resource edit today.** Only DELETE cascades (`purgeCalendarFor`); the live email is
    resolved at read time for inquiry flows only (`effectivePersonEmail`), and `stakeholderEmail` prefers the
    stakeholder's own stored copy (Part 7).

## Open questions

Q1–Q4 were answered by the second-round decisions and Q5–Q8 by the controller rulings (see "User decisions").
Part 7's seven propagation questions were answered 2026-09-14 (see Part 7, "User decisions" and "Controller
rulings"); the former open items 2 (copy exemption vs contact-person refusal) and 3 (task inline cell
reachability) are resolved by Part 7's controller rulings. None open.
