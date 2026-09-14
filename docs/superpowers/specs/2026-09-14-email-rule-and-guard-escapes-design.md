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

## Scope

**In:** parts 1–6 below.

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
  `FieldError`, `window.alert` in the prompt flows). If an editor has no error pattern, STOP and ask the
  user — see Open questions 1 and 2.
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
| `Task.assigneeEmail` | `validateTaskForm` (`task-validation.ts`) → `FieldError` | `createTask` (`use-chat-dispatcher.ts`), `buildTaskCleanPatch` (`chat-task-patch.ts`, via `chat-tools-updates.ts`) | `buildBulkEditUpdates` (`bulk-operations-helpers.ts`) | **gap:** `sanitizeInlinePatch` (`task-inline-patch.ts`), fed by the assignee picker in `task-row.tsx` via `tasks-section.tsx` | task descriptor `emailFormatFields` (`entity-descriptor.ts`) + `plan.ts` | `buildTaskFromObj` (CSV), `issueToTaskFields` (Jira), `templates.ts` task decode, `contacts.ts` `loadContacts` |
| `Absence.assigneeEmail` | `absence-edit-modal.tsx` `handleSubmit` (already changed-only) | `createAbsence` / `updateAbsence` → `refuseInvalidAbsenceEmail` (`use-register-tools.ts`) | — | — | absence descriptor `emailFormatFields` | `sanitizeAbsence` (`sanitize-entities.ts`) |
| `Shift.assigneeEmail` | `shift-edit-modal.tsx` (no check today) → `ModalFieldError` | — (no shift tool) | — | — | — (no shift descriptor) | `sanitizeShift` |
| `Resource.email` | `resource-edit-modal.tsx` (cap only today) → `ModalFieldError` | `createResource` / `updateResource` (`use-chat-dispatcher.ts`, only `emails` checked today) | — | — | resource descriptor (add `email` to `emailFormatFields`) | `sanitizeResource`, `mergeImportedResources` (Outlook) |
| `Resource.emails` | `resource-edit-modal.tsx` `findTornEmail` | same two, `findTornEmail` | — | — | `plan.ts` `findTornEmail` guard | `sanitizeResource` → `sanitizeEmailList` (string branch unchanged) |
| `Stakeholder.email` | `stakeholder-edit-modal.tsx` (cap only) → `ModalFieldError` | `createStakeholder` / `updateStakeholder` (`use-register-tools.ts`) | — | — | stakeholder descriptor (add `email`) | `sanitizeStakeholder` (`sanitizeText`, cap `BUDGET_NAME_MAX`) |
| `RaidItem.ownerEmail` | `raid-edit-modal.tsx` (bare input) → `ModalFieldError`; inquiry prompt in `handleSendRaidInquiry` (`use-resource-planner.ts`) → `window.alert` | `createRaid` / `updateRaid` (`use-register-tools.ts`, tools `create_raid_item` / `update_raid_item`) | RAID bulk apply (`raid-panel.tsx` `applyBulk`) — see Open question 3 | — | raid descriptor (add `ownerEmail`) | `sanitizeRaidItem` (line-neutral), `templates.ts` raid decode |
| `RaidEscalation.toEmail` | `escalate-popover.tsx` `canConfirm` | `requireEscalationRecipient` | — | — | — (not an inline-edit field) | `sanitizeEntry` keeps `isEscalationEmail` |
| `ContactPerson.email` | `ContactPersonsControl` `addDraft` (`project-form-fields.tsx`) — see Open question 1 | — (no tool writes `contactPersons`) | — | — | — | `sanitizeContactPerson`, `decodeContactPersons` (reversible, escapes `;`) |
| `JiraConfig.email` | `jira-settings.tsx` input — see Open question 2 | — | — | — | — | raw merge in `use-settings.ts` |
| `TimelogConfig.email` | `timelog-settings.tsx` input — see Open question 2 | — | — | — | — | raw merge in `use-settings.ts` |

The "derive email from the assignee" prompt flows are write boundaries too and use `window.alert`
already: `onSendInquiry` (`use-task-row-handlers.ts`), the bulk inquiry in `use-bulk-operations.ts`, and
`handleSendRaidInquiry`. They move from `isValidEmail` to `isWriteSafeEmail`. The `isValidEmail(task.assignee)`
"is the assignee text itself an address" reads in the same flows and in the AI `sendInquiry`
(`use-chat-dispatcher.ts`) also move, so an
assignee named `a,b@x.com` is not silently copied into the email field.

### Tests

Grep repo-wide (`src`, `e2e`, `scripts`) for every changed symbol before starting each task. At HEAD the
census over `isValidEmail|isEscalationEmail|buildTaskCleanPatch|buildBulkEditUpdates|validateTaskForm|refuseInvalidAbsenceEmail|task-inline-patch|sanitizeTimelogConfig|sanitizeStakeholder|issueToTaskFields`
hits 61 test files, none in `e2e/` or `scripts/` except one comment.

- **ADD:** `sanitize-core` unit tests for `isWriteSafeEmail` and `emailWriteRefusal` (blank, unchanged
  unsafe, changed invalid, changed delimiter, create). One per-boundary test per matrix cell: refused when
  changed, accepted when unchanged-but-unsafe, error text via `t("en-US", …)`. `task-inline-patch.test.ts`:
  the inline cell refuses a changed unsafe email and leaves the other patch keys intact. A card⇔write
  parity case per newly-guarded descriptor field in `plan.sanitizer-parity.test.ts`.
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

- **Reassign-to-a-bad-resource.** Several writers COPY an email from a stored resource or contact
  (`ResourcePicker` selection, `action-assign-owner.ts`, `raid-panel.tsx` bulk reassign, `template-apply.ts`
  `linkResource`). Under a literal changed-only rule, picking a resource whose stored email is unsafe would
  refuse the reassignment. Open question 3.
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
- **Notice only on explicit import actions** (Open question 4 fixes the list): one notice with the count
  and the names of records still holding a non-write-safe address. A normal reload is silent; the editor
  field error still shows.
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
  drop-plus-diagnostic with the record kept; a notice test on the explicit import and a no-notice test on
  reload.
- **MIGRATE:** `use-jira-sync.test.tsx` cases that assert an `assigneeEmail` survives verbatim, if any use
  a non-write-safe address.
- **RECOMPUTE:** `codec-roundtrip.property.test.ts` — a generator that can produce `Name <x@y.z>` now loses
  bytes on load by design; narrow the generator or assert the normalised form, and record why.
  `golden-workspace.test.ts` must stay green with no regeneration.

### Risks and accepted residue

- **Escalation records.** `sanitizeEntry` drops a `toEmail` with `<>` today. Normalising `Name <a@x.com>`
  first would LOAD a record that is dropped today — a load-path behaviour change. Open question 5.
- **Accepted residue (§533):** an address already torn by a past CSV/MD/Turso save cannot be rebuilt.

---

## 3. §90 — `onCreateResource` in a popout

### Current behaviour at HEAD (evidence)

- `handleCreateResource` (`task-manager.tsx`) mints an id, calls `setResources` and
  `logActivityUser("resource.created")`, and returns the id, with no `isPopout` check.
- It is passed unguarded in the `WorkspaceSection` bag, to `<AppModals>` (which renders `TaskFormModal`
  under `showTaskFormModal` and `ShiftEditModal` under `editingShift`, with no `isPopout` gate on either; only
  its footer block is `!isPopout`), and to `<RaidCreateHost>` (mounted under `!isPopout`). Whether
  `showTaskFormModal` can be true in a popout is not traced here — Open question 8. `use-action-center-handlers.ts` passes it twice; the Action Center is not in `POPOUT_TABS`.
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
  around `deleteAllAssetDataForProject` logging `storage.projectAssetCleanupFailed`.
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
  `storage.projectAssetCleanupFailed` where tests pin them.
- `hardDeleteProject` runs it as ONE separate, non-fatal pipeline after the tenant transaction, logging a
  failure via `logDiag`. The tenant transaction is unchanged.
- `deleteAllAssetDataForProject` is deleted only if no non-test caller remains; if deleted, its test in
  `document-assets-store.test.ts` migrates and the comment in `workspace-panels.tsx` that names it is swept.

### Tests

- **ADD:** a guard test that every exported `*_DDL` constant from a `*-schema.ts` module whose SQL contains
  `project_id` is registered. A `node:sqlite` execute test (reuse the `runStatements` / `bindArg` shape from
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
- The guard sees exported schema-module DDL only. Store-local DDL constants are invisible to it (Open
  question 6).

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

## Open questions

1. **`ContactPersonsControl` has no error state.** The project form around it uses `FieldError` /
   `errorFor`; does wiring the add-draft refusal into that existing `FieldError` count as the existing
   pattern, or stop and ask?
2. **Jira and Timelog settings inputs have no field-error pattern** (`jira-settings.tsx` has a status line,
   `timelog-settings.tsx` a token `Banner`), and both write on every keystroke, so there is no save moment to
   refuse at. Per the approved design: STOP and ask the user before touching either.
3. **Copied addresses.** Does picking or reassigning to a resource/contact whose stored email is not
   write-safe count as a "change" to refuse (ResourcePicker, `action-assign-owner.ts`, RAID bulk reassign,
   `template-apply.ts`)? And how does the task inline assignee cell, which has no error slot, surface a
   refusal?
4. **Which actions are "explicit import"?** Candidates: `onOpenStorageFile` and the pick/switch path that
   also calls `openFileForBackend` (`use-storage-file-ops.ts`), `handleApplyTemplate`, new project from
   template (`new-project-workspace.ts`), Outlook contacts import (`handleImportResources`), and the AI
   import in `step0-import-panel.tsx`. Does the notice share the single-slot `reportImportFor` surface?
5. **Escalation load leg:** may the normaliser rescue a `Name <addr>` `toEmail` that `sanitizeEntry` drops
   today, or must the escalation leg stay byte-for-byte?
6. **§204 guard scope:** is "exported `*_DDL` from `*-schema.ts`" enough, or must the guard also scan
   store-local DDL constants (`scheduled-jobs-store.ts`, `color-schemes-store.ts`), none of which carry
   `project_id` today?
7. **Settings normaliser:** do Jira/Timelog emails get the Part 2 normaliser in `use-settings.ts`, or are
   settings outside "record sanitizers"?
8. **Task editor in a popout:** can `showTaskFormModal` (computed in `task-manager.tsx`) be true in a popout?
   It decides whether the §90 popout test must cover `TaskFormModal` or only `ShiftEditModal` (Resources is a
   popout tab).
