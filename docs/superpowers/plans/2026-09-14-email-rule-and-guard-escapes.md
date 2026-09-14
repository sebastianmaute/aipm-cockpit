# Email Rule and Guard-Escape Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One changed-only write rule for every email field (valid format, no `,`/`;`), import clean-up of provably-equivalent shapes, propagation of a corrected person email to FK-linked copies, three popout/hard-delete guard escapes closed (§90, §91, §204), calendar validation in `sanitizeIsoDate` (§539), with §323 and §533 closed.

**Architecture:** Two pure predicates in `sanitize-core.ts` (`isWriteSafeEmail`, `emailWriteRefusal`) plus the list form (`findTornEmail`) are the only rule; every write boundary (UI editor, AI tool, bulk edit, inline cell, inline-AI card) asks them against the value it already holds as "stored". Load paths only normalise `Name <addr>`. Propagation is one pure module called by the human and AI resource writers. The guard escapes are small wiring changes pinned at the `task-manager.popout-guard.test.tsx` seam and a `node:sqlite` execute test.

**Tech Stack:** Next.js / TypeScript, React 19 hooks, vitest 4 (jsdom), `@testing-library/react`, `node:sqlite`, node scripts for the register gates.

**Spec:** `docs/superpowers/specs/2026-09-14-email-rule-and-guard-escapes-design.md` (binding). Read it before any task. Where this plan and the spec disagree, the "Spec corrections" section below says why; the plan follows the code.

## Global Constraints

- `src/app/i18n.de.ts` is NEVER edited with Edit/Write. Patch it with a node utf8 script (written with the Write tool into your scratchpad as a `.cjs` file), `\u` escapes for umlauts, `\r\n` anchors, and an anchor-count check that exits 1 unless the anchor occurs exactly once. Re-verify bytes afterwards (command in each task). Real umlauts only.
- `src/app/*.ts(x)` are CRLF in the working tree (`i/lf w/crlf`): Edit tool only, never `sed -i`, never Write over an existing source file. Docs, plans, specs and `docs/open-followups.md` are LF.
- Size ratchet LIMIT 1600, measured as `node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`. `src/app/sanitize-records.ts` measures 1600 at HEAD — every change there is line-neutral; new logic lives elsewhere. `src/app/task-manager.tsx` measures 3257 against its `docs/baselines/file-sizes.json` entry of 6040: a baselined file fails only when it grows past its entry, so the ratchet ALLOWS new lines here (pre-flight I4). Additions stay minimal all the same — prefer a line-neutral fold, add no comments, and state the before/after count in the commit body.
- No hand-rolled UI controls. Reuse `FieldError` (`field-feedback.tsx`), `ModalFieldError` (`edit-modal-chrome.tsx`), `window.alert` in the prompt flows, and the ambient toast. If an editor has no error surface, STOP and ask the user.
- `npx eslint --max-warnings=0 <touched files>` per task; `npx tsc --noEmit` after any source or test edit (read the error count: `grep -c "error TS" "$LOG/tsc.log"`).
- Never read a gate's exit code through a pipe. Pattern: `<cmd> > "$LOG/x.log" 2>&1; echo "EXIT=$?"`, then grep the log. `$LOG` = your session scratchpad directory.
- One vitest run at a time: `npx vitest run <files> --maxWorkers=1 --reporter=dot > "$LOG/t.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG/t.log"`. Never the full suite. Assert `Test Files N passed (N)` equals the number of files passed (a mistyped path is dropped at exit 0).
- `npm run size:check` per task that grows a source file.
- Commits: write the message with the Write tool to `$LOG/msg-tN.txt`, then `git add <paths> && git commit --only <paths> -F "$LOG/msg-tN.txt"`. Never `git add -A` / `git add .`, never `--amend`, no `git stash`, no `git checkout --`. Every message ends with the line `Claude-Session: https://[session link removed]`.
- Commit messages name register entries as `§N` only. Never write `#N` after close/closes/fix/fixes/resolve/implements. Write "§323", never "#323" (#323 is §533's issue; §323's issue is #238).
- Register ⇄ GitLab is 1:1: a closed entry carries NO `**Work item:**` line. Register index rows are hand-edited, never rebuilt by a recipe. `docs/open-followups.md` has one writer at a time (only Task 11 touches it).
- Six write paths (JSON, CSV, Markdown, Turso single, Turso tenant, IndexedDB): no new persisted field in this batch; normalised and propagated values ride existing columns.
- Load and decode paths stay permissive: they never refuse or drop a record. The only load change is the `Name <addr>` normaliser (Task 5).
- Preview ⇔ write parity: every field that gains a write check gains the matching `describeEntityCalls` rejection in the same task, pinned in `plan.sanitizer-parity.test.ts`.
- `golden-workspace.test.ts` stays green with NO fixture regeneration.
- No `path:LINE` citations in docs; cite symbols.
- An implementer who finds this plan wrong fixes the plan file in the same commit as the work and says so in the report.

## Task order adjustments (written reasons)

1. **`errorEmailDelimiter` is added in Task 2, not Task 3.** Task 2's inline-cell toast and bulk-edit refusal are its first consumers; Task 3 only migrates the resource editor off `resourceErrorEmailDelimiter` and removes that key.
2. **The task form (`validateTaskForm`) is in Task 3**, with the other UI editors; Task 2 is non-UI write boundaries only.
3. **All six register closures (§90, §91, §204, §323, §533, §539) are in Task 11** (the brief's order, one writer for `docs/open-followups.md`). The spec's §6 said "in the fix commit"; the brief overrides it. Fix commits (Tasks 1, 7, 8, 9) still sweep the SOURCE comments and `docs/AGENTS/` prose their change falsifies, because `docs:symbols:check` fails the moment a backticked name disappears.
4. **The Part 7 popout pin (resource editor unreachable in a popout) is in Task 7**, because it needs the `AppModals` capture seam Task 7 adds to `task-manager.popout-guard.test.tsx`.
5. **Scope addition (user-approved 2026-09-14): Task 10 fixes §539** (`sanitizeIsoDate` accepts non-calendar dates), after §204 and before the closures. Its register entry and work item #329 were filed on this branch before the plan; Task 11 closes it.

## Spec corrections (the code wins)

1. **`sanitizeRaidItem` is not a RAID load path.** JSON (`jsonToWorkspace`) and IndexedDB (`browser-backend.ts`) cast RAID rows and run only `sanitizeRaidRichFields`; CSV, Markdown and both Turso layouts decode through `buildRaidItemFromObj` (`csv-codecs-core.ts`); templates through `sanitizeSeedRaidItem` (`templates.ts`). `sanitizeRaidItem` serves writers (`createRaid`/`updateRaid`, `applyRaidFromTask`). Task 5 normalises at those four load funnels and leaves `sanitize-records.ts` RAID code untouched.
2. **IndexedDB loads absences, shifts, resources, stakeholders and RAID verbatim** (no record sanitizer). The spec's "rides the record sanitizers, so all six paths see the same value" is false for IndexedDB. Task 5 adds an explicit normaliser map in `browser-backend.ts`.
3. **`migrateTask` (`task-status.ts`) is the single task load seam on all six paths** (JSON via `jsonToWorkspace`, CSV/Turso via `buildTaskFromObj`, Markdown decode, IndexedDB, and templates via `sanitizeSeedTask`). One edit covers them.
4. **The AI import panel (`step0-import-panel.tsx`) writes nothing.** Its proposal becomes an `aiSeed` that lands through `buildNewProjectWorkspace` inside `createProject` (`use-storage-file-ops.ts`) or `createTursoProject` (`use-storage-turso-ops.ts`) — the same place "new project from template" lands. The notice sits there.
5. **The explicit file "open/switch" actions are three functions** in `use-storage-file-ops.ts`: `onOpenStorageFile` (applies tasks + RAID, reports via `reportImportFor`), `loadProjectFromFile` and `switchToProject` (both report via `reportFor`). All three get the notice between their confirmation toast and their report call.
6. **The inline assignee cell's picker is passed `EMPTY_CONTACTS`** (`task-row.tsx`), and typing a name keeps the previous email (`resource-picker.tsx`). So the cell only ever sends the stored value or a resource's stored email — the refusal is unreachable from the UI. Per the controller ruling, Task 2 pins the copy exemption through the cell and pins the refusal only at the pure (`inlineAssigneeEmailRefusal`) and hook (`onInlinePatch` via the captured row context) seams.
7. **Popout reachability (Ruling Q8), verified — and corrected by pre-flight C1:** `setTaskModalOpen` is passed unguarded and `"raid"` is in `POPOUT_TABS`, so `TaskFormModal` and `RaidEditModal` are reachable in a popout; `handleOpenShiftEditor` is passed through `guardEdit`, so `ShiftEditModal` is not. **The resource editor IS reachable in a popout**, through a second route: `TaskFormModal` → the "+" add-to-address-book button (`TaskFormFields`) → `onAddAssigneeToAddressBook={handleAddAssigneeToAddressBook}` (passed to `<AppModals` unguarded) → `handleOpenAddResource` → `AppModals` renders `ResourceEditModal` under `editingResource` with no popout gate → `onSaveResource={handleSaveResourceFromAnywhere}` → `handleSaveResource` creates. The Resources-view openers (`onEditResource`, `onAddResource`) are `guardEdit`-wrapped. Every resource-creation UI route found at HEAD (`git grep -n "handleOpenAddResource\|handleCreateResource\|onAddAssigneeToAddressBook\|setEditingResource" -- src ':!*.test.*'`): (a) the `ResourcePicker` "+ Add" row via `onCreateResource` (bag + `AppModals`; `RaidCreateHost` mounts under `!isPopout`; `use-action-center-handlers.ts` checks `isPopout`); (b) the address-book button via `onAddAssigneeToAddressBook`; (c) the Resources view via `guardEdit(handleOpenAddResource)` (already guarded); (d) Outlook contacts import via `canImportOutlookContacts({ isPopout, … })` (already guarded); (e) the AI dispatcher's `createResource` (self-guards with `isReadOnly` throws). Task 7 closes (a) and (b) and gates the `ResourceEditModal` render on `!isPopout`.
8. **`use-task-submit.ts` has no `resources`**; Task 3 passes them in through a new optional `UseTaskSubmitArgs.resources` (pre-flight I1). Calling `useWorkspace()` inside the hook would throw in `use-task-submit.test.ts`, which renders the hook with no `WorkspaceProvider`.
9. **`StakeholderEditModal` and `RaidEditModal` are controlled** (`draft` prop, parent-owned); neither holds the stored row. Task 3 captures the email the modal opened with by render-time reconcile keyed on `draft.id`.
10. **`deleteAllAssetDataForProject` and `assetDataDeleteAllForProject` have no other non-test caller** after Task 9, so both are deleted; `document-assets-store.test.ts` loses its test and two `vi.mock` factories drop the key.
11. **The store-local DDL is `SCHEDULED_JOBS_DDL` (named, unexported) and an unnamed `DDL` in `color-schemes-store.ts`.** Task 9 exports them as `SCHEDULED_JOBS_DDL` and `COLOR_SCHEMES_DDL`. The Task 9 execute test inserts rows with a PRAGMA-driven generic `INSERT` rather than each store's builder: the builders' names and argument shapes differ per store and the test's subject is the sweep, not the insert.
12. **`pushEntry` has no text override.** Task 6 adds `toastText?: string` to `CaptureCompositeOpts` and threads it.
13. **Normaliser placement:** `normalizeEmailShape` / `normalizeEmailListShape` / `withNormalizedEmailField` live in `sanitize-core.ts`, not a new module, so `sanitize-records.ts` can import them by extending its existing `sanitizeEmail,` import line (line-neutral).
14. **`isMassDeletion`'s existing tests live in `is-workspace-empty.test.ts`** (re-exported from `workspace.ts`); the §323 test goes there.
15. **`TestSeed` (`test-providers.tsx`) has no `shifts` or `project`**; Task 6 adds both.
16. **Bulk edit has no stored value** (one typed value for N rows); it is judged as a create. `BulkEditBuild` gains the error `"emailDelimiter"`.
17. **Outlook re-push:** no absence/shift Outlook push reads `assigneeEmail` (`grep -rn "assigneeEmail" src/app/use-calendar-integrations.ts` prints nothing), and propagation writes through the workspace setters, not the save handlers that push. Nothing re-pushes; Task 6 re-runs that grep.
18. **The §90 index row's third cell is corrupt** (`undefined\``); Task 11 repairs it.
19. **Template apply notice (pre-flight I4):** `handleApplyTemplate` computes `next = applyTemplate(buildCurrentWorkspace(), tpl, opts)`, so `next` holds the CURRENT project's rows plus the appended seed — summarising `next` would announce existing records as "Imported". Task 5 adds a pure `templateSeedEmailScope(before, after)` that keeps only the rows `appendSeed` added to the three slices `handleApplyTemplate` applies (`tasks`, `raid`, `stakeholders`), unit-tests it over a real `applyTemplate` call, and pins the `task-manager.tsx` wiring with a behavioural test (`task-manager.template-notice.test.tsx`) that drives the real `handleApplyTemplate` and reads the rendered toast.

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `src/app/sanitize-core.ts` | email predicates, list rule, normalisers | 1, 5 |
| `src/app/sanitize-core.email-rule.test.ts` (new) | predicate unit tests | 1, 5 |
| `src/app/record-email-guards.ts` (new, barrel-exported) | AI refusal throw, unsafe-record summary | 2, 5 |
| `src/app/email-refusal-i18n.ts` (new) | refusal → i18n key map | 2 |
| `src/app/email-field-error.tsx` (new) | non-blocking `FieldError` for a stored-unsafe value | 3 |
| `src/app/resource-email-propagation.ts` (new) | pure propagation | 6 |
| `src/app/resource-email-propagation-commit.ts` (new) | setters + undo fragments for a propagation | 6 |
| `src/app/project-side-tables.ts` (new) | §204 registry + sweep builder | 9 |
| `src/app/task-manager.template-notice.test.tsx` (new) | template-apply notice wiring (behavioural) | 5 |
| `src/app/turso-side-tables.guard.test.ts` (new) | §204 discovery guard | 9 |
| `src/app/turso-portfolio.execute.test.ts` (new) | §204 `node:sqlite` execute test | 9 |
| `src/app/sanitize-core.iso-date.test.ts` (new) | §539 calendar-date unit tests | 10 |

---

### Task 1: Shared email predicates and the list rule

**Files:**
- Modify: `src/app/sanitize-core.ts` (add `EmailRefusal`, `isWriteSafeEmail`, `emailWriteRefusal`; rewrite `findTornEmail` body + docstring)
- Modify: `src/app/resource-edit-modal.tsx` (message key chosen by refusal kind)
- Modify: `src/app/use-chat-dispatcher.ts` (two §422 throw messages chosen by refusal kind)
- Create: `src/app/sanitize-core.email-rule.test.ts`
- Test (RECOMPUTE): `src/app/inline-ai-edit/emails-roundtrip.test.ts`, `src/app/inline-ai-edit/emails-write-parity.test.ts`
- Test (RECOMPUTE, fix round 1): `src/app/inline-ai-edit/plan.sanitizer-parity.test.ts` — `resourceReader` composes `findTornEmail` over the `emails` field, the same merge-site guard `updateResource`/`createResource` run, so preview⇔write parity for `resource.emails` is pinned in THIS task, not deferred to Task 2 (controller ruling, fix round 1).

**Interfaces:**
- Consumes: `isValidEmail`, `isDelimiterSafeEmail` (unchanged).
- Produces (exported from `sanitize-core.ts`, reachable through `./sanitize`):
  - `type EmailRefusal = "invalid" | "delimiter"`
  - `isWriteSafeEmail(s: string): boolean`
  - `emailWriteRefusal(incoming: string, stored: string | undefined, copySources?: readonly (string | undefined)[]): EmailRefusal | null`
  - `findTornEmail(incoming: unknown, stored: readonly string[] | undefined): string | undefined` (same signature, now the list form of the rule)

**Test census (run first; label every hit):**

```bash
git grep -n "findTornEmail\|isDelimiterSafeEmail" -- src e2e scripts
git grep -n "emails" -- "src/**/*.test.*" | grep -v "@"
```

- ADD `src/app/sanitize-core.email-rule.test.ts` (below).
- RECOMPUTE `inline-ai-edit/emails-roundtrip.test.ts`: `findTornEmail("x,y@z.com", ["a,b@x.com"])` becomes `"x"` (split member `"x"` is new and not an address); `findTornEmail("a,b@x.com", undefined)` becomes `"a"`. `findTornEmail("a@x.com, b@y.com", ["a@x.com"])` stays `undefined`. Every ARRAY case keeps its value.
- RECOMPUTE `inline-ai-edit/emails-write-parity.test.ts`: `"none/stringNewComma"`, `"safe/stringNewComma"`, `"unsafe/stringNewComma"` join `EXPECT_REJECTED`.
- Must stay green: `resource-edit-modal.test.tsx` (its delimiter cases still show `resourceErrorEmailDelimiter`), `use-chat-dispatcher.test.tsx` §422 cases (match `/emails/`), `plan.test.ts`, `plan.sanitizer-parity.test.ts` (RECOMPUTE `resourceReader`, see Files above — GREEN at Task 1, not deferred).
- **Plan defect, fixed here (found running the census against the verbatim Step 3 implementation; corrected again in fix round 1 after a review caught the first correction's own error):** the original brief claimed `plan.sanitizer-parity.test.ts` stays green unchanged after Task 1 alone. It does not: the STRING branch's new rejection of a non-write-safe split member makes `describeEntityCalls`'s preview refuse non-email fuzz probes (a 6000-char string, surrogate-straddling strings, a padded string, a CRLF multiline string) on `resource.emails`, while `resourceReader` called raw `sanitizeResource` and wrote them untouched. ★★★ A FIRST FIX ROUND HERE WRONGLY SAID TASK 2 CLOSES THIS GAP — it does not: Task 2's `resourceReader` migration (see Task 2's own entry) composes `refuseEmailWrite` for the SCALAR `resource.email` field only, and Task 2's self-review matrix credits `Resource.emails — all boundaries` to Task 1 alone. Global constraint: preview⇔write parity is pinned in the SAME task that adds the write check, so the actual fix is in Task 1: `resourceReader` composes `findTornEmail(patch.emails, undefined)` (mirroring the production merge-site guard, exactly as `absenceReader` composes `refuseInvalidAbsenceEmail`) and returns `null` on a torn value, closing the gap here rather than deferring it. Task 2's own `resourceReader` snippet is amended (see Task 2) to KEEP this composition when it adds the scalar `email` refusal, not replace it.
- The second grep lists tests that pass `emails` members without `@`. For each: if it is a NEW write through a boundary, MIGRATE it to a real address; if it only seeds stored state, no change. Record the labels in the commit body. (Verified for Task 1: every `emails` member across the second grep's hits already carries `@`, or the array is empty — no MIGRATE needed.)

- [ ] **Step 1: Write the failing tests**

Create `src/app/sanitize-core.email-rule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emailWriteRefusal, findTornEmail, isWriteSafeEmail } from "./sanitize";

describe("isWriteSafeEmail", () => {
  it("accepts a plain address and refuses a malformed or delimiter-bearing one", () => {
    expect(isWriteSafeEmail("ada@example.com")).toBe(true);
    expect(isWriteSafeEmail("  ada@example.com  ")).toBe(true);
    expect(isWriteSafeEmail("ada")).toBe(false);
    expect(isWriteSafeEmail("a,b@x.com")).toBe(false);
    expect(isWriteSafeEmail("a;b@x.com")).toBe(false);
    expect(isWriteSafeEmail("")).toBe(false);
  });
});

describe("emailWriteRefusal — the one scalar rule", () => {
  it("never refuses a blank value (clearing is legal)", () => {
    expect(emailWriteRefusal("", "a,b@x.com")).toBeNull();
    expect(emailWriteRefusal("   ", undefined)).toBeNull();
  });

  it("never refuses an unchanged value, even when the stored value is unsafe", () => {
    expect(emailWriteRefusal("a,b@x.com", "a,b@x.com")).toBeNull();
    expect(emailWriteRefusal(" not-an-email ", "not-an-email")).toBeNull();
  });

  it("refuses a CHANGED malformed value as invalid", () => {
    expect(emailWriteRefusal("nope", "ada@example.com")).toBe("invalid");
    expect(emailWriteRefusal("nope", undefined)).toBe("invalid");
  });

  it("refuses a CHANGED delimiter-bearing value as delimiter, since isValidEmail accepts it", () => {
    expect(emailWriteRefusal("a,b@x.com", undefined)).toBe("delimiter");
    expect(emailWriteRefusal("a;b@x.com", "ada@example.com")).toBe("delimiter");
  });

  it("accepts a changed write-safe value on create and on update", () => {
    expect(emailWriteRefusal("grace@example.com", undefined)).toBeNull();
    expect(emailWriteRefusal("grace@example.com", "ada@example.com")).toBeNull();
  });

  it("exempts a copy of a source's stored email (decision 2) and nothing else", () => {
    expect(emailWriteRefusal("a,b@x.com", "old@x.com", ["a,b@x.com"])).toBeNull();
    expect(emailWriteRefusal(" a,b@x.com ", undefined, [undefined, "a,b@x.com "])).toBeNull();
    expect(emailWriteRefusal("c,d@x.com", "old@x.com", ["a,b@x.com"])).toBe("delimiter");
  });
});

describe("findTornEmail — the list form of the same rule", () => {
  it("refuses a NEW array member that is not write-safe, malformed ones included", () => {
    expect(findTornEmail(["a@x.com", "not-an-email"], undefined)).toBe("not-an-email");
    expect(findTornEmail(["a@x.com", "b,c@x.com"], ["a@x.com"])).toBe("b,c@x.com");
  });

  it("never refuses a member already stored, or a blank member", () => {
    expect(findTornEmail(["not-an-email", ""], ["not-an-email"])).toBeUndefined();
    expect(findTornEmail([" a,b@x.com "], ["a,b@x.com"])).toBeUndefined();
  });

  it("for a STRING, still refuses a contained stored unsafe address", () => {
    expect(findTornEmail("a,b@x.com, c@y.com", ["a,b@x.com"])).toBe("a,b@x.com");
  });

  it("for a STRING, refuses a new split member that is not write-safe", () => {
    expect(findTornEmail("x,y@z.com", undefined)).toBe("x");
    expect(findTornEmail("c@y.com; nope", ["c@y.com"])).toBe("nope");
  });

  it("for a STRING, accepts a delimited list of write-safe addresses", () => {
    expect(findTornEmail("a@x.com, b@y.com", undefined)).toBeUndefined();
    expect(findTornEmail("", ["a,b@x.com"])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/sanitize-core.email-rule.test.ts --maxWorkers=1 --reporter=dot > "$LOG/t1.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |not a function" "$LOG/t1.log"`
Expected: EXIT=1 (`isWriteSafeEmail` / `emailWriteRefusal` are not exported).

- [ ] **Step 3: Implement the predicates**

In `src/app/sanitize-core.ts`, directly after `isDelimiterSafeEmail`, insert:

```ts
/** The two reasons a write boundary refuses an email value. */
export type EmailRefusal = "invalid" | "delimiter";

/** ★ THE WRITE PREDICATE: a loose-format address (`isValidEmail`) that is also
 *  delimiter-safe (`isDelimiterSafeEmail`). Neither component changes, and no
 *  load or decode path calls this. */
export function isWriteSafeEmail(s: string): boolean {
  return isValidEmail(s) && isDelimiterSafeEmail(s);
}

/** ★★★ THE ONE SCALAR WRITE RULE for every email field, refusing a value only
 *  when it CHANGES:
 *  1. a blank `incoming` is never refused — clearing is always legal;
 *  2. an `incoming` equal, trimmed, to `stored` is never refused, even when the
 *     stored value is itself unsafe (a create passes `stored = undefined`);
 *  3. an `incoming` equal, trimmed, to one of `copySources` is never refused —
 *     a copy of a person's STORED email made by a picker or a reassign;
 *  4. otherwise `"invalid"` when `isValidEmail` fails, `"delimiter"` when
 *     `isDelimiterSafeEmail` fails, else null. `"a,b@x.com"` passes
 *     `isValidEmail`, so it yields `"delimiter"`. */
export function emailWriteRefusal(
  incoming: string,
  stored: string | undefined,
  copySources: readonly (string | undefined)[] = [],
): EmailRefusal | null {
  const next = incoming.trim();
  if (next === "") return null;
  if (stored !== undefined && next === stored.trim()) return null;
  if (copySources.some((source) => source !== undefined && source.trim() === next)) return null;
  if (!isValidEmail(next)) return "invalid";
  if (!isDelimiterSafeEmail(next)) return "delimiter";
  return null;
}
```

Replace `findTornEmail`'s docstring and body (from `/** ★★★ THE ONE §422 RULE` to the function's closing brace) with:

```ts
/** ★★★ THE LIST FORM OF `emailWriteRefusal`, for `resource.emails` — the address
 *  an incoming value would store unsafely, or undefined. Every `emails` write
 *  boundary asks THIS with the same arguments: `createResource` (stored =
 *  undefined), `updateResource` (stored = the row's `emails`), the resource
 *  editor's save (stored = the resource as of when the modal opened) and
 *  `describeEntityCalls` (stored = the item's `emails`, judged on the RAW
 *  incoming value), so the card and the write cannot disagree.
 *  - ARRAY: the first string member that is non-blank, NOT already present
 *    (trimmed) in `stored`, and not `isWriteSafeEmail`. An array is written
 *    verbatim, so re-sending a stored member changes nothing and is allowed.
 *  - STRING: first, a stored delimiter-unsafe address the string contains
 *    (`sanitizeEmailList` would re-split it); then the first member the
 *    `[;,]` split produces that is new and not `isWriteSafeEmail`.
 *  - Anything else: undefined.
 *  ★ It stops NEW unsafe addresses only; stored ones keep loading. An address
 *   already torn by a past CSV, Markdown or Turso save cannot be rebuilt — the
 *   accepted limit recorded in open-followups §533. */
export function findTornEmail(
  incoming: unknown,
  stored: readonly string[] | undefined,
): string | undefined {
  const storedList = (stored ?? []).filter((e): e is string => typeof e === "string");
  const storedTrimmed = new Set(storedList.map((e) => e.trim()));
  const isNewUnsafe = (e: string): boolean =>
    e.trim() !== "" && !storedTrimmed.has(e.trim()) && !isWriteSafeEmail(e);
  if (Array.isArray(incoming)) {
    return incoming.find((e): e is string => typeof e === "string" && isNewUnsafe(e));
  }
  if (typeof incoming === "string") {
    const torn = storedList.find((e) => !isDelimiterSafeEmail(e) && incoming.includes(e.trim()));
    if (torn !== undefined) return torn;
    return incoming.split(/[;,]/).map((e) => e.trim()).find(isNewUnsafe);
  }
  return undefined;
}
```

- [ ] **Step 4: Keep the two existing callers' messages honest**

`src/app/resource-edit-modal.tsx`: change `import { ASSIGNEE_MAX, EMAIL_MAX, findTornEmail } from "./sanitize";` to `import { ASSIGNEE_MAX, EMAIL_MAX, emailWriteRefusal, findTornEmail } from "./sanitize";` and replace

```ts
    if (findTornEmail(emails, resource?.emails) !== undefined) {
      setError(t(lang, "resourceErrorEmailDelimiter"));
      return;
    }
```

with

```ts
    const tornEmail = findTornEmail(emails, resource?.emails);
    if (tornEmail !== undefined) {
      setError(t(lang, emailWriteRefusal(tornEmail, undefined) === "invalid" ? "errorInvalidEmail" : "resourceErrorEmailDelimiter"));
      return;
    }
```

`src/app/use-chat-dispatcher.ts`: add `emailWriteRefusal,` to the existing `./sanitize` import list (beside `findTornEmail,`). Add, directly above `export function useChatDispatcher`:

```ts
/** The §422 `emails` refusal text, naming WHICH rule the address broke. */
function emailsRefusalText(address: string): string {
  const reason = emailWriteRefusal(address, undefined) === "invalid" ? "emails is invalid" : 'emails must not contain "," or ";"';
  return `${reason} (${JSON.stringify(address)})`;
}
```

and change the two throws to

```ts
        if (unsafeEmail !== undefined) throw new Error(`invalid resource: ${emailsRefusalText(unsafeEmail)}`);
```

```ts
        if (unsafeEmail !== undefined) throw new Error(`invalid resource update: ${emailsRefusalText(unsafeEmail)}`);
```

- [ ] **Step 5: Recompute the two §422 test files**

`src/app/inline-ai-edit/emails-roundtrip.test.ts`:

```ts
    expect(findTornEmail("x,y@z.com", ["a,b@x.com"])).toBeUndefined();
```
→
```ts
    // A new split member must now be write-safe too: "x" is not an address.
    expect(findTornEmail("x,y@z.com", ["a,b@x.com"])).toBe("x");
```
and
```ts
    expect(findTornEmail("a,b@x.com", undefined)).toBeUndefined();
```
→
```ts
    expect(findTornEmail("a,b@x.com", undefined)).toBe("a");
```
If either enclosing `it(...)` title still says a string "refuses nothing" for a new row, retitle it "refuses only a member that is not write-safe". Also sweep the file header sentence that calls the rule delimiter-only.

`src/app/inline-ai-edit/emails-write-parity.test.ts`:

```ts
const EXPECT_REJECTED = new Set([
  "none/arrayAddsNewUnsafe",
  "safe/arrayAddsNewUnsafe",
  "unsafe/arrayAddsNewUnsafe",
  "unsafe/stringContainsStored",
  "none/stringNewComma",
  "safe/stringNewComma",
  "unsafe/stringNewComma",
]);
```

and extend the comment above it: "…or a string whose split yields a new member that is not an address."

- [ ] **Step 5b: Compose the list rule into `plan.sanitizer-parity.test.ts`'s `resourceReader` (controller ruling, fix round 1)**

`src/app/inline-ai-edit/plan.sanitizer-parity.test.ts`: add `findTornEmail,` to the `../sanitize` import list (beside `dropUnacceptedStakeholderFields,`). Replace

```ts
const resourceReader: StoredReader = (field, value) => {
  const patch = dropUnacceptedResourceFields({ [field]: value });
  const out = sanitizeResource({ ...RES_BASE, ...patch });
  return out ? readStored(out as unknown as Record<string, unknown>, field) : null;
};
```

with

```ts
const resourceReader: StoredReader = (field, value) => {
  const patch = dropUnacceptedResourceFields({ [field]: value });
  if (findTornEmail(patch.emails, undefined) !== undefined) return null;
  const out = sanitizeResource({ ...RES_BASE, ...patch });
  return out ? readStored(out as unknown as Record<string, unknown>, field) : null;
};
```

`RES_BASE` carries no `emails` key, so the stored list is `undefined` — the same "no stored list" `findTornEmail` sees from `createResource`, and mirrors how `absenceReader` composes `refuseInvalidAbsenceEmail` over its own patch before calling `sanitizeAbsence`. This closes the preview⇔write parity gap in THIS task (global constraint: the same task that gains a write check pins the matching `describeEntityCalls` rejection) rather than deferring it to Task 2.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/app/sanitize-core.email-rule.test.ts src/app/inline-ai-edit/emails-roundtrip.test.ts src/app/inline-ai-edit/emails-write-parity.test.ts src/app/inline-ai-edit/plan.sanitizer-parity.test.ts src/app/inline-ai-edit/plan.test.ts src/app/resource-edit-modal.test.tsx src/app/use-chat-dispatcher.test.tsx --maxWorkers=1 --reporter=dot > "$LOG/t1.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG/t1.log"`
Expected: EXIT=0, `Test Files 7 passed (7)`.

- [ ] **Step 7: Mutation-check the list rule**

Edit `isNewUnsafe`'s `!isWriteSafeEmail(e)` to `!isDelimiterSafeEmail(e)`; rerun `sanitize-core.email-rule.test.ts` alone and confirm EXIT=1; revert with the inverse Edit; confirm `git diff --stat` is identical to before the mutation.

- [ ] **Step 8: Typecheck, lint, size**

```bash
npx tsc --noEmit > "$LOG/tsc.log" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$LOG/tsc.log"
npx eslint --max-warnings=0 src/app/sanitize-core.ts src/app/sanitize-core.email-rule.test.ts src/app/resource-edit-modal.tsx src/app/use-chat-dispatcher.ts src/app/inline-ai-edit/emails-roundtrip.test.ts src/app/inline-ai-edit/emails-write-parity.test.ts src/app/inline-ai-edit/plan.sanitizer-parity.test.ts; echo "EXIT=$?"
npm run size:check > "$LOG/size.log" 2>&1; echo "EXIT=$?"
```
Expected: 0 `error TS`, EXIT=0 for each.

- [ ] **Step 9: Commit**

Subject `feat: one changed-only email write rule and its list form`; the body names the three predicates and justifies each RECOMPUTE.

```bash
git add src/app/sanitize-core.ts src/app/sanitize-core.email-rule.test.ts src/app/resource-edit-modal.tsx src/app/use-chat-dispatcher.ts src/app/inline-ai-edit/emails-roundtrip.test.ts src/app/inline-ai-edit/emails-write-parity.test.ts src/app/inline-ai-edit/plan.sanitizer-parity.test.ts
git commit --only src/app/sanitize-core.ts src/app/sanitize-core.email-rule.test.ts src/app/resource-edit-modal.tsx src/app/use-chat-dispatcher.ts src/app/inline-ai-edit/emails-roundtrip.test.ts src/app/inline-ai-edit/emails-write-parity.test.ts src/app/inline-ai-edit/plan.sanitizer-parity.test.ts -F "$LOG/msg-t1.txt"; echo "EXIT=$?"
```

---

### Task 2: Write boundaries outside the editors — escalation split, AI tools, bulk edit, prompt flows, inline-AI card, inline cell

**Files:**
- Modify: `src/app/raid-escalation.ts` (add `isEscalationWriteEmail`; `requireEscalationRecipient` uses it; header comment)
- Modify: `src/app/escalate-popover.tsx` (`canConfirm`)
- Modify: `src/app/use-action-center-handlers.ts` (`handleEscalate`)
- Create: `src/app/record-email-guards.ts`; Modify: `src/app/sanitize.ts` (barrel line)
- Modify: `src/app/absence-email.ts` (`refuseInvalidAbsenceEmail` gains `stored`)
- Modify: `src/app/use-register-tools.ts` (`createRaid`, `updateRaid`, `createStakeholder`, `updateStakeholder`, `updateAbsence`)
- Modify: `src/app/use-chat-dispatcher.ts` (`createTask`, `createResource`, `updateResource`, `sendInquiry`)
- Modify: `src/app/chat-task-patch.ts` (`buildTaskCleanPatch`)
- Modify: `src/app/bulk-operations-helpers.ts` (`BulkEditBuild`, `buildBulkEditUpdates`), `src/app/use-bulk-operations.ts` (error key, bulk inquiry)
- Modify: `src/app/use-task-row-handlers.ts` (`onSendInquiry`), `src/app/use-resource-planner.ts` (`handleSendRaidInquiry`)
- Modify: `src/app/inline-ai-edit/plan.ts` (email guard), `src/app/inline-ai-edit/entity-descriptor.ts` (`emailFormatFields` for raid, stakeholder, resource + two stale comments)
- Modify: `src/app/task-inline-patch.ts`, `src/app/tasks-section.tsx` (`onInlinePatch`)
- Create: `src/app/email-refusal-i18n.ts`
- Modify: `src/app/i18n.ts` (EN `errorEmailDelimiter`), `src/app/i18n.de.ts` (DE, node script)
- Tests: see census.

**Interfaces:**
- Consumes (Task 1): `EmailRefusal`, `isWriteSafeEmail`, `emailWriteRefusal`.
- Produces:
  - `isEscalationWriteEmail(s: string): boolean` (`raid-escalation.ts`)
  - `refuseEmailWrite(field: string, incoming: unknown, stored: string | undefined): void` and `emailRefusalMessage(field: string, refusal: EmailRefusal): string` (`record-email-guards.ts`, via `./sanitize`)
  - `refuseInvalidAbsenceEmail(accepted: { assigneeEmail?: unknown }, stored?: string): void`
  - `EMAIL_REFUSAL_KEY: Readonly<Record<EmailRefusal, "errorInvalidEmail" | "errorEmailDelimiter">>` (`email-refusal-i18n.ts`)
  - `BulkEditBuild` error union gains `"emailDelimiter"`
  - `InlinePatchContext` gains `storedAssigneeEmail?: string` and `copySourceEmails?: readonly string[]`; new `inlineAssigneeEmailRefusal(patch: Partial<Task>, ctx: InlinePatchContext): EmailRefusal | null`
  - i18n key `errorEmailDelimiter` (EN + DE)

**Test census (run first; label every hit):**

```bash
git grep -n "isEscalationEmail\|requireEscalationRecipient\|refuseInvalidAbsenceEmail\|buildTaskCleanPatch\|buildBulkEditUpdates\|sanitizeInlinePatch\|emailFormatFields\|errorInvalidEmail" -- src e2e scripts | grep "\.test\.\|/test/\|e2e/\|scripts/"
git grep -n "ownerEmail\|stakeholder.*email\|email:" -- "src/app/use-chat-dispatcher*.test.tsx" "src/app/chat-tools*.test.ts" "src/app/inline-ai-edit/*.test.ts" | grep -v "@"
```

- ADD `raid-escalation.test.ts`: a `describe("isEscalationWriteEmail")` (write leg refuses `a,b@x.com`; `isEscalationEmail` still accepts it — the load leg is unchanged).
- MIGRATE `raid-escalation.test.ts` `describe("requireEscalationRecipient — toEmail rejects …")`: add a `a,b@x.com` case. The `isEscalationEmail` describe stays as the load-leg pin.
- MIGRATE `escalate-popover.test.tsx` and `use-action-center-handlers.test.ts`: the "would otherwise pass isValidEmail" comments name `isEscalationWriteEmail`; ADD one delimiter case each.
- ADD `chat-tools.test.ts` escalate table row `[{ toEmail: "a,b@x.com" }, /toEmail must be a valid email/]`.
- ADD `chat-task-patch.test.ts`, `bulk-operations-helpers.test.ts`, `task-inline-patch.test.ts`, `tasks-section.test.tsx` cases (code below).
- ADD `use-chat-dispatcher.test.tsx`: `createTask`/`createResource`/`updateResource` (`email`), `createRaid`/`updateRaid` (`ownerEmail`), `createStakeholder`/`updateStakeholder` (`email`), `updateAbsence` changed-only.
- MIGRATE `inline-ai-edit/plan.sanitizer-parity.test.ts`: `raidReader`, `stakeholderReader`, `resourceReader` compose `refuseEmailWrite` for their SCALAR email field, exactly as `absenceReader` composes `refuseInvalidAbsenceEmail`; `absenceReader` passes `ABS_BASE.assigneeEmail` as stored. `resourceReader` ADDS this beside the `findTornEmail(patch.emails, undefined)` composition Task 1 already put there for the LIST field `emails` — Task 2 must not remove or replace that line, only add the scalar `email` check next to it (controller ruling, Task 1 fix round 1).
- ADD `inline-ai-edit/plan.test.ts`: raid `ownerEmail`, stakeholder `email`, resource `email` rejected-when-changed, accepted-when-unchanged-unsafe.
- RECOMPUTE `inline-ai-edit/descriptor-drift.test.ts`, `plan.offered-surface-sweep.test.ts`, `plan.write-path-sweep.test.ts`, `plan.model-writable-surface.test.ts`, `plan.create-path-guards.test.ts`: any expectation that `emailFormatFields` is `assigneeEmail`-only, or that a raid/stakeholder/resource `email`/`ownerEmail` probe lands, now changes. Each changed expectation is justified in the commit body.
- ADD `use-task-row-handlers.test.ts`, `use-bulk-operations.test.tsx`, `use-resource-planner.test.tsx`: a typed `a,b@x.com` in the prompt is refused (alert/toast) and nothing is written.
- The second grep lists AI-test fixtures sending an email without `@`: each is MIGRATE (real address) when it is a changed value through a writer, else no change.
- Unaffected: `e2e/` and `scripts/` (census prints no hit there at HEAD).

- [ ] **Step 1: Add the i18n key (both languages)**

`src/app/i18n.ts` (Edit tool): directly after `  errorInvalidEmail: "That doesn't look like a valid email address.",` add
`  errorEmailDelimiter: "An email address cannot contain a comma or a semicolon.",`

`src/app/i18n.de.ts` — write `$LOG/de-t2.cjs` with the Write tool:

```js
const fs = require("fs");
const P = "src/app/i18n.de.ts";
const s = fs.readFileSync(P, "utf8");
const anchor = "  errorInvalidEmail: \"Das sieht nicht nach einer g\u00fcltigen E-Mail-Adresse aus.\",\r\n";
const count = s.split(anchor).length - 1;
if (count !== 1) { console.error("anchor count " + count); process.exit(1); }
const add = "  errorEmailDelimiter: \"Eine E-Mail-Adresse darf weder ein Komma noch ein Semikolon enthalten.\",\r\n";
fs.writeFileSync(P, s.replace(anchor, anchor + add), "utf8");
console.log("ok");
```

★ Every DE script in this plan spells a non-ASCII character as a `\u` escape (`\u00e4` for ä, `\u00f6` for ö, `\u00fc` for ü, `\u00df` for ß), so the `.cjs` file itself is pure ASCII and the Write tool cannot corrupt it. The escapes become real umlauts when node evaluates the string literal.

Run `node "$LOG/de-t2.cjs"; echo "EXIT=$?"`. Then write `$LOG/de-check-t2.cjs` with the Write tool. It re-reads the bytes and exits 1 on any mismatch:

```js
const fs = require("fs");
const s = fs.readFileSync("src/app/i18n.de.ts", "utf8");
// The anchor and the added line, adjacent, CRLF, real umlauts, exactly once.
const expected = "  errorInvalidEmail: \"Das sieht nicht nach einer g\u00fcltigen E-Mail-Adresse aus.\",\r\n"
  + "  errorEmailDelimiter: \"Eine E-Mail-Adresse darf weder ein Komma noch ein Semikolon enthalten.\",\r\n";
const problems = [];
const bareLf = (s.match(/(?<!\r)\n/g) || []).length;
if (bareLf !== 0) problems.push("bareLF " + bareLf);
if (s.includes("\ufffd")) problems.push("U+FFFD replacement character present");
const hits = s.split(expected).length - 1;
if (hits !== 1) problems.push("expected bytes found " + hits + " time(s)");
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("ok");
```

Run `node "$LOG/de-check-t2.cjs"; echo "EXIT=$?"` — Expected `ok`, `EXIT=0`. Any other result is a STOP: do not patch by hand.

Create `src/app/email-refusal-i18n.ts`:

```ts
// Maps an `EmailRefusal` (sanitize-core.ts) to the ONE message each reason
// shows in every UI surface: editors, toasts, prompt alerts. Kept out of the
// i18n-free sanitizers on purpose.
import type { EmailRefusal } from "./sanitize-core";

export const EMAIL_REFUSAL_KEY: Readonly<Record<EmailRefusal, "errorInvalidEmail" | "errorEmailDelimiter">> = {
  invalid: "errorInvalidEmail",
  delimiter: "errorEmailDelimiter",
};
```

- [ ] **Step 2: Escalation split — failing tests, then code**

Append to `src/app/raid-escalation.test.ts` (add `isEscalationWriteEmail` to its import from `./raid-escalation`):

```ts
describe("isEscalationWriteEmail — the WRITE leg (spec Part 1 dual-use split)", () => {
  it("refuses a delimiter-bearing address the load leg still accepts", () => {
    expect(isEscalationWriteEmail("a,b@x.com")).toBe(false);
    expect(isEscalationWriteEmail("a;b@x.com")).toBe(false);
    // Load leg unchanged: a stored escalation carrying it is not dropped.
    expect(isEscalationEmail("a,b@x.com")).toBe(true);
  });
  it("keeps the bracket refusal and accepts a plain address", () => {
    expect(isEscalationWriteEmail("a<br>@b.co")).toBe(false);
    expect(isEscalationWriteEmail("jane@example.com")).toBe(true);
  });
  it("requireEscalationRecipient refuses a delimiter-bearing address", () => {
    expect(() => requireEscalationRecipient({ toEmail: "a,b@x.com" })).toThrow(/toEmail must be a valid email/);
  });
});
```

In `src/app/escalate-popover.test.tsx`, after the `<br>` case, add:

```ts
  it("keeps confirm disabled for a delimiter-bearing address (write predicate)", () => {
    render(<EscalatePopover rowToken="Row" lang="en-US" action={action(1)} bundle={bundle([issue()])} />);
    fireEvent.click(screen.getByRole("button", { name: "Escalate – Row" }));
    const dialog = screen.getByRole("dialog");
    const email = within(dialog).getByPlaceholderText(/email/i);
    fireEvent.change(email, { target: { value: "boss@example.com" } });
    expect(within(dialog).getByRole("button", { name: "Escalate now" })).toHaveProperty("disabled", false);
    fireEvent.change(email, { target: { value: "a,b@x.com" } });
    expect(within(dialog).getByRole("button", { name: "Escalate now" })).toHaveProperty("disabled", true);
  });
```

In `src/app/use-action-center-handlers.test.ts`, after the `<br>` case, add:

```ts
  it("writes nothing for a delimiter-bearing address and shows the delimiter message", () => {
    const setRaid = vi.fn();
    const showToast = vi.fn();
    const logActivity = vi.fn();
    const { result } = renderHook(() => useActionCenterHandlers(makeDeps({ raid: [item], setRaid, showToast, logActivity })));
    act(() => { result.current.escalateBundle!.onEscalate(escalateAction, { ...recipient, email: "a,b@x.com" }); });
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "errorEmailDelimiter"));
    expect(setRaid).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
```
(If `t` is not yet imported there, add `import { t } from "./i18n";`.) Update the two "would otherwise pass isValidEmail" comments in both files to name `isEscalationWriteEmail`.

In `src/app/chat-tools.test.ts`, add the row `[{ toEmail: "a,b@x.com" }, /toEmail must be a valid email/],` after `[{ toEmail: "a@b.co>" }, /toEmail must be a valid email/],`.

Run: `npx vitest run src/app/raid-escalation.test.ts src/app/escalate-popover.test.tsx src/app/use-action-center-handlers.test.ts src/app/chat-tools.test.ts --maxWorkers=1 --reporter=dot > "$LOG/t2a.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG/t2a.log"` — Expected: EXIT=1 (new cases fail).

Code, `src/app/raid-escalation.ts`: change `import { isValidEmail } from "./sanitize-core";` to `import { isValidEmail, isWriteSafeEmail } from "./sanitize-core";`. After `isEscalationEmail`, add:

```ts
/** ★★ THE WRITE FORM of `isEscalationEmail`, and the split is the point.
 *  `isEscalationEmail` above stays the LOAD predicate (`sanitizeEntry`), so no
 *  stored escalation starts being dropped. Every WRITER — `requireEscalationRecipient`
 *  (AI `escalate_raid_item`), `escalate-popover.tsx` `canConfirm` and the
 *  escalate handler in `use-action-center-handlers.ts` — asks THIS, which also
 *  refuses "," and ";" (the one email write rule, `isWriteSafeEmail`). */
export function isEscalationWriteEmail(s: string): boolean {
  return isWriteSafeEmail(s) && !/[<>]/.test(s);
}
```

In `requireEscalationRecipient` replace `!isEscalationEmail(email)` with `!isEscalationWriteEmail(email)`. In the file header, after the `isEscalationEmail` sentence, add `// ★ \`isEscalationEmail\` is the LOAD predicate; writers use \`isEscalationWriteEmail\`.`

`src/app/escalate-popover.tsx`: import `isEscalationWriteEmail` instead of `isEscalationEmail`; `const canConfirm = isEscalationWriteEmail(resolvedEmail);`; comment above it names the write predicate.

`src/app/use-action-center-handlers.ts`: import `isEscalationWriteEmail` (drop `isEscalationEmail`), add `import { emailWriteRefusal } from "./sanitize";` names to the existing `./sanitize` import (it imports `isValidEmail`), add `import { EMAIL_REFUSAL_KEY } from "./email-refusal-i18n";`, and replace the guard line with:

```ts
      if (!isEscalationWriteEmail(recipient.email)) { showToast("error", t(lang, EMAIL_REFUSAL_KEY[emailWriteRefusal(recipient.email, undefined) ?? "invalid"])); return; }
```

Rerun the four files. Expected: EXIT=0, `Test Files 4 passed (4)`.

- [ ] **Step 3: AI record writers — failing tests**

Append to `src/app/use-chat-dispatcher.test.tsx` a new `describe` (it uses the file's `renderDispatcher`, `seedTasks`, `act`):

```ts
describe("the email write rule on AI writers (spec Part 1)", () => {
  it("createTask refuses a delimiter-bearing assigneeEmail", () => {
    const { result } = renderDispatcher();
    expect(() => result.current.createTask({ taskName: "T", assignee: "Ada", dueDate: "2026-06-01", assigneeEmail: "a,b@x.com" })).toThrow('assigneeEmail must not contain "," or ";"');
  });

  it("updateTask keeps a stored unsafe assigneeEmail when it is echoed unchanged", () => {
    const seeded = seedTasks().map((row, i) => (i === 0 ? { ...row, assigneeEmail: "a,b@x.com" } : row));
    const { result } = renderDispatcher(seeded);
    const id = seeded[0].id;
    act(() => { result.current.updateTask(id, { assigneeEmail: "a,b@x.com", taskName: "Renamed" }); });
    expect(result.current.getTask(id)).toMatchObject({ taskName: "Renamed", assigneeEmail: "a,b@x.com" });
  });

  it("createResource refuses a malformed primary email and writes nothing", () => {
    const { result } = renderDispatcher();
    expect(() => result.current.createResource({ firstName: "Ada", email: "nope" })).toThrow("email is invalid");
    expect(result.current.listResources()).toHaveLength(0);
  });

  it("updateResource refuses a CHANGED delimiter-bearing primary email", () => {
    const { result } = renderDispatcher();
    let id = 0;
    act(() => { id = result.current.createResource({ firstName: "Ada", lastName: "L", email: "ada@x.com" }).id; });
    expect(() => result.current.updateResource(id, { email: "a;b@x.com" })).toThrow('email must not contain "," or ";"');
    expect(result.current.getResourceRow(id)?.email).toBe("ada@x.com");
  });

  it("createRaid refuses a malformed ownerEmail; createStakeholder refuses a delimiter-bearing email", () => {
    const { result } = renderDispatcher();
    expect(() => result.current.createRaid({ category: "R", title: "Risk", ownerEmail: "nope" })).toThrow("ownerEmail is invalid");
    expect(() => result.current.createStakeholder({ name: "Sam", email: "a,b@x.com" })).toThrow('email must not contain "," or ";"');
  });
});
```

If `createRaid`/`createStakeholder` input types reject these literal shapes, cast the argument with `as never` — the subject is the runtime refusal.

Run: `npx vitest run src/app/use-chat-dispatcher.test.tsx --maxWorkers=1 --reporter=dot > "$LOG/t2b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG/t2b.log"` — Expected: EXIT=1.

- [ ] **Step 4: AI record writers — code**

Create `src/app/record-email-guards.ts`:

```ts
// Write-boundary email guards shared by every AI/tool writer (spec Part 1).
// Kept out of sanitize-records.ts, which sits at the file-size LIMIT, and
// re-exported through the `./sanitize` barrel like absence-email.ts.
import { emailWriteRefusal, sanitizeEmail, type EmailRefusal } from "./sanitize-core";

/** The model-facing refusal text, one shape per reason. Unlocalized on purpose,
 *  like every other throw a tool writer surfaces. */
export function emailRefusalMessage(field: string, refusal: EmailRefusal): string {
  return refusal === "invalid" ? `${field} is invalid` : `${field} must not contain "," or ";"`;
}

/** Throws when `incoming` would store a CHANGED email that is not write-safe
 *  (`emailWriteRefusal`, judged against the row's `stored` value; a create
 *  passes undefined). A non-string `incoming` is not this guard's business —
 *  the record sanitizer blanks it — and a blank one is a legal clear. */
export function refuseEmailWrite(field: string, incoming: unknown, stored: string | undefined): void {
  if (typeof incoming !== "string") return;
  const refusal = emailWriteRefusal(sanitizeEmail(incoming), stored);
  if (refusal !== null) throw new Error(emailRefusalMessage(field, refusal));
}
```

`src/app/sanitize.ts`: append `export * from "./record-email-guards";`.

`src/app/absence-email.ts`: replace the import line with `import { refuseEmailWrite } from "./record-email-guards";`, replace the last docstring sentence "`raid.ownerEmail` keeps the old unchecked shape." with "Since the email write rule (spec Part 1) every email field shares this shape through `refuseEmailWrite`; `stored` is the row's value on update, so an unchanged stored address is never refused.", and replace the function with:

```ts
export function refuseInvalidAbsenceEmail(accepted: { assigneeEmail?: unknown }, stored?: string): void {
  refuseEmailWrite("assigneeEmail", accepted.assigneeEmail, stored);
}
```

`src/app/use-register-tools.ts` (add `refuseEmailWrite,` to the existing `./sanitize` import list beside `refuseInvalidAbsenceEmail,`):
- `createRaid`: first line after `if (isReadOnly) throw readOnlyError();` → `refuseEmailWrite("ownerEmail", (input as { ownerEmail?: unknown }).ownerEmail, undefined);`
- `updateRaid`: after `if (!existing) return null;` → `refuseEmailWrite("ownerEmail", (patch as { ownerEmail?: unknown }).ownerEmail, existing.ownerEmail);`
- `createStakeholder`: after the read-only throw → `refuseEmailWrite("email", (input as { email?: unknown }).email, undefined);`
- `updateStakeholder`: after `if (!existing) return null;` → `refuseEmailWrite("email", (patch as { email?: unknown }).email, existing.email);`
- `updateAbsence`: `refuseInvalidAbsenceEmail(accepted);` → `refuseInvalidAbsenceEmail(accepted, existing.assigneeEmail);` (`createAbsence` keeps the one-argument call).

`src/app/use-chat-dispatcher.ts` (add `isWriteSafeEmail,` and `refuseEmailWrite,` to the `./sanitize` import; drop `isValidEmail` only if no use remains):
- `sendInquiry`: `if (!email && isValidEmail(task.assignee))` → `if (!email && isWriteSafeEmail(task.assignee))`.
- `createTask`: replace
```ts
        const email = sanitizeEmail(input.assigneeEmail);
        if (email && !isValidEmail(email))
          throw new Error("assigneeEmail is invalid");
```
with
```ts
        const email = sanitizeEmail(input.assigneeEmail);
        refuseEmailWrite("assigneeEmail", email, undefined);
```
- `createResource`: after the `findTornEmail` throw → `refuseEmailWrite("email", input.email, undefined);`
- `updateResource`: after its `findTornEmail` throw → `refuseEmailWrite("email", patch.email, existing.email);`

`src/app/chat-task-patch.ts`: replace `isValidEmail,` in the import with `refuseEmailWrite,` and the block with

```ts
  if (patch.assigneeEmail !== undefined) {
    const e = sanitizeEmail(patch.assigneeEmail);
    refuseEmailWrite("assigneeEmail", e, existing.assigneeEmail);
    cleanPatch.assigneeEmail = e;
  }
```

Add to `src/app/chat-task-patch.test.ts` (reuse its existing task fixture; the name `base` below stands for whatever `Task` fixture that file declares — read the top of the file and use that identifier):

```ts
describe("assigneeEmail follows the changed-only write rule", () => {
  it("refuses a changed delimiter-bearing address", () => {
    expect(() => buildTaskCleanPatch({ assigneeEmail: "a,b@x.com" }, base)).toThrow('assigneeEmail must not contain "," or ";"');
  });
  it("keeps an unchanged stored unsafe address", () => {
    expect(buildTaskCleanPatch({ assigneeEmail: "a,b@x.com" }, { ...base, assigneeEmail: "a,b@x.com" }).assigneeEmail).toBe("a,b@x.com");
  });
});
```

Rerun `use-chat-dispatcher.test.tsx` and `chat-task-patch.test.ts`. Expected: EXIT=0, `Test Files 2 passed (2)`.

- [ ] **Step 5: Inline-AI card parity**

`src/app/inline-ai-edit/plan.ts`: in the import from `"../sanitize"` replace `isValidEmail` with `emailWriteRefusal`. Replace

```ts
        if (d.emailFormatFields.has(f) && after !== "" && !isValidEmail(after)) { bad(`${f}=${after}`); continue; }
```
with
```ts
        if (d.emailFormatFields.has(f) && emailWriteRefusal(after, str(item[f])) !== null) { bad(`${f}=${after}`); continue; }
```
and rewrite the comment block above it: the writer's guard is now `refuseEmailWrite` (changed-only, format + delimiter), the card asks the same `emailWriteRefusal` against the stored `item[f]`, and blank stays legal.

`src/app/inline-ai-edit/entity-descriptor.ts`: raid `emailFormatFields: new Set(["ownerEmail"])`, stakeholder `emailFormatFields: new Set(["email"])`, resource `emailFormatFields: new Set(["email"])`. Replace the task comment `// ★ The ONLY member across all six entities: \`buildTaskCleanPatch\` throws` / `//   on a malformed address, and the throw fails the whole patch.` with `// ★ Every email field's writer throws through \`refuseEmailWrite\`, and a throw` / `//   fails the whole patch, so the card refuses the field first.`; in the absence comment, delete the sentence that starts at the end of one comment line and ends on the next. At HEAD the two lines read exactly (the first line keeps its leading text, which is shown here as `…`):
`    //  gain one — that would drop stored data. ★★ \`raid.ownerEmail\` is still`
`    //  UNCHECKED on both sides, so its set stays empty.`
Replace that two-line pair with the single line `    //  gain one — that would drop stored data.` (the Edit tool's `old_string` spans both lines, CRLF). Confirm with `grep -n "UNCHECKED" src/app/inline-ai-edit/entity-descriptor.ts`, which must print nothing.

`src/app/inline-ai-edit/plan.sanitizer-parity.test.ts`: add `refuseEmailWrite` to the `../sanitize` import and compose it in three readers (and pass stored in the fourth). `resourceReader` already carries Task 1's `findTornEmail(patch.emails, undefined)` line for the LIST field `emails` — ADD the scalar `email` check beside it, do not remove it:

```ts
const stakeholderReader: StoredReader = (field, value) => {
  const patch = dropUnacceptedStakeholderFields({ [field]: value });
  try {
    refuseEmailWrite("email", (patch as { email?: unknown }).email, STK_BASE.email);
  } catch {
    return null; // updateStakeholder surfaces the throw as a failed tool call
  }
  const out = sanitizeStakeholder({ ...STK_BASE, ...patch });
  return out ? readStored(out as unknown as Record<string, unknown>, field) : null;
};
```

```ts
const raidReader: StoredReader = (field, value) => {
  const patch = dropUnacceptedRaidFields(
    { [field]: value },
    RAID_BASE as unknown as Pick<RaidItem, "category">,
  );
  try {
    refuseEmailWrite("ownerEmail", (patch as { ownerEmail?: unknown }).ownerEmail, RAID_BASE.ownerEmail);
  } catch {
    return null; // updateRaid surfaces the throw as a failed tool call
  }
  const out = sanitizeRaidItem({ ...RAID_BASE, ...patch });
  return out ? readStored(out as unknown as Record<string, unknown>, field) : null;
};
```

```ts
const resourceReader: StoredReader = (field, value) => {
  const patch = dropUnacceptedResourceFields({ [field]: value });
  // Task 1's LIST-field guard, kept — do not remove this line in Task 2.
  if (findTornEmail(patch.emails, undefined) !== undefined) return null;
  try {
    refuseEmailWrite("email", (patch as { email?: unknown }).email, RES_BASE.email);
  } catch {
    return null; // updateResource surfaces the throw as a failed tool call
  }
  const out = sanitizeResource({ ...RES_BASE, ...patch });
  return out ? readStored(out as unknown as Record<string, unknown>, field) : null;
};
```

and in `absenceReader` change `refuseInvalidAbsenceEmail(patch);` to `refuseInvalidAbsenceEmail(patch, ABS_BASE.assigneeEmail);`. (If a `*_BASE` constant has no email property, TypeScript reports `undefined` access as fine; if it is typed without the key, use `(STK_BASE as { email?: string }).email`.)

Add to `src/app/inline-ai-edit/plan.test.ts`, after "clips a stakeholder email at ITS cap":

```ts
  it.each([
    ["raid", "update_raid_item", "ownerEmail", { id: 1, title: "Risk", category: "R", ownerEmail: "old@x.com" }],
    ["stakeholder", "update_stakeholder", "email", { id: 1, name: "Sam", email: "old@x.com" }],
    ["resource", "update_resource", "email", { id: 1, firstName: "Ada", lastName: "L", email: "old@x.com" }],
  ] as const)("%s: refuses a changed delimiter-bearing email and allows an unchanged unsafe one", (entity, tool, field, stored) => {
    const d = INLINE_DESCRIPTORS[entity];
    const changed = describeEntityCalls(
      [{ type: "tool_use", name: tool, input: { id: 1, [field]: "a,b@x.com" } }],
      { descriptor: d, item: stored as never, ws: wsWith({}) },
    );
    expect(changed.updates).toEqual([]);
    expect(changed.rejected.map((r) => r.reason)).toEqual(["bad-input"]);

    const legacy = { ...stored, [field]: "a,b@x.com" };
    const echoed = describeEntityCalls(
      [{ type: "tool_use", name: tool, input: { id: 1, [field]: "a,b@x.com" } }],
      { descriptor: d, item: legacy as never, ws: wsWith({}) },
    );
    expect(echoed.rejected).toEqual([]);
  });
```

Run: `npx vitest run src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/plan.sanitizer-parity.test.ts src/app/inline-ai-edit/descriptor-drift.test.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/app/inline-ai-edit/plan.write-path-sweep.test.ts src/app/inline-ai-edit/plan.model-writable-surface.test.ts src/app/inline-ai-edit/plan.create-path-guards.test.ts --maxWorkers=1 --reporter=dot > "$LOG/t2c.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" "$LOG/t2c.log"`
Expected after RECOMPUTE: EXIT=0, `Test Files 7 passed (7)`. For each red expectation, decide from the census label; never loosen a parity assertion to go green.

Mutation check: revert the `entity-descriptor.ts` raid set to `new Set()` and confirm `plan.sanitizer-parity.test.ts` goes red; restore; `git diff --stat` unchanged.

- [ ] **Step 6: Bulk edit and prompt flows**

`src/app/bulk-operations-helpers.ts`: replace `isValidEmail,` in the import with `emailWriteRefusal,`; change the type and guard:

```ts
export type BulkEditBuild =
  | { ok: false; error: "pastDate" | "invalidEmail" | "emailDelimiter" }
  | { ok: true; updates: Partial<Task> };
```

```ts
  const newEmail = fields.assigneeEmail ? sanitizeEmail(bulkEdit.assigneeEmail) : "";
  // A bulk value is TYPED, never a stored one, so it is judged as a create.
  const emailRefusal = fields.assigneeEmail ? emailWriteRefusal(newEmail, undefined) : null;
  if (emailRefusal === "invalid") return { ok: false, error: "invalidEmail" };
  if (emailRefusal === "delimiter") return { ok: false, error: "emailDelimiter" };
```

`src/app/use-bulk-operations.ts`: the error key becomes

```ts
        t(lang, built.error === "pastDate" ? "errorPastDate" : built.error === "emailDelimiter" ? "errorEmailDelimiter" : "errorInvalidEmail"),
```

and the bulk inquiry prompt (import `isWriteSafeEmail`, `emailWriteRefusal` from `./sanitize` in place of `isValidEmail`, and `EMAIL_REFUSAL_KEY` from `./email-refusal-i18n`):

```ts
      if (!email && isWriteSafeEmail(task.assignee)) email = task.assignee.trim();
      if (!email) {
        const provided = window.prompt(t(lang, "promptEmail", task.assignee), "");
        if (provided === null) continue;
        const trimmed = provided.trim();
        if (!isWriteSafeEmail(trimmed)) {
          showToastRef.current("error", t(lang, EMAIL_REFUSAL_KEY[emailWriteRefusal(trimmed, undefined) ?? "invalid"]));
          continue;
        }
```

`src/app/use-task-row-handlers.ts` (`import { isValidEmail } from "./sanitize";` → `import { emailWriteRefusal, isWriteSafeEmail } from "./sanitize";`, plus `import { EMAIL_REFUSAL_KEY } from "./email-refusal-i18n";`):

```ts
      if (!email && isWriteSafeEmail(task.assignee)) {
```
```ts
        if (!isWriteSafeEmail(trimmed)) {
          window.alert(t(lang, EMAIL_REFUSAL_KEY[emailWriteRefusal(trimmed, undefined) ?? "invalid"]));
          return;
        }
```

`src/app/use-resource-planner.ts` (same import change): `if (!email && isWriteSafeEmail(item.owner ?? ""))` and the same alert shape with `isWriteSafeEmail(trimmed)`.

Tests — `src/app/bulk-operations-helpers.test.ts` (use the file's existing draft factory; read its top first and substitute its name for `draft` below):

```ts
  it("refuses a delimiter-bearing bulk email with its own error", () => {
    const built = buildBulkEditUpdates(draft({ enabled: { assigneeEmail: true }, assigneeEmail: "a,b@x.com" }), "2026-01-01");
    expect(built).toEqual({ ok: false, error: "emailDelimiter" });
  });
```

In `use-task-row-handlers.test.ts`, `use-bulk-operations.test.tsx` and `use-resource-planner.test.tsx`, copy each file's existing invalid-email prompt test (grep `errorInvalidEmail` / `window.prompt` in the file) and add a sibling whose prompt returns `"a,b@x.com"`, asserting the alert/toast text is `t("en-US", "errorEmailDelimiter")` and that `setTasks`/`setRaid` did not store it. If a file has no prompt test to copy, write the case against that hook's existing render helper and name the helper in the commit body.

Run: `npx vitest run src/app/bulk-operations-helpers.test.ts src/app/use-bulk-operations.test.tsx src/app/use-task-row-handlers.test.ts src/app/use-resource-planner.test.tsx --maxWorkers=1 --reporter=dot > "$LOG/t2d.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG/t2d.log"` — Expected EXIT=0, `Test Files 4 passed (4)`.

- [ ] **Step 7: Task inline cell — failing tests**

Append to `src/app/task-inline-patch.test.ts` (add `inlineAssigneeEmailRefusal` to its import):

```ts
describe("assigneeEmail follows the changed-only write rule (spec Part 1, decision 3)", () => {
  it("refuses a changed unsafe email and leaves the other keys intact", () => {
    const c = ctx({ storedAssigneeEmail: "old@x.com" });
    const patch = { assignee: "Bob", assigneeEmail: "a,b@x.com" };
    expect(inlineAssigneeEmailRefusal(patch, c)).toBe("delimiter");
    const out = sanitizeInlinePatch(patch, c);
    expect(out).not.toHaveProperty("assigneeEmail");
    expect(out.assignee).toBe("Bob");
  });

  it("keeps an unchanged stored unsafe email", () => {
    const c = ctx({ storedAssigneeEmail: "a,b@x.com" });
    expect(inlineAssigneeEmailRefusal({ assigneeEmail: "a,b@x.com" }, c)).toBeNull();
    expect(sanitizeInlinePatch({ assigneeEmail: "a,b@x.com" }, c).assigneeEmail).toBe("a,b@x.com");
  });

  it("exempts a copy of a picked resource's stored email — the only path the cell's picker can take", () => {
    const c = ctx({ storedAssigneeEmail: "old@x.com", copySourceEmails: ["a,b@x.com"] });
    expect(sanitizeInlinePatch({ assigneeEmail: "a,b@x.com", resourceId: 7 }, c).assigneeEmail).toBe("a,b@x.com");
  });

  it("never refuses a clear", () => {
    expect(inlineAssigneeEmailRefusal({ assigneeEmail: "" }, ctx({ storedAssigneeEmail: "a,b@x.com" }))).toBeNull();
  });
});
```

Add to `src/app/tasks-section.test.tsx`, inside the describe that holds the inline undo-capture tests (add `import { ToastProvider } from "./toast-context";` and `import { t } from "./i18n";` if missing):

```ts
  it("reverts a refused inline assignee email, applies the other keys, and toasts once (decision 3)", () => {
    const task = { id: 1, taskName: "T1", assignee: "Ada", assigneeEmail: "old@x.com" };
    let currentTasks: unknown[] = [task];
    const setTasks = vi.fn((updater: (prev: unknown[]) => unknown[]) => {
      currentTasks = updater(currentTasks);
    });
    mockUseWorkspace.mockReturnValue({
      tasks: currentTasks,
      setTasks,
      filteredSortedTasks: currentTasks,
      uniqueAssignees: [],
      uniqueGroups: [],
      uniqueLabels: [],
      effectiveFilters: { assignee: "All", group: "All", label: "All" },
      tasksById: new Map(),
      taskSearchIndex: new Map(),
      resources: [],
      raid: [], setRaid: vi.fn(),
      absences: [], setAbsences: vi.fn(),
      shifts: [], setShifts: vi.fn(),
    });
    const showToast = vi.fn();
    render(
      <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
        <TasksSection {...makeProps()} />
      </ToastProvider>,
    );
    const ctx = capturedRowContext.current as {
      onInlinePatch: (id: number, patch: Record<string, unknown>) => void;
    };
    act(() => {
      ctx.onInlinePatch(1, { assignee: "Bob", assigneeEmail: "a,b@x.com" });
    });
    expect(currentTasks[0]).toMatchObject({ assignee: "Bob", assigneeEmail: "old@x.com" });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "errorEmailDelimiter"));
  });
```

(`makeProps()` must yield `lang: "en-US"`; confirm by reading it, and pass `lang="en-US"` explicitly if it does not.)

Run both files; Expected EXIT=1.

- [ ] **Step 8: Task inline cell — code**

`src/app/task-inline-patch.ts`: add `emailWriteRefusal,` to the `./sanitize` import and `import type { EmailRefusal } from "./sanitize-core";`. Extend the context and add the refusal:

```ts
export interface InlinePatchContext {
  /** True when the id points at a live directory resource (FK validation). */
  hasResource: (id: number) => boolean;
  /** Ids of all live tasks — dependency targets must exist. */
  knownTaskIds: ReadonlySet<number>;
  /** The task being edited (self-dependency guard). */
  ownTaskId: number;
  /** The row's STORED assignee email — an unchanged value is never refused. */
  storedAssigneeEmail?: string;
  /** The stored email of the person THIS patch picked (the resource named by
   *  `patch.resourceId`; the cell's picker is given no address book). A copy of
   *  it is never refused (spec Part 1, decision 2). Only the picked source is
   *  exempt — never every resource's email (pre-flight M10). */
  copySourceEmails?: readonly string[];
}

/** Why the patch's `assigneeEmail` is refused, or null. ★ Reachable only
 *  through a caller other than the picker: the cell sends the stored value or a
 *  picked resource's stored email, both exempt. Kept so the pane's toast and
 *  this sanitizer judge ONE value with ONE rule. */
export function inlineAssigneeEmailRefusal(patch: Partial<Task>, ctx: InlinePatchContext): EmailRefusal | null {
  if (!("assigneeEmail" in patch)) return null;
  return emailWriteRefusal(sanitizeEmail(patch.assigneeEmail), ctx.storedAssigneeEmail, ctx.copySourceEmails ?? []);
}
```

and in `sanitizeInlinePatch` replace the `assigneeEmail` line with

```ts
  if ("assigneeEmail" in patch && inlineAssigneeEmailRefusal(patch, ctx) === null) {
    clean.assigneeEmail = sanitizeEmail(patch.assigneeEmail); // a refused value keeps the stored one
  }
```

`src/app/tasks-section.tsx`: import `inlineAssigneeEmailRefusal` beside `sanitizeInlinePatch`; add `import { useToastContext } from "./toast-context";` and `import { EMAIL_REFUSAL_KEY } from "./email-refusal-i18n";`; add `const showToast = useToastContext();` beside the other hook calls near the top of the component body. In `onInlinePatch` replace the `sanitizeInlinePatch(patch, {…})` call with:

```ts
      const patchCtx = {
        hasResource: (id: number) => resourcesById.has(id),
        knownTaskIds,
        ownTaskId: taskId,
        storedAssigneeEmail: beforeRow.assigneeEmail,
        // Only the resource THIS patch picked (spec decision 2, pre-flight M10).
        copySourceEmails: typeof patch.resourceId === "number" ? [resourcesById.get(patch.resourceId)?.email ?? ""] : [],
      };
      const emailRefusal = inlineAssigneeEmailRefusal(patch, patchCtx);
      if (emailRefusal !== null) showToast("error", t(lang, EMAIL_REFUSAL_KEY[emailRefusal]));
      const clean = sanitizeInlinePatch(patch, patchCtx);
```

and add `showToast` and `lang` to that `useCallback`'s dependency array.

Rerun `task-inline-patch.test.ts` and `tasks-section.test.tsx`. Expected EXIT=0, `Test Files 2 passed (2)`.

- [ ] **Step 9: Typecheck, lint, size**

```bash
npx tsc --noEmit > "$LOG/tsc.log" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$LOG/tsc.log"
npx eslint --max-warnings=0 src/app/raid-escalation.ts src/app/escalate-popover.tsx src/app/use-action-center-handlers.ts src/app/record-email-guards.ts src/app/sanitize.ts src/app/absence-email.ts src/app/use-register-tools.ts src/app/use-chat-dispatcher.ts src/app/chat-task-patch.ts src/app/bulk-operations-helpers.ts src/app/use-bulk-operations.ts src/app/use-task-row-handlers.ts src/app/use-resource-planner.ts src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/entity-descriptor.ts src/app/task-inline-patch.ts src/app/tasks-section.tsx src/app/email-refusal-i18n.ts src/app/i18n.ts; echo "EXIT=$?"
npm run size:check > "$LOG/size.log" 2>&1; echo "EXIT=$?"
```
Then run every test file touched in Steps 2–8 in ONE vitest invocation and assert the file count equals the number passed.

- [ ] **Step 10: Commit**

Subject `feat: apply the email write rule at every non-editor write boundary`. Body: the dual-use split, the per-boundary stored value, the inline-cell reachability finding (spec correction 6), and one line per RECOMPUTE.

The paths, enumerated (pre-flight M12; every test path below exists at HEAD):

```bash
T2_PATHS="src/app/raid-escalation.ts src/app/escalate-popover.tsx src/app/use-action-center-handlers.ts src/app/record-email-guards.ts src/app/sanitize.ts src/app/absence-email.ts src/app/use-register-tools.ts src/app/use-chat-dispatcher.ts src/app/chat-task-patch.ts src/app/bulk-operations-helpers.ts src/app/use-bulk-operations.ts src/app/use-task-row-handlers.ts src/app/use-resource-planner.ts src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/entity-descriptor.ts src/app/task-inline-patch.ts src/app/tasks-section.tsx src/app/email-refusal-i18n.ts src/app/i18n.ts src/app/i18n.de.ts src/app/raid-escalation.test.ts src/app/escalate-popover.test.tsx src/app/use-action-center-handlers.test.ts src/app/chat-tools.test.ts src/app/chat-task-patch.test.ts src/app/bulk-operations-helpers.test.ts src/app/task-inline-patch.test.ts src/app/tasks-section.test.tsx src/app/use-chat-dispatcher.test.tsx src/app/inline-ai-edit/plan.sanitizer-parity.test.ts src/app/inline-ai-edit/plan.test.ts src/app/use-task-row-handlers.test.ts src/app/use-bulk-operations.test.tsx src/app/use-resource-planner.test.tsx"
git status --porcelain=v1 --untracked-files=all
```

Compare the status output with `$T2_PATHS`. A census RECOMPUTE file you actually edited is appended by name, and only from this list: `src/app/inline-ai-edit/descriptor-drift.test.ts`, `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`, `src/app/inline-ai-edit/plan.write-path-sweep.test.ts`, `src/app/inline-ai-edit/plan.model-writable-surface.test.ts`, `src/app/inline-ai-edit/plan.create-path-guards.test.ts`. Any other modified or untracked path is a STOP.

```bash
git add $T2_PATHS && git commit --only $T2_PATHS -F "$LOG/msg-t2.txt"; echo "EXIT=$?"
```

---

### Task 3: UI editors — task form, resource, stakeholder, RAID, shift, absence, contact persons

**Files:**
- Create: `src/app/email-field-error.tsx`
- Modify: `src/app/task-validation.ts`, `src/app/use-task-submit.ts` (`UseTaskSubmitArgs.resources`), `src/app/task-manager.tsx` (one line-neutral fold in the `useTaskSubmit({…})` call), `src/app/task-form-fields.tsx` (stored/copied-unsafe flag)
- Modify: `src/app/resource-edit-modal.tsx`, `src/app/stakeholder-edit-modal.tsx`, `src/app/raid-edit-modal.tsx`, `src/app/shift-edit-modal.tsx`, `src/app/absence-edit-modal.tsx`, `src/app/modal-edit-fields.tsx` (`AssigneeField` gains `emailInvalid` / `emailDescribedBy`), `src/app/project-form-fields.tsx` (`ContactPersonsControl`)
- Modify: `src/app/i18n.ts` (remove `resourceErrorEmailDelimiter`), `src/app/i18n.de.ts` (node script removal)
- Tests: `src/app/task-validation.test.ts`, `src/app/use-task-submit.test.ts`, `src/app/task-form-modal.test.tsx`, `src/app/resource-edit-modal.test.tsx`, `src/app/stakeholder-edit-modal.test.tsx`, `src/app/raid-edit-modal.test.tsx`, `src/app/shift-edit-modal.test.tsx`, `src/app/absence-edit-modal.test.tsx`, `src/app/project-form-fields.test.tsx`

**Interfaces:**
- Consumes: `emailWriteRefusal`, `EmailRefusal` (Task 1); `EMAIL_REFUSAL_KEY`, i18n `errorEmailDelimiter` (Task 2).
- Produces:
  - `EmailFieldError(props: { id: string; lang: Lang; value: string | undefined }): JSX.Element | null` — non-blocking flag for a present value that is not write-safe (judged with `emailWriteRefusal(value, undefined)`).
  - `validateTaskForm(form: TaskFormDraft, today: string, isNew: boolean, email?: { stored?: string; copySources?: readonly (string | undefined)[] }): TaskFieldErrors`; `TaskErrorKey` gains `"errorEmailDelimiter"`.
  - `UseTaskSubmitArgs.resources?: readonly Resource[]` (absent = no copy source).
  - `AssigneeField` props `emailInvalid?: boolean` and `emailDescribedBy?: string` (both optional; its only non-test mount is `absence-edit-modal.tsx`).

**The rule per editor (stored value and copy sources, verified at HEAD):**

| Editor | stored | copy sources | refusal surface |
|---|---|---|---|
| task form (`use-task-submit.ts`) | the edited task's `assigneeEmail` (`tasks.find(editingId)`) | the linked resource's email (`form.resourceId`, looked up in the new `args.resources`) | `FieldError id="assigneeEmail-error"` (existing, the refusal) + `EmailFieldError id="assigneeEmail-flag"` (the non-blocking flag for a stored or copied unsafe value) |
| `ResourceEditModal` | `resource?.email` | none (no picker) | `ModalFieldError` via `setError` |
| `StakeholderEditModal` | email the modal opened with (render-time reconcile on `draft.id`) | `resources.find(draft.resourceId)?.email` | `ModalFieldError` via `setError` |
| `RaidEditModal` | email the modal opened with (reconcile on `draft.id`) | `resources.find(draft.ownerResourceId)?.email` | `ModalFieldError` via `setError` |
| `ShiftEditModal` | `shift?.assigneeEmail` | `resources.find(draft.resourceId)?.email` | `ModalFieldError` via `setError` |
| `AbsenceEditModal` | `absence?.assigneeEmail` (existing `openedEmail`) | none new | `ModalFieldError` via `setError` + `EmailFieldError id="absence-email-error"` (the flag) |
| `ContactPersonsControl` add | undefined (an add is a create) | `resources.find(draft.resourceId)?.email`, `addressBook.find(c.name === draft.name)?.email` | `FieldError` under the email input |

Before editing each modal, confirm its `resources` prop name with `grep -n "resources" src/app/<file>.tsx`; if a modal has no resources in scope, pass `[]` as copy sources and record it in the commit body (the copy then shows the non-blocking flag and is refused only if the user saves it changed — that is a STOP-and-ask case, not a silent downgrade).

**Test census (run first; label every hit):**

```bash
git grep -n "resourceErrorEmailDelimiter\|validateTaskForm\|errorInvalidEmail\|TaskErrorKey" -- src e2e scripts
git grep -n "email" -- src/app/shift-edit-modal.test.tsx src/app/stakeholder-edit-modal.test.tsx src/app/raid-edit-modal.test.tsx src/app/project-form-fields.test.tsx src/app/task-form-feedback.test.tsx src/app/task-form-fields.test.tsx
```

- MIGRATE `resource-edit-modal.test.tsx`: both `t("en-US", "resourceErrorEmailDelimiter")` assertions → `t("en-US", "errorEmailDelimiter")`.
- DELETE the key `resourceErrorEmailDelimiter` from EN and DE (its only non-i18n consumer is the resource editor).
- MIGRATE `absence-edit-modal.test.tsx` "blocks save on an invalid assignee email": unchanged text; ADD a delimiter sibling.
- ADD `task-validation.test.ts`, and one editor case per row of the table above (refused when changed, accepted unchanged-but-unsafe, copy exempt where a picker exists).
- No RECOMPUTE in `task-form-feedback.test.tsx` / `task-form-fields.test.tsx`: neither enumerates `TaskErrorKey` (`grep -n "TaskErrorKey" src/app/task-form-feedback.test.tsx src/app/task-form-fields.test.tsx` prints nothing at HEAD).
- ADD `use-task-submit.test.ts`: the copy exemption comes from `args.resources`, with a positive control (pre-flight I1). Every existing `makeArgs()` call stays valid because `resources` is optional — no MIGRATE.
- ADD `task-form-modal.test.tsx` and `absence-edit-modal.test.tsx`: a stored unsafe email shows the non-blocking flag and does not block an unchanged save; a clean one shows no flag (pre-flight I7).
- Unaffected by the two optional `AssigneeField` props: its only non-test mount is `absence-edit-modal.tsx` (`git grep -n "<AssigneeField" -- src/app ':!*.test.*'`).
- The second grep lists existing email fixtures in editor tests; one holding an unsafe value that a test SAVES as a change is MIGRATE; a stored value saved unchanged needs no change.

- [ ] **Step 1: The flag component**

Create `src/app/email-field-error.tsx`:

```tsx
import { FieldError } from "./field-feedback";
import { type Lang, t } from "./i18n";
import { emailWriteRefusal } from "./sanitize-core";
import { EMAIL_REFUSAL_KEY } from "./email-refusal-i18n";

/** The non-blocking flag every email editor shows under its input while the
 *  value is not write-safe (spec Part 1, "Copied stored emails"): a stored or
 *  copied unsafe address is FLAGGED, never hidden and never blocking by itself.
 *  Saving it CHANGED is refused by the editor's own submit check. Pair the input
 *  with `aria-invalid` and `aria-describedby={id}` while `emailFieldInvalid`. */
export function EmailFieldError({ id, lang, value }: { id: string; lang: Lang; value: string | undefined }) {
  const refusal = emailWriteRefusal(value ?? "", undefined);
  return <FieldError id={id}>{refusal ? t(lang, EMAIL_REFUSAL_KEY[refusal]) : null}</FieldError>;
}

/** True while `EmailFieldError` is showing — drives `aria-invalid`. */
export function emailFieldInvalid(value: string | undefined): boolean {
  return emailWriteRefusal(value ?? "", undefined) !== null;
}
```

- [ ] **Step 2: Task form — failing test, then code**

Add to `src/app/task-validation.test.ts`. It uses the file's top-level `draft()` helper and `TODAY` constant; `base` is local to one `it` there and must not be used (pre-flight M2):

```ts
describe("assigneeEmail follows the changed-only write rule", () => {
  const unsafe = () => draft({ taskName: "X", assignee: "Y", dueDate: TODAY, assigneeEmail: "a,b@x.com" });
  it("refuses a changed delimiter-bearing address with the delimiter key", () => {
    expect(validateTaskForm(unsafe(), TODAY, false, { stored: "old@x.com" }).assigneeEmail).toBe("errorEmailDelimiter");
  });
  it("keeps an unchanged stored unsafe address valid", () => {
    expect(validateTaskForm(unsafe(), TODAY, false, { stored: "a,b@x.com" }).assigneeEmail).toBeUndefined();
  });
  it("exempts a copy of the linked resource's stored email", () => {
    expect(validateTaskForm(unsafe(), TODAY, false, { stored: "old@x.com", copySources: ["a,b@x.com"] }).assigneeEmail).toBeUndefined();
  });
});
```

Add to `src/app/use-task-submit.test.ts` (uses its `makeArgs` and `validForm`; `validForm()` is a create with `resourceId: undefined`):

```ts
describe("useTaskSubmit — the email copy source comes from args.resources (pre-flight I1)", () => {
  const linked = { id: 7, firstName: "Ada", lastName: "L", email: "a,b@x.com", roleId: null, utilizationMode: "percent" as const, utilization: {} };

  it("positive control: the same unsafe value with no resources is refused", () => {
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ form: { ...validForm(), resourceId: 7, assigneeEmail: "a,b@x.com" } })),
    );
    expect(result.current.fieldErrors.assigneeEmail).toBe("errorEmailDelimiter");
  });

  it("exempts a copy of the linked resource's stored email", () => {
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ form: { ...validForm(), resourceId: 7, assigneeEmail: "a,b@x.com" }, resources: [linked] })),
    );
    expect(result.current.fieldErrors.assigneeEmail).toBeUndefined();
  });
});
```

Add to `src/app/task-form-modal.test.tsx` (uses its `stubTaskForm`, `defaultProps`, `Providers`, `EN`; spec decision 2, pre-flight I7):

```tsx
describe("TaskFormModal — a stored or copied unsafe email is flagged, not blocked (pre-flight I7)", () => {
  it("shows the non-blocking flag for an unsafe value", () => {
    stubTaskForm({ assigneeEmail: "a,b@x.com" });
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    expect(screen.getByText(t(EN, "errorEmailDelimiter"))).toBeInTheDocument();
    expect(screen.getByDisplayValue("a,b@x.com")).toHaveAttribute("aria-invalid", "true");
  });

  it("positive control: no flag for a clean value", () => {
    stubTaskForm({ assigneeEmail: "nora@x.com" });
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    expect(screen.getByDisplayValue("nora@x.com")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(t(EN, "errorEmailDelimiter"))).toBeNull();
  });
});
```

(If `getByDisplayValue` finds no email input, the email field is hidden at this file's default tier. Raise the tier to Full inside each `it` exactly as the file's existing `fieldTierTrigger(EN)` test does, then assert. Do not weaken either assertion.)

Run it; Expected EXIT=1.

`src/app/task-validation.ts`: import `emailWriteRefusal` in place of `isValidEmail`, add `import { EMAIL_REFUSAL_KEY } from "./email-refusal-i18n";`, extend `TaskErrorKey` with `| "errorEmailDelimiter"`, and change the signature and email check:

```ts
export function validateTaskForm(
  form: TaskFormDraft,
  today: string,
  isNew: boolean,
  email: { stored?: string; copySources?: readonly (string | undefined)[] } = {},
): TaskFieldErrors {
```
```ts
  // A blank email is allowed; a CHANGED one must be write-safe (spec Part 1).
  const refusal = emailWriteRefusal(sanitizeEmail(form.assigneeEmail), email.stored, email.copySources ?? []);
  if (refusal) errors.assigneeEmail = EMAIL_REFUSAL_KEY[refusal];
```

`src/app/use-task-submit.ts` — pre-flight I1: NO `useWorkspace()` here. `use-task-submit.test.ts` renders this hook with no `WorkspaceProvider`, and `useWorkspace` throws outside one.
- Change `import { type Task, type RaidItem } from "./types";` to `import { type Task, type RaidItem, type Resource } from "./types";`.
- In `UseTaskSubmitArgs`, directly after `  tasks: readonly Task[];`, add:

```ts
  /** Live directory resources. The linked resource's stored email is a copy
   *  source the changed-only rule exempts (spec Part 1, decision 2). Optional:
   *  absent means no copy source. */
  resources?: readonly Resource[];
```

- In the hook's `const { … } = args;` destructure, directly after `    tasks,`, add `    resources = [],`.
- Directly after `  const isNewTask = editingId === null;`, add:

```ts
  const storedEmail = editingId !== null ? tasks.find((row) => row.id === editingId)?.assigneeEmail : undefined;
  const linkedEmail = form.resourceId != null ? resources.find((r) => r.id === form.resourceId)?.email : undefined;
  const emailContext = useMemo(() => ({ stored: storedEmail, copySources: [linkedEmail] }), [storedEmail, linkedEmail]);
```

- Pass `emailContext` as the fourth argument in both `validateTaskForm(form, today, isNewTask)` calls (the `fieldErrors` `useMemo` and the `hasTaskErrors(…)` guard in the submit callback), and add `emailContext` to both dependency arrays. `form.resourceId` is typed `number | null | undefined` (`task-form-context.tsx`), so `!= null` covers both.

`src/app/task-manager.tsx` — line-neutral, 3257 before and after. In the `useTaskSubmit({` call, replace the Edit-tool `old_string` `    setTaskModalOpen,\r\n    tasks,\r\n    today,` with `    setTaskModalOpen,\r\n    tasks, resources,\r\n    today,`. That three-line anchor occurs exactly once at HEAD; confirm it before editing:

```bash
node -e "const s=require('fs').readFileSync('src/app/task-manager.tsx','utf8');console.log(s.split('    setTaskModalOpen,\r\n    tasks,\r\n    today,\r\n').length-1)"
```
Expected `1`. `resources` is already in scope there: `TaskManager` destructures it from `useWorkspace()` and `handleCreateResource` reads it.

`src/app/task-form-fields.tsx` — the flag (spec decision 2, pre-flight I7). Add `import { EmailFieldError, emailFieldInvalid } from "./email-field-error";`. On the email `Input`:
- `invalid={errorFor("assigneeEmail") ? true : undefined}` → `invalid={errorFor("assigneeEmail") || emailFieldInvalid(form.assigneeEmail) ? true : undefined}`
- `aria-describedby={describedBy("assigneeEmail", "email-counter")}` → `aria-describedby={describedBy("assigneeEmail", !errorFor("assigneeEmail") && emailFieldInvalid(form.assigneeEmail) ? "email-counter assigneeEmail-flag" : "email-counter")}`

Directly after `<FieldError id="assigneeEmail-error">{errorFor("assigneeEmail")}</FieldError>`, add
`{!errorFor("assigneeEmail") && <EmailFieldError id="assigneeEmail-flag" lang={lang} value={form.assigneeEmail} />}`.
When the refusal is showing, it names the same reason, so the flag steps aside and never renders a second identical alert.

Run `task-validation.test.ts`, `use-task-submit.test.ts`, `task-form-modal.test.tsx`, `task-form-feedback.test.tsx`, `task-form-fields.test.tsx`, `task-manager.characterization.test.tsx`; Expected EXIT=0, `Test Files 6 passed (6)`.

- [ ] **Step 3: Resource editor — primary email, migrated key, flag**

Add to `src/app/resource-edit-modal.test.tsx` (uses its `setupFull`, `base`):

```ts
  it("refuses a CHANGED primary email that is not write-safe", () => {
    const onSave = vi.fn();
    setupFull({ resource: { ...base, email: "old@x.com" }, onSave });
    fireEvent.change(screen.getByDisplayValue("old@x.com"), { target: { value: "a;b@x.com" } });
    fireEvent.submit(screen.getByRole("button", { name: /save resource/i }).closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(t("en-US", "errorEmailDelimiter"));
  });

  it("saves an unrelated field while an unchanged stored primary email is unsafe, flagging it", () => {
    const onSave = vi.fn();
    setupFull({ resource: { ...base, email: "a,b@x.com" }, onSave });
    expect(screen.getByRole("alert")).toHaveTextContent(t("en-US", "errorEmailDelimiter"));
    fireEvent.change(screen.getByDisplayValue("Sample"), { target: { value: "Ada" } });
    fireEvent.submit(screen.getByRole("button", { name: /save resource/i }).closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
```

Migrate the two existing `resourceErrorEmailDelimiter` assertions to `errorEmailDelimiter`. Run; Expected EXIT=1.

`src/app/resource-edit-modal.tsx`: import `EMAIL_REFUSAL_KEY` and `EmailFieldError, emailFieldInvalid` (`./email-field-error`). In `handleSubmit`, directly after `const email = …`:

```ts
    const emailRefusal = emailWriteRefusal(email ?? "", resource?.email);
    if (emailRefusal) {
      setError(t(lang, EMAIL_REFUSAL_KEY[emailRefusal]));
      return;
    }
```

and change the Task 1 `emails` branch to `setError(t(lang, EMAIL_REFUSAL_KEY[emailWriteRefusal(tornEmail, undefined) ?? "delimiter"]));`. On the primary email `<input type="email">` add `aria-invalid={emailFieldInvalid(draft.email) || undefined}` and change `aria-describedby="resource-email-counter"` to `aria-describedby="resource-email-counter resource-email-error"`; directly after its `CharCounter` add `<EmailFieldError id="resource-email-error" lang={lang} value={draft.email} />`.

`src/app/i18n.ts`: delete the line `  resourceErrorEmailDelimiter: "An additional email address cannot contain a comma or a semicolon.",`.
`src/app/i18n.de.ts`: write `$LOG/de-t3.cjs`:

```js
const fs = require("fs");
const P = "src/app/i18n.de.ts";
const s = fs.readFileSync(P, "utf8");
const line = "  resourceErrorEmailDelimiter: \"Eine zus\u00e4tzliche E-Mail-Adresse darf weder ein Komma noch ein Semikolon enthalten.\",\r\n";
const count = s.split(line).length - 1;
if (count !== 1) { console.error("anchor count " + count); process.exit(1); }
fs.writeFileSync(P, s.replace(line, ""), "utf8");
console.log("ok");
```

Run `node "$LOG/de-t3.cjs"; echo "EXIT=$?"`. Then write `$LOG/de-check-t3.cjs` with the Write tool and run `node "$LOG/de-check-t3.cjs"; echo "EXIT=$?"` — Expected `ok`, `EXIT=0`:

```js
const fs = require("fs");
const s = fs.readFileSync("src/app/i18n.de.ts", "utf8");
const problems = [];
const bareLf = (s.match(/(?<!\r)\n/g) || []).length;
if (bareLf !== 0) problems.push("bareLF " + bareLf);
if (s.includes("\ufffd")) problems.push("U+FFFD replacement character present");
if (s.includes("resourceErrorEmailDelimiter")) problems.push("resourceErrorEmailDelimiter still present");
// Task 2's added line must survive this removal byte-for-byte.
const t2 = "  errorEmailDelimiter: \"Eine E-Mail-Adresse darf weder ein Komma noch ein Semikolon enthalten.\",\r\n";
if (s.split(t2).length - 1 !== 1) problems.push("errorEmailDelimiter line not found exactly once");
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("ok");
```

Rerun the resource editor tests; Expected EXIT=0.

- [ ] **Step 4: Stakeholder, RAID, shift editors — failing tests**

`src/app/stakeholder-edit-modal.test.tsx` (uses its `setupFull`; add `t` import if missing):

```ts
describe("stakeholder email follows the changed-only write rule", () => {
  it("refuses a CHANGED malformed email on save", () => {
    const onSave = vi.fn();
    setupFull({ onSave, draft: { id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "old@x.com" } });
    fireEvent.change(screen.getByDisplayValue("old@x.com"), { target: { value: "nope" } });
    fireEvent.submit(screen.getByDisplayValue("Sam").closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(t("en-US", "errorInvalidEmail"));
  });

  it("saves while an unchanged stored email is unsafe", () => {
    const onSave = vi.fn();
    setupFull({ onSave, draft: { id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "a,b@x.com" } });
    fireEvent.submit(screen.getByDisplayValue("Sam").closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
```

★ `StakeholderEditModal` is controlled: the parent owns `draft`. `setupFull` must re-render with each `onChange` for the typed value to reach the modal. Read `setupFull`; if it passes a static `draft`, wrap the render in a local stateful host (`function Host() { const [d, setD] = useState(draft); return <StakeholderEditModal {...props} draft={d} onChange={setD} />; }`) inside this describe.

`src/app/raid-edit-modal.test.tsx` (uses `makeDraft`, `modalEl`, `wrapper`; the same controlled-host note applies):

```ts
describe("RAID owner email follows the changed-only write rule", () => {
  it("refuses a CHANGED delimiter-bearing owner email on save", () => {
    const onSave = vi.fn();
    render(modalEl({ ownerEmail: "old@x.com" }, onSave), { wrapper });
    fireEvent.change(screen.getByDisplayValue("old@x.com"), { target: { value: "a,b@x.com" } });
    fireEvent.submit(screen.getByDisplayValue("a,b@x.com").closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(t("en-US", "errorEmailDelimiter"));
  });

  it("saves while an unchanged stored owner email is unsafe", () => {
    const onSave = vi.fn();
    render(modalEl({ ownerEmail: "a,b@x.com" }, onSave), { wrapper });
    fireEvent.submit(screen.getByDisplayValue("a,b@x.com").closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
```

(The owner email input is inside the `isVisible("owner")` block; if the default tier hides it, render inside the file's full-tier `Seed`/`selectFieldTier` pattern the other full-tier tests use.)

`src/app/shift-edit-modal.test.tsx` (uses `setup`):

```ts
describe("shift assignee email follows the changed-only write rule", () => {
  it("refuses a CHANGED malformed email", () => {
    const onSave = vi.fn();
    setup({ onSave, isNew: false, shift: { id: 1, assignee: "Ada", assigneeEmail: "old@x.com", hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] } as Shift });
    fireEvent.change(screen.getByLabelText(t("en-US", "shiftAssigneeEmail")), { target: { value: "nope" } });
    fireEvent.submit(screen.getByDisplayValue("nope").closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(t("en-US", "errorInvalidEmail"));
  });

  it("saves while an unchanged stored email is unsafe", () => {
    const onSave = vi.fn();
    setup({ onSave, isNew: false, shift: { id: 1, assignee: "Ada", assigneeEmail: "a,b@x.com", hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] } as Shift });
    fireEvent.submit(screen.getByDisplayValue("a,b@x.com").closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
```

`src/app/absence-edit-modal.test.tsx`, after the invalid-email case:

```ts
  it("blocks save on a changed delimiter-bearing assignee email with the delimiter message", () => {
    const onSave = vi.fn();
    setupFull({ onSave });
    fireEvent.change(screen.getByLabelText(t("en-US", "absenceAssigneeEmail")), { target: { value: "a,b@x.com" } });
    fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(t("en-US", "errorEmailDelimiter"));
  });

  it("flags a stored unsafe assignee email without blocking an unchanged save (pre-flight I7)", () => {
    const onSave = vi.fn();
    setupFull({ onSave, absence: { ...base, assigneeEmail: "a,b@x.com" } });
    expect(screen.getByRole("alert")).toHaveTextContent(t("en-US", "errorEmailDelimiter"));
    expect(screen.getByLabelText(t("en-US", "absenceAssigneeEmail"))).toHaveAttribute("aria-invalid", "true");
    fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("positive control: a clean stored assignee email shows no flag", () => {
    setupFull();
    expect(screen.getByLabelText(t("en-US", "absenceAssigneeEmail"))).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(t("en-US", "errorEmailDelimiter"))).toBeNull();
  });
```

Run the four files; Expected EXIT=1 (the absence flag case fails too until Step 5 adds the flag).

- [ ] **Step 5: Stakeholder, RAID, shift, absence editors — code**

Imports (pre-flight I7 — every name imported below is used below, so lint stays clean):
- `stakeholder-edit-modal.tsx`, `raid-edit-modal.tsx`, `shift-edit-modal.tsx`: import `emailWriteRefusal` from `./sanitize`, `EMAIL_REFUSAL_KEY` from `./email-refusal-i18n`, and `EmailFieldError, emailFieldInvalid` from `./email-field-error`.
- `absence-edit-modal.tsx`: its existing `./sanitize-core` import changes as shown below (`emailWriteRefusal` replaces `isValidEmail`); add `EMAIL_REFUSAL_KEY` from `./email-refusal-i18n` and `EmailFieldError, emailFieldInvalid` from `./email-field-error` (both used by the flag below). It does NOT import from `./sanitize`.

`src/app/stakeholder-edit-modal.tsx` — near the other state, the render-time reconcile (AGENTS.md: never an effect):

```tsx
  // The email the modal OPENED with — the stored value the changed-only rule
  // judges against. Controlled modal (the parent owns `draft`), so it is
  // captured per record by render-time reconcile on `draft.id`.
  const [opened, setOpened] = useState({ id: draft.id, email: draft.email });
  if (opened.id !== draft.id) setOpened({ id: draft.id, email: draft.email });
```

In `handleSubmit`, after the name check and before `setError(null)`:

```tsx
    const linked = draft.resourceId != null ? resources.find((r) => r.id === draft.resourceId)?.email : undefined;
    const emailRefusal = emailWriteRefusal(draft.email ?? "", opened.email, [linked]);
    if (emailRefusal) {
      setError(t(lang, EMAIL_REFUSAL_KEY[emailRefusal]));
      return;
    }
```

On the email `Input`: `aria-invalid={emailFieldInvalid(draft.email) || undefined}`, `aria-describedby="stakeholder-email-counter stakeholder-email-error"`; after its `CharCounter`: `<EmailFieldError id="stakeholder-email-error" lang={lang} value={draft.email} />`.

`src/app/raid-edit-modal.tsx` — same reconcile (`useState({ id: draft.id, email: draft.ownerEmail })`), and in `handleSubmit` after the title check:

```tsx
    const linkedOwner = draft.ownerResourceId != null ? resources.find((r) => r.id === draft.ownerResourceId)?.email : undefined;
    const ownerEmailRefusal = emailWriteRefusal(draft.ownerEmail ?? "", opened.email, [linkedOwner]);
    if (ownerEmailRefusal) {
      setError(t(lang, EMAIL_REFUSAL_KEY[ownerEmailRefusal]));
      return;
    }
```

The owner-email `Input` gains `aria-invalid={emailFieldInvalid(draft.ownerEmail) || undefined}` and `aria-describedby="raid-owner-email-error"`; directly after the `Input`, inside the `HintedLabel` body, add `<EmailFieldError id="raid-owner-email-error" lang={lang} value={draft.ownerEmail} />`. ★ If placing it inside the `HintedLabel` makes the error text join the input's accessible name (`expectExactLabelNames` in this file's tests goes red), move it directly after the closing `</HintedLabel>` instead.

`src/app/shift-edit-modal.tsx` — in `handleSubmit` after the hour-range loop:

```tsx
    const linked = draft.resourceId != null ? resources.find((r) => r.id === draft.resourceId)?.email : undefined;
    const emailRefusal = emailWriteRefusal(draft.assigneeEmail ?? "", shift?.assigneeEmail, [linked]);
    if (emailRefusal) {
      setError(t(lang, EMAIL_REFUSAL_KEY[emailRefusal]));
      return;
    }
```

The email `Input` gains `aria-invalid` / `aria-describedby="shift-email-error"`; after the enclosing `</label>` add `<EmailFieldError id="shift-email-error" lang={lang} value={draft.assigneeEmail} />`.

`src/app/absence-edit-modal.tsx` — replace

```tsx
    if (cleanedEmail && cleanedEmail !== openedEmail && !isValidEmail(sanitizeEmail(cleanedEmail))) {
      setError(t(lang, "errorInvalidEmail"));
      return;
    }
```
with
```tsx
    const emailRefusal = emailWriteRefusal(sanitizeEmail(cleanedEmail ?? ""), openedEmail);
    if (emailRefusal) {
      setError(t(lang, EMAIL_REFUSAL_KEY[emailRefusal]));
      return;
    }
```
and change its import to `import { emailWriteRefusal, sanitizeEmail } from "./sanitize-core";`. Update the comment above: the rule is now the shared `emailWriteRefusal` (format + delimiter, changed-only).

The absence flag (spec decision 2, pre-flight I7). The email input lives inside the shared `AssigneeField` (`modal-edit-fields.tsx`), so that component gains two optional props:
- in its props type, directly after `  tooltip?: string;`, add

```ts
  /** Marks the email input invalid: a stored or copied unsafe value the caller flags. */
  emailInvalid?: boolean;
  /** Id of the caller's flag element, for the email input's aria-describedby. */
  emailDescribedBy?: string;
```

- add `  emailInvalid,` and `  emailDescribedBy,` to the destructure directly after `  tooltip,`;
- on the email `<Input type="email" …>` add `invalid={emailInvalid || undefined}` and `aria-describedby={emailDescribedBy}` (`Input` in `form-controls.tsx` sets `aria-invalid` from `invalid`).

`src/app/absence-edit-modal.tsx`: on the `<AssigneeField` mount add `emailInvalid={emailFieldInvalid(draft.assigneeEmail)}` and `emailDescribedBy={emailFieldInvalid(draft.assigneeEmail) ? "absence-email-error" : undefined}`, and directly after that mount's closing `/>` add:

```tsx
          {!error && isVisible("email") && emailFieldInvalid(draft.assigneeEmail) && (
            <div className="sm:col-span-2">
              <EmailFieldError id="absence-email-error" lang={lang} value={draft.assigneeEmail} />
            </div>
          )}
```

(The form is a two-column grid. The wrapper spans both columns like `AssigneeField`'s own labels, and it renders only while flagging, so a clean value adds no empty grid row.)

★ IMPLEMENTATION CORRECTION (Task 3, verified against a real run): the snippet
above originally omitted `!error &&`. Without it, a refused submit (the
existing "blocks save on an invalid assignee email" test) leaves
`draft.assigneeEmail` at its invalid value, so BOTH the `ModalFieldError`
banner and this flag render simultaneously, carrying the identical message —
two `role="alert"` elements where the pre-existing test expects exactly one
(`screen.getByRole("alert")`). Measured: `screen.getByRole("alert")` throws
"Found multiple elements with the role alert" without the guard. The same
duplicate-alert risk applies to every other editor's flag (resource,
stakeholder, RAID owner, shift assignee) whenever that editor's single
`error` banner and the field flag can show the same reason at once; Task 3
added the identical `!error &&` guard to all of them for consistency, even
though their existing tests use `getAllByRole("alert")` (plural) and would
not have caught the duplication on their own.

Rerun the four editor test files; Expected EXIT=0, `Test Files 4 passed (4)`.

- [ ] **Step 6: Contact persons — failing test, then code**

Add to `src/app/project-form-fields.test.tsx`:

```tsx
describe("contact person add follows the email write rule", () => {
  it("refuses an add with a typed unsafe email, keeps the draft and shows the error", async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    render(<IdentityPeopleFields {...props} setDraft={setDraft} />);
    await user.type(screen.getByRole("combobox", { name: t("en-US", "contactAddManual") }), "Bob Jones");
    const email = screen.getByRole("textbox", { name: `${t("en-US", "contactAddManual")} — ${t("en-US", "email")}` });
    await user.type(email, "a,b@x.com");
    await user.click(screen.getByRole("button", { name: t("en-US", "add") }));
    expect(setDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(t("en-US", "errorEmailDelimiter"));
    expect(email).toHaveValue("a,b@x.com");
  });

  it("adds with a copied unsafe email picked from the address book", async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    render(<IdentityPeopleFields {...props} setDraft={setDraft} addressBook={[{ name: "Bob Jones", email: "a,b@x.com" }] as never} />);
    await user.type(screen.getByRole("combobox", { name: t("en-US", "contactAddManual") }), "Bob");
    await user.click(await screen.findByText("Bob Jones"));
    await user.click(screen.getByRole("button", { name: t("en-US", "add") }));
    expect(setDraft).toHaveBeenCalledTimes(1);
  });
});
```

(If the picker's role is not `combobox`, read `resource-picker.tsx`'s input and use its role; the name is its `aria-label`.)

Run it; Expected EXIT=1.

`src/app/project-form-fields.tsx` — import `emailWriteRefusal` (from `./sanitize`), `EMAIL_REFUSAL_KEY`, and use the existing `FieldError` import. In `ContactPersonsControl` add `const [emailError, setEmailError] = useState<string | null>(null);` and replace `addDraft`'s opening:

```tsx
  const addDraft = () => {
    const name = draft.name.trim();
    if (!name || hasName(name)) return;
    // A TYPED unsafe email refuses the add; a copy of the picked person's
    // stored email is exempt (spec Part 1, decision 1 + Part 7 ruling).
    const copySources = [
      draft.resourceId != null ? resources.find((r) => r.id === draft.resourceId)?.email : undefined,
      addressBook.find((c) => c.name === name)?.email,
    ];
    const refusal = emailWriteRefusal(draft.email, undefined, copySources);
    if (refusal) {
      setEmailError(t(lang, EMAIL_REFUSAL_KEY[refusal]));
      return;
    }
    setEmailError(null);
```

(the rest of `addDraft` unchanged). The email `<input>` gains `aria-invalid={emailError ? true : undefined}` and `aria-describedby={emailError ? "contact-email-error" : undefined}`, and its `onChange` also calls `setEmailError(null)`. Directly after that `<input>` (inside the same `div`) add `<FieldError id="contact-email-error">{emailError}</FieldError>`.

Rerun; Expected EXIT=0.

- [ ] **Step 7: Gates**

Run all Task 3 test files in one invocation (assert the file count), then `npx tsc --noEmit` (0 `error TS`), `npx eslint --max-warnings=0` over every touched file, `npm run size:check`.

- [ ] **Step 8: Commit**

Subject `feat: email write rule and field errors in every workspace editor`.

The paths, enumerated (pre-flight M12):

```bash
T3_PATHS="src/app/email-field-error.tsx src/app/task-validation.ts src/app/use-task-submit.ts src/app/task-manager.tsx src/app/task-form-fields.tsx src/app/resource-edit-modal.tsx src/app/stakeholder-edit-modal.tsx src/app/raid-edit-modal.tsx src/app/shift-edit-modal.tsx src/app/absence-edit-modal.tsx src/app/modal-edit-fields.tsx src/app/project-form-fields.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/task-validation.test.ts src/app/use-task-submit.test.ts src/app/task-form-modal.test.tsx src/app/resource-edit-modal.test.tsx src/app/stakeholder-edit-modal.test.tsx src/app/raid-edit-modal.test.tsx src/app/shift-edit-modal.test.tsx src/app/absence-edit-modal.test.tsx src/app/project-form-fields.test.tsx"
git status --porcelain=v1 --untracked-files=all
```

Every modified or untracked path in the status output must be in `$T3_PATHS`; any other is a STOP.

```bash
git add $T3_PATHS && git commit --only $T3_PATHS -F "$LOG/msg-t3.txt"; echo "EXIT=$?"
```

---

### Task 4: Jira and Timelog settings email — local draft, persist only valid

**Files:**
- Modify: `src/app/jira-settings.tsx`, `src/app/timelog-settings.tsx`
- Test: `src/app/jira-settings.test.tsx`, `src/app/timelog-settings.test.tsx`

**Interfaces:**
- Consumes: `emailWriteRefusal` (Task 1), `EMAIL_REFUSAL_KEY` (Task 2), `FieldError`.
- Produces: none exported.

**Test census:**

```bash
git grep -n "jiraEmail\|timelogEmail\|config.email\|email:" -- src/app/jira-settings.test.tsx src/app/timelog-settings.test.tsx src/app/settings-view.test.tsx src/app/use-jira-sync.test.tsx
```

- ADD one describe per settings file (below).
- Must stay green: every existing Jira/Timelog settings test; `expectExactLabelNames` / `expectNoHintInNamingLabel` in `jira-settings.test.tsx` pin that the `FieldError` does not join the email input's name.
- A hit that types a malformed email and expects `onChange` to receive it is MIGRATE (typing is not blocked, but persistence is).

- [ ] **Step 1: Failing tests**

`src/app/jira-settings.test.tsx`:

```tsx
describe("JiraSettingsSection — email draft persists only a valid value", () => {
  function openWithEmail(email: string, onChange = vi.fn()) {
    render(<JiraSettingsSection lang="en-US" config={{ ...defaultJiraConfig, email }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /jira integration/i }));
    return { onChange, input: screen.getByRole("textbox", { name: t("en-US", "jiraEmail") }) };
  }

  it("keeps typing, shows FieldError, and does not persist a changed unsafe email", () => {
    const { onChange, input } = openWithEmail("ada@x.com");
    fireEvent.change(input, { target: { value: "a,b@x.com" } });
    expect(input).toHaveValue("a,b@x.com");
    expect(screen.getByRole("alert")).toHaveTextContent(t("en-US", "errorEmailDelimiter"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("persists a valid value and a clear", () => {
    const { onChange, input } = openWithEmail("ada@x.com");
    fireEvent.change(input, { target: { value: "grace@x.com" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ email: "grace@x.com" }));
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ email: "" }));
  });
});
```

(The email input sits under the `jiraEmail` caption; if the section needs `enabled: true` to render it, add `enabled: true` to the config spread — read the component's render condition.)

`src/app/timelog-settings.test.tsx`:

```tsx
describe("TimelogSettings — email draft persists only a valid value", () => {
  it("keeps typing, shows FieldError, and leaves the stored config at the last valid value", () => {
    const onChange = vi.fn();
    render(<TimelogSettings lang="en-US" config={{ ...defaultTimelogConfig, enabled: true, email: "ada@x.com" }} onChange={onChange} />);
    const input = screen.getByLabelText(t("en-US", "timelogEmail"));
    fireEvent.change(input, { target: { value: "nope" } });
    expect(input).toHaveValue("nope");
    expect(screen.getByRole("alert")).toHaveTextContent(t("en-US", "errorInvalidEmail"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "grace@x.com" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ email: "grace@x.com" }));
  });

  it("persists a clear (pre-flight M9)", () => {
    const onChange = vi.fn();
    render(<TimelogSettings lang="en-US" config={{ ...defaultTimelogConfig, enabled: true, email: "ada@x.com" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(t("en-US", "timelogEmail")), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ email: "" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
```

Run both; Expected EXIT=1.

- [ ] **Step 2: Jira code**

`src/app/jira-settings.tsx`: change `import { FieldNotice } from "./field-feedback";` to `import { FieldError, FieldNotice } from "./field-feedback";`; import `emailWriteRefusal` (`./sanitize`) and `EMAIL_REFUSAL_KEY`. Near the other state:

```tsx
  // ★ A LOCAL DRAFT, persisted only once write-safe (spec Part 1, decision 1):
  //  typing is never blocked, and the stored config keeps the last valid value.
  //  Render-time reconcile adopts an external change (never an effect).
  const emailErrorId = useId();
  const [emailDraft, setEmailDraft] = useState(config.email);
  const [seenEmail, setSeenEmail] = useState(config.email);
  if (config.email !== seenEmail) {
    setSeenEmail(config.email);
    setEmailDraft(config.email);
  }
  const emailRefusal = emailWriteRefusal(emailDraft, config.email);
```

Replace the email `<input>`:

```tsx
              <input
                type="email"
                value={emailDraft}
                onChange={(e) => {
                  const next = e.target.value;
                  setEmailDraft(next);
                  if (emailWriteRefusal(next, config.email) === null) update("email", next.trim());
                }}
                aria-invalid={emailRefusal ? true : undefined}
                aria-describedby={emailRefusal ? emailErrorId : undefined}
                className={inputClass}
              />
            </HintedLabel>
            <FieldError id={emailErrorId}>{emailRefusal ? t(lang, EMAIL_REFUSAL_KEY[emailRefusal]) : null}</FieldError>
```

(i.e. the `FieldError` goes directly after the closing `</HintedLabel>` of the email field, outside the label.) ★ `update("email", next.trim())` sets `config.email` to the trimmed value; the reconcile then adopts it into the draft, which is the same trimmed text the input showed before this change.

- [ ] **Step 3: Timelog code**

`src/app/timelog-settings.tsx`: `import { useId, useState } from "react";`, `import { FieldError, FieldNotice } from "./field-feedback";`, plus `emailWriteRefusal` and `EMAIL_REFUSAL_KEY`. In `TimelogSettings` add the same draft/reconcile block (with `const emailErrorId = useId();`), and replace the email label:

```tsx
          <label className="block text-xs">
            {t(lang, "timelogEmail")}
            <Input
              size="xs"
              className="mt-1 w-full"
              type="email"
              value={emailDraft}
              onChange={(e) => {
                const next = e.target.value;
                setEmailDraft(next);
                if (emailWriteRefusal(next, config.email) === null) set({ email: next });
              }}
              aria-invalid={emailRefusal ? true : undefined}
              aria-describedby={emailRefusal ? emailErrorId : undefined}
            />
          </label>
          <FieldError id={emailErrorId}>{emailRefusal ? t(lang, EMAIL_REFUSAL_KEY[emailRefusal]) : null}</FieldError>
```

(Timelog persists `next` untrimmed, exactly as today.)

- [ ] **Step 4: Run, gates, commit**

Run both settings test files plus `settings-view.test.tsx` in one invocation (`Test Files 3 passed (3)`), then tsc, eslint over the four files, size:check.

Subject `feat: settings email inputs persist only a write-safe value`.

```bash
git add src/app/jira-settings.tsx src/app/timelog-settings.tsx src/app/jira-settings.test.tsx src/app/timelog-settings.test.tsx
git commit --only src/app/jira-settings.tsx src/app/timelog-settings.tsx src/app/jira-settings.test.tsx src/app/timelog-settings.test.tsx -F "$LOG/msg-t4.txt"; echo "EXIT=$?"
```

---

### Task 5: Imports — load normaliser, explicit-import notice, sync drop + diagnostic

**Files:**
- Modify: `src/app/sanitize-core.ts` (`normalizeEmailShape`, `normalizeEmailListShape`, `withNormalizedEmailField`, `withNormalizedResourceEmails`)
- Modify (load funnels): `src/app/task-status.ts` (`migrateTask`), `src/app/sanitize-entities.ts` (`sanitizeAbsence`, `sanitizeShift`, `sanitizeResource`), `src/app/sanitize-records.ts` (`sanitizeStakeholder`, `sanitizeContactPerson` — line-neutral), `src/app/workspace.ts` (`jsonToWorkspace` raid map), `src/app/csv-codecs-core.ts` (`buildRaidItemFromObj`), `src/app/templates.ts` (`sanitizeSeedRaidItem`), `src/app/browser-backend.ts` (IndexedDB map), `src/app/raid-escalation.ts` (`sanitizeEntry`)
- Modify (notice): `src/app/record-email-guards.ts` (`summarizeUnsafeEmailRecords`), `src/app/use-storage-file-ops.ts` (`switchToProject`, `createProject`, `loadProjectFromFile`, `onOpenStorageFile`), `src/app/use-storage-turso-ops.ts` (`createTursoProject`), `src/app/task-manager.tsx` (`handleApplyTemplate`, line-neutral), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Modify (sync): `src/app/jira-api.ts` (`issueToTaskFields`), `src/app/outlook-contacts.ts` (`mapGraphContact`)
- Tests: `src/app/sanitize-core.email-rule.test.ts`, `src/app/raid-escalation.test.ts`, `src/app/email-normalize.load.test.ts` (new), `src/app/browser-backend.test.ts` (IndexedDB load case), `src/app/jira-api.test.ts`, `src/app/outlook-contacts.test.ts`, `src/app/use-storage-backend.test.tsx`, `src/app/use-storage-turso-ops.test.ts`, `src/app/task-manager.template-notice.test.tsx` (new)

**Interfaces:**
- Consumes: `isWriteSafeEmail` (Task 1).
- Produces:
  - `normalizeEmailShape(value: string): string`
  - `normalizeEmailListShape(list: readonly string[]): string[]`
  - `withNormalizedEmailField<T extends object>(row: T, field: keyof T & string): T` (same reference when unchanged)
  - `withNormalizedResourceEmails<T extends { email?: string; emails?: string[] }>(row: T): T` (same reference when unchanged)
  - `summarizeUnsafeEmailRecords(ws: UnsafeEmailScope): { count: number; names: string } | null`, with `type UnsafeEmailScope = { tasks?: readonly Task[]; raid?: readonly RaidItem[]; absences?: readonly Absence[]; shifts?: readonly Shift[]; resources?: readonly Resource[]; stakeholders?: readonly Stakeholder[]; project?: ProjectMeta }`
  - `templateSeedEmailScope(before: Pick<Workspace, "tasks" | "raid" | "stakeholders">, after: Pick<Workspace, "tasks" | "raid" | "stakeholders">): UnsafeEmailScope` — only the rows `appendSeed` added (pre-flight I4)
  - i18n key `importUnsafeEmailsNotice` (`{0}` = count, `{1}` = names)

**Six load paths per field (the normaliser's call site; verified at HEAD):**

| Field | JSON | CSV | Markdown | Turso single + tenant | IndexedDB | templates |
|---|---|---|---|---|---|---|
| `Task.assigneeEmail` | `migrateTask` (via `jsonToWorkspace`) | `migrateTask` (via `buildTaskFromObj`) | `migrateTask` (Markdown task decode) | `migrateTask` (`ENTITY_SPECS` → `buildTaskFromObj`) | `migrateTask` (`browser-backend.ts`) | `migrateTask` (`sanitizeSeedTask`) |
| `Absence.assigneeEmail` / `Shift.assigneeEmail` | `sanitizeAbsence` / `sanitizeShift` | same | same (`decodeMdTable`) | same (`ENTITY_SPECS` `fromObj`) | explicit map | — |
| `Resource.email` / `emails` | `sanitizeResource` | same | same | same | explicit map | — |
| `Stakeholder.email` | `sanitizeStakeholder` | `buildStakeholderFromObj` → `sanitizeStakeholder` | same | same | explicit map | — |
| `RaidItem.ownerEmail` | `jsonToWorkspace` raid map | `buildRaidItemFromObj` | same | same | explicit map | `sanitizeSeedRaidItem` |
| `ContactPerson.email` | `sanitizeContactPerson` (via `sanitizeProjectMeta`) | `buildProjectFromObj` → `sanitizeProjectMeta` | same | same (tenant `rowsToProjectList`) | `sanitizeProjectMeta` | — |
| `RaidEscalation.toEmail` | `sanitizeEntry` (every read of `escalations`) | same | same | same | same | — |

Turso single-DB project meta: `docs/open-followups.md` §538 records that it is never persisted; nothing to normalise there. Jira and Timelog settings emails get no clean-up (Ruling Q7).

**Test census (run first; label every hit):**

```bash
git grep -n "migrateTask\|sanitizeContactPerson\|mapGraphContact\|issueToTaskFields\|sanitizeEntry\|sanitizeRaidEscalations" -- "src/**/*.test.*" "src/test/**" e2e scripts
git grep -nE "<[^>]*@[^>]*>" -- "src/**/*.test.*" "src/app/__fixtures__" | grep -v "<br"
git grep -n "assigneeEmail\|emailAddress" -- src/app/jira-api.test.ts src/app/use-jira-sync.test.tsx src/app/outlook-contacts.test.ts
```

- ADD normaliser unit tests (sanitize-core file), escalation load tests, `email-normalize.load.test.ts` (one round trip per codec), Jira + Outlook drop-plus-diagnostic, one notice test per explicit action (`onOpenStorageFile`, `switchToProject`, `loadProjectFromFile`; file-mode `createProject` with a template AND with an AI-import seed; `createTursoProject` with a template AND with an AI-import seed; template apply through `handleApplyTemplate`), the notice-before-diagnostic ordering tests for `onOpenStorageFile` and `loadProjectFromFile` (pre-flight I5, I9), `templateSeedEmailScope` over a real `applyTemplate` call (pre-flight I4), and a no-notice reload test.
- RECOMPUTE `codec-roundtrip.property.test.ts`: check its email generators (`assigneeEmail: str` etc.). If `str` can generate a string of the form `Name <x@y.z>` whose inner part is write-safe, the round trip now normalises it on load. Narrow the generator to exclude `<`/`>` in email fields, with a comment naming this task.
- `task-status.test.ts` / `task-status.property.test.ts`: `migrateTask` still returns the SAME reference for a row needing no change; any test asserting `toBe(task)` stays green. RECOMPUTE only if a fixture's `assigneeEmail` has the `Name <addr>` shape.
- `use-jira-sync.test.tsx`: MIGRATE only a case whose `emailAddress` is not write-safe (it now arrives as `""`).
- `golden-workspace.test.ts`: must stay green with no regeneration (no fixture email has the shape — verify with the second grep printing no fixture hit).
- `outlook-contacts.test.ts` existing `mapGraphContact` cases use plain addresses: unchanged.

- [ ] **Step 1: Normaliser — failing tests, then code**

Append to `src/app/sanitize-core.email-rule.test.ts` (import the new names from `./sanitize`):

```ts
describe("normalizeEmailShape — load clean-up, provably equivalent only", () => {
  it("unwraps Name <addr> when the inner address is write-safe", () => {
    expect(normalizeEmailShape("Ada Lovelace <ada@x.com>")).toBe("ada@x.com");
    expect(normalizeEmailShape("  <ada@x.com>  ")).toBe("ada@x.com");
  });
  it("returns everything else unchanged", () => {
    expect(normalizeEmailShape("ada@x.com")).toBe("ada@x.com");
    expect(normalizeEmailShape("Name <a,b@x.com>")).toBe("Name <a,b@x.com>");
    expect(normalizeEmailShape("Name <nope>")).toBe("Name <nope>");
    expect(normalizeEmailShape("not-an-email")).toBe("not-an-email");
    expect(normalizeEmailShape("")).toBe("");
  });
});

describe("normalizeEmailListShape", () => {
  it("splits a member holding several write-safe addresses and unwraps names", () => {
    expect(normalizeEmailListShape(["a@x.com, b@y.com", "Ann <c@z.com>"])).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });
  it("keeps a member whose parts are not all write-safe", () => {
    expect(normalizeEmailListShape(["a,b@x.com"])).toEqual(["a,b@x.com"]);
  });
});

describe("withNormalizedEmailField / withNormalizedResourceEmails", () => {
  it("return the SAME reference when nothing changes", () => {
    const row = { id: 1, ownerEmail: "a@x.com" };
    expect(withNormalizedEmailField(row, "ownerEmail")).toBe(row);
    const res = { id: 1, email: "a@x.com", emails: ["b@y.com"] };
    expect(withNormalizedResourceEmails(res)).toBe(res);
  });
  it("return a new row carrying the normalised value", () => {
    expect(withNormalizedEmailField({ id: 1, ownerEmail: "Ann <a@x.com>" }, "ownerEmail")).toEqual({ id: 1, ownerEmail: "a@x.com" });
    expect(withNormalizedResourceEmails({ id: 1, email: "Ann <a@x.com>", emails: ["b@y.com; c@z.com"] })).toEqual({ id: 1, email: "a@x.com", emails: ["b@y.com", "c@z.com"] });
  });
});
```

Run; Expected EXIT=1. Then in `src/app/sanitize-core.ts`, after `findTornEmail`:

```ts
// --- Email load clean-up (spec Part 2) --------------------------------------

const NAME_ADDRESS_RE = /^[^<>]*<([^<>]+)>$/;

/** ★ LOAD-SIDE ONLY, and only a provably equivalent shape: a scalar
 *  `Name <addr>` whose inner `addr` is `isWriteSafeEmail` becomes `addr`.
 *  Anything else — including `Name <a,b@x.com>` — is returned UNCHANGED, so a
 *  load never refuses, drops or rewrites a value it cannot prove equal. */
export function normalizeEmailShape(value: string): string {
  const match = NAME_ADDRESS_RE.exec(value.trim());
  if (!match) return value;
  const inner = match[1].trim();
  return isWriteSafeEmail(inner) ? inner : value;
}

/** The list form, for `Resource.emails`: each member is unwrapped as above,
 *  and a member holding several addresses splits into separate members only
 *  when EVERY part is write-safe. */
export function normalizeEmailListShape(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const member of list) {
    const scalar = normalizeEmailShape(member);
    if (scalar !== member) { out.push(scalar); continue; }
    const parts = member.split(/[;,]/).map((p) => normalizeEmailShape(p.trim())).filter((p) => p !== "");
    if (parts.length > 1 && parts.every(isWriteSafeEmail)) out.push(...parts);
    else out.push(member);
  }
  return out;
}

/** Row helper for load paths that cast rows instead of sanitizing them
 *  (IndexedDB, the JSON RAID map). Same reference when nothing changes. */
export function withNormalizedEmailField<T extends object>(row: T, field: keyof T & string): T {
  const value = (row as Record<string, unknown>)[field];
  if (typeof value !== "string") return row;
  const next = normalizeEmailShape(value);
  return next === value ? row : { ...row, [field]: next };
}

/** `withNormalizedEmailField` for a resource's `email` + `emails` pair. */
export function withNormalizedResourceEmails<T extends { email?: string; emails?: string[] }>(row: T): T {
  const email = typeof row.email === "string" ? normalizeEmailShape(row.email) : row.email;
  const emails = Array.isArray(row.emails) ? normalizeEmailListShape(row.emails) : row.emails;
  const emailsSame = emails === row.emails || (Array.isArray(emails) && Array.isArray(row.emails)
    && emails.length === row.emails.length && emails.every((e, i) => e === row.emails![i]));
  if (email === row.email && emailsSame) return row;
  return { ...row, email, emails };
}
```

Rerun; Expected EXIT=0.

- [ ] **Step 2: Load funnels — failing round-trip test**

Create `src/app/email-normalize.load.test.ts`. The serializer names below were verified at HEAD (`workspaceToCsv`/`csvToWorkspace` via the `./csv-codecs` barrel, `workspaceToMarkdown`/`markdownToWorkspace` via `./markdown-codecs`, `workspaceToJson`/`jsonToWorkspace` in `workspace.ts`):

```ts
import { describe, expect, it } from "vitest";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson, type Workspace } from "./workspace";
import { csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import { markdownToWorkspace, workspaceToMarkdown } from "./markdown-codecs";
import { migrateTask } from "./task-status";
import { sanitizeRaidEscalations } from "./raid-escalation";

// Spec Part 2: a stored `Name <addr>` loads as `addr` on every text/JSON codec.
// The object is built UNSANITIZED on purpose — the loader is the subject.
function seeded(): Workspace {
  return {
    ...emptyWorkspace(),
    tasks: [{ id: 1, taskName: "T", assignee: "Ada", assigneeEmail: "Ada <ada@x.com>", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do", createdDate: "2026-06-01" } as never],
    raid: [{ id: 1, category: "R", title: "Risk", ownerEmail: "Ann <ann@x.com>", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-06-01", status: "Open", severity: "Medium" } as never],
    absences: [{ id: 1, assignee: "Ada", assigneeEmail: "Ada <ada@x.com>", startDate: "2026-06-01", endDate: "2026-06-02", type: "vacation" } as never],
    resources: [{ id: 1, firstName: "Ada", lastName: "L", email: "Ada <ada@x.com>", emails: ["b@y.com; c@z.com", "Ann <d@w.com>"], roleId: null, utilizationMode: "percent", utilization: {} } as never],
    stakeholders: [{ id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "Sam <sam@x.com>" } as never],
  };
}

function expectNormalised(ws: Workspace): void {
  expect(ws.tasks[0].assigneeEmail).toBe("ada@x.com");
  expect(ws.raid[0].ownerEmail).toBe("ann@x.com");
  expect(ws.absences[0].assigneeEmail).toBe("ada@x.com");
  expect(ws.resources[0].email).toBe("ada@x.com");
  // ★ "b@y.com; c@z.com" alone is vacuous for CSV and Markdown: those codecs
  //  already split on ";" today (§533). "Ann <d@w.com>" becomes "d@w.com" only
  //  through normalizeEmailListShape, on every codec (pre-flight M3).
  expect(ws.resources[0].emails).toEqual(["b@y.com", "c@z.com", "d@w.com"]);
  expect(ws.stakeholders?.[0].email).toBe("sam@x.com");
}

describe("the Name <addr> normaliser on every load funnel", () => {
  it("JSON", () => expectNormalised(jsonToWorkspace(workspaceToJson(seeded()))));
  it("CSV", () => expectNormalised(csvToWorkspace(workspaceToCsv(seeded()))));
  it("Markdown", () => expectNormalised(markdownToWorkspace(workspaceToMarkdown(seeded()))));
  it("migrateTask keeps the reference when nothing changes", () => {
    const task = seeded().tasks[0];
    const clean = { ...task, assigneeEmail: "ada@x.com" };
    expect(migrateTask(clean)).toBe(clean);
  });
  it("an escalation Name <addr> loads as addr; a Name <a,b@x.com> is still dropped", () => {
    const at = "2026-05-20T09:30:00.000Z";
    expect(sanitizeRaidEscalations([{ at, toEmail: "Ops <ops@x.com>" }])).toEqual([{ at, toEmail: "ops@x.com" }]);
    expect(sanitizeRaidEscalations([{ at, toEmail: "Ops <a,b@x.com>" }])).toEqual([]);
  });
});
```

Turso (single + tenant) decodes through the same `build*FromObj` / `sanitizeX` functions as CSV (`ENTITY_SPECS`). ★ No Turso round trip is run in this task: that shared decode path is the ONLY Turso coverage, and it is stated here rather than tested (pre-flight M3). IndexedDB is covered by adding one case to `src/app/browser-backend.test.ts`: add a seeded `Ann <ann@x.com>` RAID row asserting it loads as `ann@x.com`, copying that file's seeding pattern.

Run the new file; Expected EXIT=1.

- [ ] **Step 3: Load funnels — code**

- `task-status.ts`: `import { normalizeEmailShape } from "./sanitize-core";` and

```ts
export function migrateTask(task: Task): Task {
  const statusOk = typeof task.status === "string" && STATUS_SET.has(task.status);
  const createdOk = typeof task.createdDate === "string";
  const email = typeof task.assigneeEmail === "string" ? normalizeEmailShape(task.assigneeEmail) : task.assigneeEmail;
  const emailOk = email === task.assigneeEmail;
  if (statusOk && createdOk && emailOk) return task;
  const out = { ...task };
  if (!statusOk) out.status = task.completedDate ? "Done" : DEFAULT_TASK_STATUS;
  if (!createdOk) out.createdDate = task.lastUpdateDate || "";
  if (!emailOk) out.assigneeEmail = email;
  return out;
}
```
Docstring: add a third job "- assigneeEmail: a `Name <addr>` shape loads as `addr` (`normalizeEmailShape`)". If `task-status.ts` → `sanitize-core.ts` creates an import cycle tsc or vitest reports, STOP and ask.
- `sanitize-entities.ts`: add `normalizeEmailShape, normalizeEmailListShape,` to the `./sanitize-core` import; in `sanitizeAbsence` and `sanitizeShift` change `? sanitizeEmail(raw.assigneeEmail) || undefined` to `? normalizeEmailShape(sanitizeEmail(raw.assigneeEmail)) || undefined`; in `sanitizeResource`:
```ts
  const email = typeof input.email === "string" ? normalizeEmailShape(sanitizeEmail(input.email)) || undefined : undefined;
  if (email) resource.email = email;
  // The second pass dedupes and caps what the normaliser split (spec Part 2);
  // `sanitizeEmailList` itself is unchanged.
  const emails = sanitizeEmailList(normalizeEmailListShape(sanitizeEmailList(input.emails, email)), email);
```
- `sanitize-records.ts` (LINE-NEUTRAL; measure before and after, both 1600): change the import line `  sanitizeEmail,` to `  sanitizeEmail, normalizeEmailShape,`; in `sanitizeStakeholder` change `const email = sanitizeText(o.email, BUDGET_NAME_MAX); if (email) item.email = email;` to `const email = normalizeEmailShape(sanitizeText(o.email, BUDGET_NAME_MAX)); if (email) item.email = email;`; in `sanitizeContactPerson` change `const email = sanitizeEmail(input.email);` to `const email = normalizeEmailShape(sanitizeEmail(input.email));`.
- `workspace.ts`: add `withNormalizedEmailField,` to its `./sanitize` import; `raid: (p.raid as RaidItem[]).map(sanitizeRaidRichFields).map((r) => withNormalizedEmailField(r, "ownerEmail")),`.
- `csv-codecs-core.ts`: add `normalizeEmailShape,` to its `./sanitize` import; `ownerEmail: normalizeEmailShape(obj.ownerEmail ?? "") || undefined,`.
- `templates.ts`: add `normalizeEmailShape,` to its `./sanitize` import; `const ownerEmail = normalizeEmailShape(sanitizeEmail(raw.ownerEmail));`.
- `browser-backend.ts`: import `withNormalizedEmailField, withNormalizedResourceEmails` (extend the `./sanitize` import); directly after `milestones = milestones.map(sanitizeMilestoneRichFields);` add:
```ts
    // Spec Part 2: this backend casts these arrays WITHOUT a record sanitizer,
    // so the email-shape normaliser the other five paths get from their
    // sanitizers runs here explicitly. It only unwraps `Name <addr>`.
    absences = absences.map((a) => withNormalizedEmailField(a, "assigneeEmail"));
    shifts = shifts.map((s) => withNormalizedEmailField(s, "assigneeEmail"));
    raid = raid.map((r) => withNormalizedEmailField(r, "ownerEmail"));
    stakeholders = stakeholders.map((s) => withNormalizedEmailField(s, "email"));
    resources = resources.map((r) => withNormalizedResourceEmails(r));
```
- `raid-escalation.ts`: `import { isValidEmail, isWriteSafeEmail, normalizeEmailShape } from "./sanitize-core";` and in `sanitizeEntry`: `const toEmail = typeof o.toEmail === "string" ? normalizeEmailShape(o.toEmail.trim()).slice(0, EMAIL_MAX) : "";` with a comment `// Ruling Q5: Name <addr> is unwrapped BEFORE isEscalationEmail judges it.`

Rerun `email-normalize.load.test.ts`, `sanitize-core.email-rule.test.ts`, `raid-escalation.test.ts`, the IndexedDB test file, `golden-workspace.test.ts`, `codec-roundtrip.property.test.ts`, `task-status.test.ts`, `task-status.property.test.ts`, `templates.test.ts`. Expected after the census RECOMPUTEs: EXIT=0 with the file count matching.

- [ ] **Step 4: Sync drop + diagnostic**

Add to `src/app/jira-api.test.ts` (import `readDiagLog, clearDiagLog` from `./diagnostics`, `type JiraIssue` from `./jira-api` if not already):

```ts
describe("issueToTaskFields drops an assignee address that is not write-safe", () => {
  it("keeps the record, blanks the field and logs the key — never the address", () => {
    clearDiagLog();
    const fields = issueToTaskFields({ key: "LOP-7", fields: { summary: "S", assignee: { displayName: "Ada", emailAddress: "a,b@x.com" } } } as JiraIssue, "2026-01-01");
    expect(fields.taskName).toBe("S");
    expect(fields.assigneeEmail).toBe("");
    const entry = readDiagLog().find((e) => e.code === "jira.assigneeEmailDropped");
    expect(entry?.fields).toEqual({ issueKey: "LOP-7", field: "assigneeEmail" });
    expect(JSON.stringify(readDiagLog())).not.toContain("a,b@x.com");
  });
  it("unwraps Name <addr> and keeps it", () => {
    expect(issueToTaskFields({ key: "LOP-8", fields: { summary: "S", assignee: { displayName: "Ada", emailAddress: "Ada <ada@x.com>" } } } as JiraIssue, "2026-01-01").assigneeEmail).toBe("ada@x.com");
  });
});
```

Add to `src/app/outlook-contacts.test.ts`:

```ts
describe("mapGraphContact drops an address that is not write-safe", () => {
  it("keeps the contact, blanks the email and logs the source id", () => {
    clearDiagLog();
    const c = mapGraphContact({ id: "g1", displayName: "Zoe Adams", emailAddresses: [{ address: "a;b@x.com" }] }, 0)!;
    expect(c.displayName).toBe("Zoe Adams");
    expect(c.email).toBe("");
    expect(readDiagLog().find((e) => e.code === "outlook.contactEmailDropped")?.fields).toEqual({ sourceId: "g1", field: "email" });
  });
});
```

Run both; Expected EXIT=1. Code:

`src/app/jira-api.ts` (add `isWriteSafeEmail, normalizeEmailShape,` to the `./sanitize` import; `import { logDiag } from "./diagnostics";`). Before `return {` in `issueToTaskFields`:

```ts
  // Spec Part 2: a synced record keeps everything but an address that is not
  // write-safe after normalising; the diagnostic names the issue, never the address.
  const syncedEmail = normalizeEmailShape(sanitizeEmail(f.assignee?.emailAddress ?? ""));
  const assigneeEmail = syncedEmail === "" || isWriteSafeEmail(syncedEmail) ? syncedEmail : "";
  if (assigneeEmail !== syncedEmail) logDiag("warn", "jira.assigneeEmailDropped", { issueKey: issue.key, field: "assigneeEmail" });
```
and in the object `assigneeEmail,`.

`src/app/outlook-contacts.ts` (import `isWriteSafeEmail, normalizeEmailShape` beside `sanitizeEmail`; `import { logDiag } from "./diagnostics";`):

```ts
  const synced = normEmail(normalizeEmailShape(sanitizeEmail(raw.emailAddresses?.[0]?.address ?? "")));
  const email = synced === "" || isWriteSafeEmail(synced) ? synced : "";
  if (email !== synced) logDiag("warn", "outlook.contactEmailDropped", { sourceId: clean(raw.id) ?? `graph-${index}`, field: "email" });
```
replacing the single `const email = …` line. `handleImportResources` is unchanged — no notice (decision 4).

Rerun both plus `use-jira-sync.test.tsx`; Expected EXIT=0 after MIGRATEs.

- [ ] **Step 5: Notice — summary function and i18n**

Append to `src/app/record-email-guards.ts`:

```ts
import { isWriteSafeEmail } from "./sanitize-core";
import type { Absence, ProjectMeta, RaidItem, Resource, Shift, Stakeholder, Task } from "./types";

export interface UnsafeEmailScope {
  tasks?: readonly Task[];
  raid?: readonly RaidItem[];
  absences?: readonly Absence[];
  shifts?: readonly Shift[];
  resources?: readonly Resource[];
  stakeholders?: readonly Stakeholder[];
  project?: ProjectMeta;
}

const NOTICE_NAMES_MAX = 5;

/** The explicit-import notice's content (spec Part 2, decision 4): how many
 *  records still hold a present email that is not write-safe, and the first
 *  few of their names. Null when none. i18n-free; callers render
 *  `importUnsafeEmailsNotice`. Never names an address. */
export function summarizeUnsafeEmailRecords(ws: UnsafeEmailScope): { count: number; names: string } | null {
  const unsafe = (v: unknown): boolean => typeof v === "string" && v.trim() !== "" && !isWriteSafeEmail(v);
  const names: string[] = [];
  for (const row of ws.tasks ?? []) if (unsafe(row.assigneeEmail)) names.push(row.taskName);
  for (const row of ws.raid ?? []) if (unsafe(row.ownerEmail)) names.push(row.title);
  for (const row of ws.absences ?? []) if (unsafe(row.assigneeEmail)) names.push(row.assignee);
  for (const row of ws.shifts ?? []) if (unsafe(row.assigneeEmail)) names.push(row.assignee);
  for (const row of ws.resources ?? []) {
    if (unsafe(row.email) || (row.emails ?? []).some(unsafe)) names.push(`${row.firstName} ${row.lastName}`.trim());
  }
  for (const row of ws.stakeholders ?? []) if (unsafe(row.email)) names.push(row.name);
  for (const person of ws.project?.contactPersons ?? []) if (unsafe(person.email)) names.push(person.name);
  if (names.length === 0) return null;
  const shown = names.slice(0, NOTICE_NAMES_MAX).join(", ");
  return { count: names.length, names: names.length > NOTICE_NAMES_MAX ? `${shown}, …` : shown };
}
```
(merge the two new imports into the file's existing import block; `isWriteSafeEmail` joins the `./sanitize-core` import.)

Unit test in `src/app/sanitize-core.email-rule.test.ts`:

```ts
describe("summarizeUnsafeEmailRecords", () => {
  it("counts and names records holding a present unsafe address, never a blank or safe one", () => {
    expect(summarizeUnsafeEmailRecords({
      tasks: [{ taskName: "T1", assigneeEmail: "a,b@x.com" }, { taskName: "T2", assigneeEmail: "" }] as never,
      stakeholders: [{ name: "Sam", email: "sam@x.com" }] as never,
      project: { contactPersons: [{ name: "Cleo", email: "nope", synced: false }] } as never,
    })).toEqual({ count: 2, names: "T1, Cleo" });
    expect(summarizeUnsafeEmailRecords({ tasks: [] })).toBeNull();
  });
  it("caps the names at five", () => {
    const tasks = Array.from({ length: 7 }, (_, i) => ({ taskName: `T${i}`, assigneeEmail: "nope" }));
    expect(summarizeUnsafeEmailRecords({ tasks: tasks as never })?.names).toBe("T0, T1, T2, T3, T4, …");
  });
});
```

Also append to `src/app/record-email-guards.ts` (pre-flight I4 — the template-apply notice must name only what the template brought in):

```ts
import type { Workspace } from "./workspace";

/** The rows `handleApplyTemplate` (task-manager.tsx) actually brings in: the
 *  rows `appendSeed` ADDED to the three slices that handler applies (`tasks`,
 *  `raid`, `stakeholders`) — ids present in `after` but not in `before`. Never
 *  the current project's existing rows. Exact because `remapSeed` gives every
 *  seed row a fresh id. `resources` is left out: `handleApplyTemplate` does not
 *  apply the seed's resources. */
export function templateSeedEmailScope(
  before: Pick<Workspace, "tasks" | "raid" | "stakeholders">,
  after: Pick<Workspace, "tasks" | "raid" | "stakeholders">,
): UnsafeEmailScope {
  const added = <T extends { id: number }>(prev: readonly T[] | undefined, next: readonly T[] | undefined): T[] => {
    const known = new Set((prev ?? []).map((row) => row.id));
    return (next ?? []).filter((row) => !known.has(row.id));
  };
  return {
    tasks: added(before.tasks, after.tasks),
    raid: added(before.raid, after.raid),
    stakeholders: added(before.stakeholders, after.stakeholders),
  };
}
```
(merge the `import type` into the file's import block.)

Unit test in `src/app/sanitize-core.email-rule.test.ts` (import `templateSeedEmailScope` from `./sanitize`, `applyTemplate` from `./template-apply`, `emptyWorkspace` from `./workspace`). It runs the REAL `applyTemplate`, so the scope is judged against what `appendSeed` actually produces:

```ts
describe("templateSeedEmailScope — the template-apply notice counts only the seed (pre-flight I4)", () => {
  const row = (id: number, taskName: string, assigneeEmail: string) => ({
    id, taskName, assignee: "A", assigneeEmail, dueDate: "2026-06-01", lastUpdateDate: "2026-06-01",
    priority: "Medium", status: "To Do", createdDate: "2026-06-01",
  });

  it("names the seed's unsafe row and never the current project's", () => {
    const current = { ...emptyWorkspace(), tasks: [row(1, "Existing", "old,bad@x.com")] as never };
    const tpl = { id: "tpl-unsafe", name: "T", features: [], fieldVisibility: {}, seed: { tasks: [row(1, "Seeded", "a,b@x.com")] } } as never;
    const next = applyTemplate(current, tpl, { includeSeed: true });
    expect(next.tasks).toHaveLength(2); // control: the seed really landed beside the existing row
    expect(summarizeUnsafeEmailRecords(next)).toEqual({ count: 2, names: "Existing, Seeded" }); // what summarising `next` would announce
    expect(summarizeUnsafeEmailRecords(templateSeedEmailScope(current, next))).toEqual({ count: 1, names: "Seeded" });
  });
});
```

i18n — `src/app/i18n.ts` after `  templateApplied: "Template applied",` add `  importUnsafeEmailsNotice: "Imported records with an invalid email address ({0}): {1}",`. DE via `$LOG/de-t5.cjs`:

```js
const fs = require("fs");
const P = "src/app/i18n.de.ts";
const s = fs.readFileSync(P, "utf8");
const anchor = "  templateApplied: \"Vorlage angewendet\",\r\n";
const count = s.split(anchor).length - 1;
if (count !== 1) { console.error("anchor count " + count); process.exit(1); }
const add = "  importUnsafeEmailsNotice: \"Importierte Eintr\u00e4ge mit ung\u00fcltiger E-Mail-Adresse ({0}): {1}\",\r\n";
fs.writeFileSync(P, s.replace(anchor, anchor + add), "utf8");
console.log("ok");
```
Run `node "$LOG/de-t5.cjs"; echo "EXIT=$?"`. Then write `$LOG/de-check-t5.cjs` with the Write tool and run `node "$LOG/de-check-t5.cjs"; echo "EXIT=$?"` — Expected `ok`, `EXIT=0`; anything else is a STOP:

```js
const fs = require("fs");
const s = fs.readFileSync("src/app/i18n.de.ts", "utf8");
const expected = "  templateApplied: \"Vorlage angewendet\",\r\n"
  + "  importUnsafeEmailsNotice: \"Importierte Eintr\u00e4ge mit ung\u00fcltiger E-Mail-Adresse ({0}): {1}\",\r\n";
const problems = [];
const bareLf = (s.match(/(?<!\r)\n/g) || []).length;
if (bareLf !== 0) problems.push("bareLF " + bareLf);
if (s.includes("\ufffd")) problems.push("U+FFFD replacement character present");
const hits = s.split(expected).length - 1;
if (hits !== 1) problems.push("expected bytes found " + hits + " time(s)");
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("ok");
```

- [ ] **Step 6: Notice — the explicit import sites**

Every site renders `t(lang, "importUnsafeEmailsNotice", s.count, s.names)` AFTER its confirmation toast and BEFORE its report call (single-slot surface; a data-loss diagnostic must win). Import `summarizeUnsafeEmailRecords` from `./sanitize`.

`use-storage-file-ops.ts`:
- `switchToProject`: between `deps.showToast("info", t(…, "projectSwitchedToast", target.name));` and `deps.truncationOps.reportFor(targetBackend);` insert
```ts
      const unsafeEmails = summarizeUnsafeEmailRecords(loaded); // spec Part 2: after the confirmation, before the report
      if (unsafeEmails) deps.showToast("info", t(deps.langRef.current, "importUnsafeEmailsNotice", unsafeEmails.count, unsafeEmails.names));
```
- `loadProjectFromFile`: same two lines between `projectLoadedToast` and `reportFor(targetBackend)`.
- `createProject`: after `projectCreatedToast`:
```ts
      const seededEmails = opts.template || opts.aiSeed ? summarizeUnsafeEmailRecords(ws) : null; // template or AI import seed only
      if (seededEmails) deps.showToast("info", t(deps.langRef.current, "importUnsafeEmailsNotice", seededEmails.count, seededEmails.names));
```
- `onOpenStorageFile`: inside `if (accepted) { … }`, directly after `deps.emitToast("info", t(…, "storageOpenedToast", …));`:
```ts
        const openedEmails = summarizeUnsafeEmailRecords({ tasks: loaded.tasks, raid: loaded.raid }); // only what this path applies
        if (openedEmails) deps.emitToast("info", t(deps.langRef.current, "importUnsafeEmailsNotice", openedEmails.count, openedEmails.names));
```

`use-storage-turso-ops.ts` `createTursoProject`: the same two `seededEmails` lines after its `projectCreatedToast`.

`task-manager.tsx` — line-neutral, three single-line edits (each anchor occurs exactly once at HEAD):
- `import { sanitizeRaidItem } from "./sanitize";` → `import { sanitizeRaidItem, summarizeUnsafeEmailRecords, templateSeedEmailScope } from "./sanitize";`
- `      const next = applyTemplate(buildCurrentWorkspace(), tpl, opts);` → `      const current = buildCurrentWorkspace(); const next = applyTemplate(current, tpl, opts);`
- `      showToast("info", t(lang, "templateApplied"));` → `      showToast("info", t(lang, "templateApplied")); const seededEmails = opts.includeSeed ? summarizeUnsafeEmailRecords(templateSeedEmailScope(current, next)) : null; if (seededEmails) showToast("info", t(lang, "importUnsafeEmailsNotice", seededEmails.count, seededEmails.names));`

★ Summarise `templateSeedEmailScope(current, next)`, NEVER `next`: `next` is the current workspace plus the seed, so it would announce existing records as "Imported" (pre-flight I4). The `useCallback` dependency array needs no change (`buildCurrentWorkspace`, `showToast` and `lang` are already in it). Measure `task-manager.tsx` before and after: both 3257.

Tests — `src/app/use-storage-backend.test.tsx`, after "onOpenStorageFile loads workspace on confirm":

```ts
  it("onOpenStorageFile shows the unsafe-email notice AFTER the opened toast (spec Part 2)", async () => {
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(undefined));
    mockBackend.load.mockResolvedValueOnce({ tasks: [], raid: [], absences: [], shifts: [] });
    mockBackend.load.mockResolvedValueOnce({
      tasks: [{ id: 99, taskName: "Loaded", assigneeEmail: "a,b@x.com" }] as unknown as Task[],
      raid: [], absences: [], shifts: [],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    showToast.mockClear();
    await act(async () => { await result.current.onOpenStorageFile(); });
    const texts = showToast.mock.calls.map((c) => c[1]);
    const opened = texts.indexOf(t("en-US", "storageOpenedToast", 1));
    const notice = texts.indexOf(t("en-US", "importUnsafeEmailsNotice", 1, "Loaded"));
    expect(opened).toBeGreaterThanOrEqual(0);
    expect(notice).toBeGreaterThan(opened);
  });

  it("a normal reload shows no unsafe-email notice", async () => {
    mockBackend.load.mockResolvedValueOnce({ tasks: [{ id: 1, taskName: "A", assigneeEmail: "a,b@x.com" }] as unknown as Task[], raid: [], absences: [], shifts: [] });
    renderBackend();
    await act(async () => { await Promise.resolve(); });
    expect(showToast.mock.calls.map((c) => c[1])).not.toContain(t("en-US", "importUnsafeEmailsNotice", 1, "A"));
  });
```

(`renderBackend`'s language is `en-US`, and `emitToast` calls `args.showToast`, so both paths reach the file's `showToast` spy.) Add the equivalent ordering case for `switchToProject` beside the existing "switchToProject saves the outgoing project…" test, seeding the target load with one unsafe task.

File-mode `createProject` (pre-flight I5) — in `src/app/use-storage-backend.test.tsx`, beside "createProject applies the new empty workspace + registers/selects it" (same `createBackendMock`, `mockBackend`, `setStorageConfig`):

```ts
  const SEED_TASK = { id: 1, taskName: "From seed", assignee: "B", assigneeEmail: "a,b@x.com", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do", createdDate: "2026-06-01" };

  it.each([
    ["a template", { includeSeed: true, template: { id: "t", name: "T", features: [], fieldVisibility: {}, seed: { tasks: [SEED_TASK] } } }],
    ["an AI-import seed", { includeSeed: true, aiSeed: { tasks: [SEED_TASK] } }],
  ])("createProject with %s shows the unsafe-email notice after projectCreatedToast (spec Part 2, pre-flight I5)", async (_label, opts) => {
    const targetBackend = {
      kind: "local-json",
      load: vi.fn().mockResolvedValue(emptyWorkspace()),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("new.json"),
    };
    createBackendMock.mockReturnValueOnce(mockBackend).mockReturnValue(targetBackend);
    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    showToast.mockClear();
    await act(async () => {
      await result.current.createProject({ name: "New Proj", code: "NP" } as never, "json", opts as never);
    });
    const texts = showToast.mock.calls.map((c) => c[1]);
    const created = texts.indexOf(t("en-US", "projectCreatedToast", "New Proj"));
    expect(created).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf(t("en-US", "importUnsafeEmailsNotice", 1, "From seed"))).toBeGreaterThan(created);
  });
```

The AI-seed row kills the mutant that deletes `|| opts.aiSeed`; the template row kills the one that deletes `opts.template ||`.

`createTursoProject` (pre-flight I5) — in `src/app/use-storage-turso-ops.test.ts`, beside "createTursoProject CLEARS the flag" (its `renderWithRealGuard` returns the `showToast` spy, and `makeDeps`' `langRef` is `en-US`; add `import { t } from "./i18n";` if missing):

```ts
  const SEED_TASK = { id: 1, taskName: "From seed", assignee: "B", assigneeEmail: "a,b@x.com", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do", createdDate: "2026-06-01" };

  it.each([
    ["a template", { includeSeed: true, template: { id: "t", name: "T", features: [], fieldVisibility: {}, seed: { tasks: [SEED_TASK] } } }],
    ["an AI-import seed", { includeSeed: true, aiSeed: { tasks: [SEED_TASK] } }],
  ])("createTursoProject with %s shows the unsafe-email notice after projectCreatedToast (pre-flight I5)", async (_label, opts) => {
    const { result } = renderWithRealGuard(async () => {});
    await act(async () => {
      await result.current.ops.createTursoProject({ id: "n-2", name: "New", code: "N" } as never, opts as never);
    });
    const texts = result.current.showToast.mock.calls.map((c) => c[1]);
    const created = texts.indexOf(t("en-US", "projectCreatedToast", "New"));
    expect(created).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf(t("en-US", "importUnsafeEmailsNotice", 1, "From seed"))).toBeGreaterThan(created);
  });
```

`loadProjectFromFile` and `onOpenStorageFile` — the ordering landmine (pre-flight I5, I9). The spec requires the notice to fire BEFORE the report, so a data-loss diagnostic wins the single toast slot. Add both cases inside `describe("useStorageBackend — import diagnostics reach every load path", …)`, which owns `makeImportBackend`, `importToasts` and `survivingToast`. Put them directly after "loadProjectFromFile still reports — the path the inline block was moved OFF":

```ts
  it("loadProjectFromFile: the unsafe-email notice fires BEFORE the import diagnostic, which survives (spec Part 2, pre-flight I5 + I9)", async () => {
    const main = makeImportBackend();
    const opened = makeImportBackend();
    opened.load.mockImplementation(async () => {
      opened.lastImportDroppedRows = 9;
      return { ...emptyWorkspace(), tasks: [{ id: 1, taskName: "Loaded", assigneeEmail: "a,b@x.com" } as unknown as Task] };
    });
    createBackendMock.mockReturnValueOnce(main).mockReturnValue(opened);
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(true));
    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.loadProjectFromFile("json"); });

    const texts = showToast.mock.calls.map((c) => String(c[1]));
    const notice = texts.indexOf(t("en-US", "importUnsafeEmailsNotice", 1, "Loaded"));
    const diagnostic = texts.findIndex((s) => s.includes("9 invalid row(s)"));
    expect(notice).toBeGreaterThanOrEqual(0); // control: the notice fired at all
    expect(diagnostic).toBeGreaterThan(notice);
    expect(survivingToast()).toContain("9 invalid row(s)"); // the data-loss diagnostic keeps the slot
  });

  it("onOpenStorageFile: the notice fires AFTER storageOpenedToast and BEFORE the import diagnostic, which survives (pre-flight I9)", async () => {
    const b = makeImportBackend();
    createBackendMock.mockReturnValue(b);
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(undefined));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    b.load.mockImplementationOnce(async () => {
      b.lastImportDroppedRows = 7;
      return { ...emptyWorkspace(), tasks: [{ id: 99, taskName: "Loaded", assigneeEmail: "a,b@x.com" } as unknown as Task] };
    });

    await act(async () => { await result.current.onOpenStorageFile(); });

    const texts = showToast.mock.calls.map((c) => String(c[1]));
    const opened = texts.indexOf(t("en-US", "storageOpenedToast", 1));
    const notice = texts.indexOf(t("en-US", "importUnsafeEmailsNotice", 1, "Loaded"));
    const diagnostic = texts.findIndex((s) => s.includes("7 invalid row(s)"));
    expect(opened).toBeGreaterThanOrEqual(0);
    expect(notice).toBeGreaterThan(opened);
    expect(diagnostic).toBeGreaterThan(notice);
    expect(survivingToast()).toContain("7 invalid row(s)");
  });
```

(`onOpenStorageFile` asks `window.confirm` only when the current project has tasks, so the spy is harmless when it does not. Restore the spy the way this file's other `window.confirm` spies are restored.) Mutation for each: move that site's two notice lines below its `reportFor` / `reportImportFor` call. Its ordering test must turn red. Revert, then confirm `git diff --stat` is unchanged.

Template apply (pre-flight I4) — behavioural test of the real `handleApplyTemplate`. Create `src/app/task-manager.template-notice.test.tsx`:

```tsx
// Pins the template-apply notice WIRING in task-manager.tsx (spec Part 2,
// pre-flight I4). The REAL handleApplyTemplate runs, captured from the deps
// task-manager hands buildShellChrome, and the assertions read the toast the
// real AppModals renders. Which rows count is ALSO pinned purely by the
// templateSeedEmailScope test; this file pins that the handler uses it.
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { t } from "./i18n";

const chrome = vi.hoisted(() => ({ apply: null as null | ((id: string, opts: { includeSeed: boolean }) => void) }));

vi.mock("./shell-chrome", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./shell-chrome")>();
  return {
    ...actual,
    buildShellChrome: (deps: Parameters<typeof actual.buildShellChrome>[0]) => {
      chrome.apply = deps.handleApplyTemplate;
      return actual.buildShellChrome(deps);
    },
  };
});

vi.mock("./workspace-section", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspace-section")>();
  const { useWorkspace } = await import("./workspace-context");
  return {
    ...actual,
    WorkspaceSection: () => {
      const { tasks } = useWorkspace();
      return <div data-testid="ws-section-mock" data-task-count={tasks.length} />;
    },
  };
});

import TaskManager from "./task-manager";

const SEEDED_TASK = { id: 1, taskName: "Seeded", assignee: "B", assigneeEmail: "a,b@x.com", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do", createdDate: "2026-06-01" };
const TEMPLATE = { id: "tpl-unsafe-email", name: "Unsafe email", features: [], fieldVisibility: {}, seed: { tasks: [SEEDED_TASK] } };

async function mount() {
  window.localStorage.clear();
  chrome.apply = null;
  window.localStorage.setItem("aipm-cockpit:projects", JSON.stringify({
    projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
    currentProjectId: "p1",
  }));
  window.localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ templates: [TEMPLATE] }));
  window.history.replaceState(null, "", "/");
  render(<TaskManager />);
  await screen.findByTestId("ws-section-mock");
}

const taskCount = () => screen.getByTestId("ws-section-mock").getAttribute("data-task-count");

beforeEach(() => { __resetMintStateForTests(); });
afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("handleApplyTemplate — the unsafe-email notice (spec Part 2, pre-flight I4)", () => {
  it("positive control: applying WITHOUT the seed shows the applied toast and no notice", async () => {
    await mount();
    act(() => chrome.apply!("tpl-unsafe-email", { includeSeed: false }));
    expect(await screen.findByText(t("en-US", "templateApplied"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "importUnsafeEmailsNotice", 1, "Seeded"))).toBeNull();
    expect(taskCount()).toBe("0");
  }, 45000);

  it("names only the rows the template brought in: a second apply announces ONE record, not two", async () => {
    await mount();
    act(() => chrome.apply!("tpl-unsafe-email", { includeSeed: true }));
    await waitFor(() => expect(taskCount()).toBe("1"));
    expect(await screen.findByText(t("en-US", "importUnsafeEmailsNotice", 1, "Seeded"))).toBeInTheDocument();

    act(() => chrome.apply!("tpl-unsafe-email", { includeSeed: true }));
    await waitFor(() => expect(taskCount()).toBe("2")); // control: the second seed landed beside the first
    expect(screen.getByText(t("en-US", "importUnsafeEmailsNotice", 1, "Seeded"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "importUnsafeEmailsNotice", 2, "Seeded, Seeded"))).toBeNull();
  }, 45000);
});
```

Mutation: in `task-manager.tsx` replace `templateSeedEmailScope(current, next)` with `next`. The second test must turn red, because the second apply then announces `2` and `Seeded, Seeded`. Revert, then confirm `git diff --stat` shows `task-manager.tsx` with exactly three changed lines. STOP instead of weakening an assertion in any of these cases: the first test's toast never appears (the settings template did not load — read `useTemplates` / the settings loader for the blob shape it expects, and report); the task count does not reach `1` or `2` (a load replaced the applied tasks); or `buildShellChrome` is not called with `handleApplyTemplate`.

- [ ] **Step 7: Gates**

Run every Task 5 test file in one invocation and assert `Test Files 15 passed (15)`:

```bash
npx vitest run src/app/sanitize-core.email-rule.test.ts src/app/raid-escalation.test.ts src/app/email-normalize.load.test.ts src/app/browser-backend.test.ts src/app/jira-api.test.ts src/app/outlook-contacts.test.ts src/app/use-jira-sync.test.tsx src/app/use-storage-backend.test.tsx src/app/use-storage-turso-ops.test.ts src/app/task-manager.template-notice.test.tsx src/app/golden-workspace.test.ts src/app/codec-roundtrip.property.test.ts src/app/task-status.test.ts src/app/task-status.property.test.ts src/app/templates.test.ts --maxWorkers=1 --reporter=dot > "$LOG/t5.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG/t5.log"
```

Then tsc, eslint over touched files, size:check, and `node -e` size readings for `sanitize-records.ts` (1600) and `task-manager.tsx` (3257).

- [ ] **Step 8: Commit**

Subject `feat: load normaliser, explicit-import email notice and sync drop`. The paths, enumerated (pre-flight M12):

```bash
T5_PATHS="src/app/sanitize-core.ts src/app/task-status.ts src/app/sanitize-entities.ts src/app/sanitize-records.ts src/app/workspace.ts src/app/csv-codecs-core.ts src/app/templates.ts src/app/browser-backend.ts src/app/raid-escalation.ts src/app/record-email-guards.ts src/app/use-storage-file-ops.ts src/app/use-storage-turso-ops.ts src/app/task-manager.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/jira-api.ts src/app/outlook-contacts.ts src/app/sanitize-core.email-rule.test.ts src/app/raid-escalation.test.ts src/app/email-normalize.load.test.ts src/app/browser-backend.test.ts src/app/jira-api.test.ts src/app/outlook-contacts.test.ts src/app/use-storage-backend.test.tsx src/app/use-storage-turso-ops.test.ts src/app/task-manager.template-notice.test.tsx"
git status --porcelain=v1 --untracked-files=all
```

A census RECOMPUTE or MIGRATE file you actually edited is appended by name, and only from this list: `src/app/codec-roundtrip.property.test.ts`, `src/app/use-jira-sync.test.tsx`, `src/app/task-status.test.ts`, `src/app/task-status.property.test.ts`. Any other modified or untracked path is a STOP.

```bash
git add $T5_PATHS && git commit --only $T5_PATHS -F "$LOG/msg-t5.txt"; echo "EXIT=$?"
```

---

### Task 6: Propagate a corrected person email to FK-linked copies (spec Part 7)

**Files:**
- Create: `src/app/resource-email-propagation.ts` (pure, i18n-free)
- Create: `src/app/resource-email-propagation-commit.ts` (setters + undo fragments)
- Modify: `src/app/undo/use-undo-stack.ts` (`CaptureCompositeOpts.toastText`, `pushEntry` text override)
- Modify: `src/app/use-resource-directory.ts` (`handleSaveResource`)
- Modify: `src/app/use-chat-dispatcher.ts` (`updateResource`)
- Modify: `src/app/test-providers.tsx` (`TestSeed.shifts`, `TestSeed.project`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (`undoToastResourceEmailPropagated`)
- Create: `src/app/resource-email-propagation.test.ts`, `src/app/use-resource-directory.email-propagation.test.tsx`, `src/app/resource-email-propagation.parity.test.tsx`
- Test (ADD): `src/app/undo/use-undo-stack.test.tsx`

**Interfaces:**
- Consumes: nothing from Tasks 2–5 at runtime (a propagated value is the corrected one; the resource editor refused an unsafe correction in Task 3 and `updateResource` in Task 2).
- Produces (`resource-email-propagation.ts`):
  - `interface ResourceEmailChange { resourceId: number; from: string; to: string }`
  - `resourceEmailChange(before: Resource, after: Resource): ResourceEmailChange | null` — null when the trimmed primary email did not change or the old one was blank
  - `interface ArrayPropagation<T> { next: readonly T[]; edited: T[] }` (`edited` = before-images of changed rows)
  - `retargetTaskEmails(rows: readonly Task[], change: ResourceEmailChange): ArrayPropagation<Task>` and the same shape for `retargetRaidEmails` (`RaidItem`), `retargetAbsenceEmails` (`Absence`), `retargetShiftEmails` (`Shift`), `retargetStakeholderEmails` (`Stakeholder`)
  - `retargetContactPersonEmails(rows: readonly ContactPerson[], change: ResourceEmailChange): { next: readonly ContactPerson[]; changed: number }`
  - `interface EmailPropagationInput { tasks: readonly Task[]; raid: readonly RaidItem[]; absences: readonly Absence[]; shifts: readonly Shift[]; stakeholders: readonly Stakeholder[]; contactPersons: readonly ContactPerson[] }`
  - `interface EmailPropagationResult { tasks: ArrayPropagation<Task>; raid: ArrayPropagation<RaidItem>; absences: ArrayPropagation<Absence>; shifts: ArrayPropagation<Shift>; stakeholders: ArrayPropagation<Stakeholder>; contactPersons: { next: readonly ContactPerson[]; changed: number }; count: number }`
  - `propagateResourceEmail(change: ResourceEmailChange, input: EmailPropagationInput): EmailPropagationResult`
- Produces (`resource-email-propagation-commit.ts`):
  - `type PropagationSetters = Pick<ReturnType<typeof useWorkspace>, "setTasks" | "setRaid" | "setAbsences" | "setShifts" | "setStakeholders" | "setProject">`
  - `contactPersonsFragment(setProject: PropagationSetters["setProject"], before: readonly ContactPerson[], after: readonly ContactPerson[]): CompositeFragment`
  - `commitEmailPropagation(args: { change: ResourceEmailChange; input: EmailPropagationInput; result: EmailPropagationResult; setters: PropagationSetters }): (CompositeFragment | null)[]`
- Produces (`use-undo-stack.ts`): `CaptureCompositeOpts.toastText?: string`.
- i18n `undoToastResourceEmailPropagated` (`{0}` = propagated record count).

**Matching rule (controller rulings):** a row is reached when its FK equals the resource id AND its cached email, trimmed and case-folded, equals the OLD primary email trimmed and case-folded; the new value written is `change.to` (trimmed). Tasks with `jiraKey` are skipped. Escalations are never reached. A blank old email propagates nothing.

**Test census (run first; label every hit):**

```bash
git grep -n "handleSaveResource\|captureFieldEdit\|resource.updated\|undoToastEdit" -- "src/**/*.test.*" "src/test/**"
git grep -n "TestSeed\|dispatcherWrapperWith" -- src
git grep -rn "assigneeEmail" -- src/app/use-calendar-integrations.ts
```

- ADD the three new test files; ADD a `toastText` case to `undo/use-undo-stack.test.tsx`.
- Must stay green: `use-resource-planner.test.tsx` ("handleSaveResource logs resource.updated…") and `use-resource-planner.undo.test.tsx` (the `captureFieldEdit` `resource.updated` case) — their resources have no linked rows, so nothing propagates and `captureFieldEdit` is still the capture. RECOMPUTE only if one seeds a linked row with an equal email.
- Must stay green: `use-chat-dispatcher.undo.test.tsx` `updateResource` row (single-part composite; no linked rows) — ADD a propagating variant in the parity file rather than editing that table.
- `TestSeed` extension is additive: every existing `dispatcherWrapperWith` caller is unaffected.
- The third grep must print nothing (spec correction 17). If it prints a line, STOP and ask whether propagation must trigger an Outlook re-push.

- [ ] **Step 1: Pure helper — failing tests**

Create `src/app/resource-email-propagation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  propagateResourceEmail,
  resourceEmailChange,
  retargetContactPersonEmails,
  retargetTaskEmails,
  type EmailPropagationInput,
} from "./resource-email-propagation";
import type { RaidItem, Resource, Task } from "./types";

const ada: Resource = { id: 7, firstName: "Ada", lastName: "L", email: "old@x.com", roleId: null, utilizationMode: "percent", utilization: {} };
const task = (over: Partial<Task>): Task => ({ id: 1, taskName: "T", assignee: "Ada", assigneeEmail: "old@x.com", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do", resourceId: 7, ...over }) as Task;

function input(over: Partial<EmailPropagationInput> = {}): EmailPropagationInput {
  return { tasks: [], raid: [], absences: [], shifts: [], stakeholders: [], contactPersons: [], ...over };
}

describe("resourceEmailChange", () => {
  it("is null when the primary email is unchanged (trimmed) or the old one is blank", () => {
    expect(resourceEmailChange(ada, { ...ada, email: " old@x.com " })).toBeNull();
    expect(resourceEmailChange({ ...ada, email: "" }, { ...ada, email: "new@x.com" })).toBeNull();
  });
  it("describes any other change, a case-only change included", () => {
    expect(resourceEmailChange(ada, { ...ada, email: "new@x.com" })).toEqual({ resourceId: 7, from: "old@x.com", to: "new@x.com" });
    expect(resourceEmailChange(ada, { ...ada, email: "Old@x.com" })).toEqual({ resourceId: 7, from: "old@x.com", to: "Old@x.com" });
  });
});

describe("propagateResourceEmail", () => {
  const change = { resourceId: 7, from: "old@x.com", to: "new@x.com" };

  it("updates an FK-linked row whose cache equals the old email, trimmed and case-insensitively", () => {
    const out = propagateResourceEmail(change, input({ tasks: [task({ assigneeEmail: "  OLD@x.com " })] }));
    expect(out.tasks.next[0].assigneeEmail).toBe("new@x.com");
    expect(out.tasks.edited).toHaveLength(1);
    expect(out.count).toBe(1);
  });

  it("leaves a different cache, a blank cache and an unlinked row untouched", () => {
    const rows = [task({ id: 1, assigneeEmail: "other@x.com" }), task({ id: 2, assigneeEmail: "" }), task({ id: 3, resourceId: undefined })];
    const out = propagateResourceEmail(change, input({ tasks: rows }));
    expect(out.tasks.next).toBe(rows);
    expect(out.count).toBe(0);
  });

  it("skips a Jira-synced task", () => {
    const rows = [task({ jiraKey: "LOP-1" })];
    expect(propagateResourceEmail(change, input({ tasks: rows })).tasks.next).toBe(rows);
  });

  it("reaches RAID owners, absences, shifts, stakeholders and contact persons, never escalations", () => {
    const raid = [{ id: 1, title: "R", category: "R", ownerResourceId: 7, ownerEmail: "old@x.com", escalations: [{ at: "2026-05-20T09:30:00.000Z", toEmail: "old@x.com", toResourceId: 7 }] } as unknown as RaidItem];
    const out = propagateResourceEmail(change, input({
      raid,
      absences: [{ id: 1, assignee: "Ada", assigneeEmail: "old@x.com", resourceId: 7, startDate: "2026-06-01", endDate: "2026-06-02", type: "vacation" }] as never,
      shifts: [{ id: 1, assignee: "Ada", assigneeEmail: "old@x.com", resourceId: 7, hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] }] as never,
      stakeholders: [{ id: 1, name: "Ada", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "old@x.com", resourceId: 7 }] as never,
      contactPersons: [{ name: "Ada", email: "old@x.com", synced: true, resourceId: 7 }, { name: "Bob", email: "old@x.com", synced: false }],
    }));
    expect(out.raid.next[0].ownerEmail).toBe("new@x.com");
    expect(out.raid.next[0].escalations?.[0].toEmail).toBe("old@x.com");
    expect(out.absences.next[0].assigneeEmail).toBe("new@x.com");
    expect(out.shifts.next[0].assigneeEmail).toBe("new@x.com");
    expect(out.stakeholders.next[0].email).toBe("new@x.com");
    expect(out.contactPersons.next.map((c) => c.email)).toEqual(["new@x.com", "old@x.com"]);
    expect(out.count).toBe(5);
  });

  it("returns the same references when nothing matches", () => {
    const tasks = [task({ assigneeEmail: "x@x.com" })];
    const people = [{ name: "Bob", email: "old@x.com", synced: false }];
    expect(retargetTaskEmails(tasks, change).next).toBe(tasks);
    expect(retargetContactPersonEmails(people, change).next).toBe(people);
  });
});
```

Run it; Expected EXIT=1 (module missing).

- [ ] **Step 2: Pure helper — code**

Create `src/app/resource-email-propagation.ts`:

```ts
// Spec Part 7 — when a person's primary email is corrected in the resource
// record, carry the correction to the FK-linked records it was COPIED into.
// Pure and i18n-free; both writers call it (`handleSaveResource` in
// use-resource-directory.ts and AI `updateResource` in use-chat-dispatcher.ts),
// pinned equal by resource-email-propagation.parity.test.tsx.
//
// ★★ Rulings: FK-linked rows only (never an address match — a shared mailbox
//  or an address-book contact must not be rewritten); only rows whose cached
//  email still equals the OLD email (trimmed, case-folded — the convention of
//  `resource-foundation.ts` and `purgeCalendarFor`); Jira-synced tasks skipped;
//  escalations NEVER reached (they record who was actually mailed).
import type { Absence, ContactPerson, RaidItem, Resource, Shift, Stakeholder, Task } from "./types";

export interface ResourceEmailChange { resourceId: number; from: string; to: string }
export interface ArrayPropagation<T> { next: readonly T[]; edited: T[] }

export interface EmailPropagationInput {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  stakeholders: readonly Stakeholder[];
  contactPersons: readonly ContactPerson[];
}

export interface EmailPropagationResult {
  tasks: ArrayPropagation<Task>;
  raid: ArrayPropagation<RaidItem>;
  absences: ArrayPropagation<Absence>;
  shifts: ArrayPropagation<Shift>;
  stakeholders: ArrayPropagation<Stakeholder>;
  contactPersons: { next: readonly ContactPerson[]; changed: number };
  count: number;
}

const fold = (s: string | undefined): string => (s ?? "").trim().toLowerCase();

/** The primary-email change a save makes, or null. ANY trimmed change counts
 *  (a case-only correction included); a blank old email propagates nothing,
 *  because a blank cache must never be filled by this. */
export function resourceEmailChange(before: Resource, after: Resource): ResourceEmailChange | null {
  const from = (before.email ?? "").trim();
  const to = (after.email ?? "").trim();
  if (from === "" || from === to) return null;
  return { resourceId: after.id, from, to };
}

function retarget<T>(
  rows: readonly T[],
  change: ResourceEmailChange,
  linked: (row: T) => boolean,
  email: (row: T) => string | undefined,
  withEmail: (row: T, value: string) => T,
): ArrayPropagation<T> {
  const edited: T[] = [];
  const next = rows.map((row) => {
    if (!linked(row) || fold(email(row)) !== fold(change.from)) return row;
    edited.push(row);
    return withEmail(row, change.to);
  });
  return edited.length === 0 ? { next: rows, edited } : { next, edited };
}

export function retargetTaskEmails(rows: readonly Task[], change: ResourceEmailChange): ArrayPropagation<Task> {
  return retarget(rows, change, (r) => r.resourceId === change.resourceId && !r.jiraKey, (r) => r.assigneeEmail, (r, v) => ({ ...r, assigneeEmail: v }));
}

export function retargetRaidEmails(rows: readonly RaidItem[], change: ResourceEmailChange): ArrayPropagation<RaidItem> {
  return retarget(rows, change, (r) => r.ownerResourceId === change.resourceId, (r) => r.ownerEmail, (r, v) => ({ ...r, ownerEmail: v }));
}

export function retargetAbsenceEmails(rows: readonly Absence[], change: ResourceEmailChange): ArrayPropagation<Absence> {
  return retarget(rows, change, (r) => r.resourceId === change.resourceId, (r) => r.assigneeEmail, (r, v) => ({ ...r, assigneeEmail: v }));
}

export function retargetShiftEmails(rows: readonly Shift[], change: ResourceEmailChange): ArrayPropagation<Shift> {
  return retarget(rows, change, (r) => r.resourceId === change.resourceId, (r) => r.assigneeEmail, (r, v) => ({ ...r, assigneeEmail: v }));
}

export function retargetStakeholderEmails(rows: readonly Stakeholder[], change: ResourceEmailChange): ArrayPropagation<Stakeholder> {
  return retarget(rows, change, (r) => r.resourceId === change.resourceId, (r) => r.email, (r, v) => ({ ...r, email: v }));
}

export function retargetContactPersonEmails(rows: readonly ContactPerson[], change: ResourceEmailChange): { next: readonly ContactPerson[]; changed: number } {
  const out = retarget(rows, change, (r) => r.resourceId === change.resourceId, (r) => r.email, (r, v) => ({ ...r, email: v }));
  return { next: out.next, changed: out.edited.length };
}

export function propagateResourceEmail(change: ResourceEmailChange, input: EmailPropagationInput): EmailPropagationResult {
  const tasks = retargetTaskEmails(input.tasks, change);
  const raid = retargetRaidEmails(input.raid, change);
  const absences = retargetAbsenceEmails(input.absences, change);
  const shifts = retargetShiftEmails(input.shifts, change);
  const stakeholders = retargetStakeholderEmails(input.stakeholders, change);
  const contactPersons = retargetContactPersonEmails(input.contactPersons, change);
  const count = tasks.edited.length + raid.edited.length + absences.edited.length
    + shifts.edited.length + stakeholders.edited.length + contactPersons.changed;
  return { tasks, raid, absences, shifts, stakeholders, contactPersons, count };
}
```

(If `Absence`, `Shift` or `ContactPerson` types name the FK other than `resourceId`, tsc reports it; fix to the real field and correct this plan in the same commit.) Rerun; Expected EXIT=0.

- [ ] **Step 3: Undo toast text override**

Add to `src/app/undo/use-undo-stack.test.tsx` (inside `describe("useUndoStack")`):

```ts
  it("captureComposite uses toastText in place of the generic edit text when given", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    act(() => {
      result.current.captureComposite({
        kind: "resource.updated", primaryCount: 1, toastText: "Edited 1 item and updated 3 linked record(s)",
        parts: [capturePart({ setter: vi.fn(), edited: [{ id: 1, name: "a" }], fromArray: [{ id: 1, name: "a" }], isPrimary: true })],
      });
    });
    expect(deps.showToastAction).toHaveBeenCalledWith("info", "Edited 1 item and updated 3 linked record(s)", expect.objectContaining({ labelKey: "undo" }));
  });
```

Run it; Expected EXIT=1. Code in `use-undo-stack.ts`: add to `CaptureCompositeOpts`

```ts
  /** Replaces the generic "Edited N item(s)" Undo toast text for THIS entry
   *  (spec Part 7: a resource save that also corrected linked copies names the
   *  count). The label and the activity log are unaffected. */
  toastText?: string;
```

`pushEntry` gains a last parameter `toastText?: string`, and its text line becomes
`const text = toastText ?? t(lang, isDelete ? "undoToastDelete" : "undoToastEdit", primaryCount);`. In `captureComposite` pass it: `pushEntry(opts.kind, opts.primaryCount, compositeUndoRunner(fragments, armDestructive), { name: opts.name, entityKey: opts.entityKey }, opts.toastText);`. Rerun; Expected EXIT=0.

- [ ] **Step 4: i18n key**

`src/app/i18n.ts` after `  undoToastEdit: "Edited {0} item(s)",` add `  undoToastResourceEmailPropagated: "Edited 1 item and updated {0} linked record(s)",`. DE via `$LOG/de-t6.cjs`:

```js
const fs = require("fs");
const P = "src/app/i18n.de.ts";
const s = fs.readFileSync(P, "utf8");
const anchor = "  undoToastEdit: \"{0} Element(e) bearbeitet\",\r\n";
const count = s.split(anchor).length - 1;
if (count !== 1) { console.error("anchor count " + count); process.exit(1); }
const add = "  undoToastResourceEmailPropagated: \"1 Element bearbeitet und {0} verkn\u00fcpfte Eintr\u00e4ge aktualisiert\",\r\n";
fs.writeFileSync(P, s.replace(anchor, anchor + add), "utf8");
console.log("ok");
```
Run `node "$LOG/de-t6.cjs"; echo "EXIT=$?"`. Then write `$LOG/de-check-t6.cjs` with the Write tool and run `node "$LOG/de-check-t6.cjs"; echo "EXIT=$?"` — Expected `ok`, `EXIT=0`; anything else is a STOP:

```js
const fs = require("fs");
const s = fs.readFileSync("src/app/i18n.de.ts", "utf8");
const expected = "  undoToastEdit: \"{0} Element(e) bearbeitet\",\r\n"
  + "  undoToastResourceEmailPropagated: \"1 Element bearbeitet und {0} verkn\u00fcpfte Eintr\u00e4ge aktualisiert\",\r\n";
const problems = [];
const bareLf = (s.match(/(?<!\r)\n/g) || []).length;
if (bareLf !== 0) problems.push("bareLF " + bareLf);
if (s.includes("\ufffd")) problems.push("U+FFFD replacement character present");
const hits = s.split(expected).length - 1;
if (hits !== 1) problems.push("expected bytes found " + hits + " time(s)");
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("ok");
```

- [ ] **Step 5: Commit helper**

Create `src/app/resource-email-propagation-commit.ts`:

```ts
// Applies a computed propagation through FUNCTIONAL workspace setters and
// returns the undo fragments for it (spec Part 7). Shared by the human and AI
// resource writers so the two cannot drift. Each setter re-runs the pure
// retarget over `prev`, so a same-tick write to another row survives.
import type { useWorkspace } from "./workspace-context";
import type { ContactPerson } from "./types";
import { capturePart, type CompositeFragment } from "./undo/use-undo-stack";
import {
  retargetAbsenceEmails, retargetContactPersonEmails, retargetRaidEmails, retargetShiftEmails,
  retargetStakeholderEmails, retargetTaskEmails,
  type EmailPropagationInput, type EmailPropagationResult, type ResourceEmailChange,
} from "./resource-email-propagation";

export type PropagationSetters = Pick<ReturnType<typeof useWorkspace>, "setTasks" | "setRaid" | "setAbsences" | "setShifts" | "setStakeholders" | "setProject">;

/** ★ A WHOLE-ARRAY before/after fragment, because `ContactPerson` has no id
 *  and `capturePart` requires one (controller ruling). Unarmed: a plain edit
 *  removes no rows, exactly like `captureFieldPart`. */
export function contactPersonsFragment(
  setProject: PropagationSetters["setProject"],
  before: readonly ContactPerson[],
  after: readonly ContactPerson[],
): CompositeFragment {
  return {
    isPrimary: false,
    restore: () => {
      setProject((prev) => (prev ? { ...prev, contactPersons: [...before] } : prev));
      return () => setProject((prev) => (prev ? { ...prev, contactPersons: [...after] } : prev));
    },
  };
}

export function commitEmailPropagation(args: {
  change: ResourceEmailChange;
  input: EmailPropagationInput;
  result: EmailPropagationResult;
  setters: PropagationSetters;
}): (CompositeFragment | null)[] {
  const { change, input, result, setters } = args;
  if (result.tasks.edited.length > 0) setters.setTasks((prev) => retargetTaskEmails(prev, change).next as typeof prev);
  if (result.raid.edited.length > 0) setters.setRaid((prev) => retargetRaidEmails(prev, change).next as typeof prev);
  if (result.absences.edited.length > 0) setters.setAbsences((prev) => retargetAbsenceEmails(prev, change).next as typeof prev);
  if (result.shifts.edited.length > 0) setters.setShifts((prev) => retargetShiftEmails(prev, change).next as typeof prev);
  if (result.stakeholders.edited.length > 0) setters.setStakeholders((prev) => retargetStakeholderEmails(prev, change).next as typeof prev);
  if (result.contactPersons.changed > 0) {
    setters.setProject((prev) => (prev ? { ...prev, contactPersons: [...retargetContactPersonEmails(prev.contactPersons, change).next] } : prev));
  }
  return [
    capturePart({ setter: setters.setTasks, edited: result.tasks.edited, fromArray: input.tasks }),
    capturePart({ setter: setters.setRaid, edited: result.raid.edited, fromArray: input.raid }),
    capturePart({ setter: setters.setAbsences, edited: result.absences.edited, fromArray: input.absences }),
    capturePart({ setter: setters.setShifts, edited: result.shifts.edited, fromArray: input.shifts }),
    capturePart({ setter: setters.setStakeholders, edited: result.stakeholders.edited, fromArray: input.stakeholders }),
    result.contactPersons.changed > 0 ? contactPersonsFragment(setters.setProject, input.contactPersons, result.contactPersons.next) : null,
  ];
}
```

(`capturePart` returns null for an empty `edited`, which `captureComposite` ignores. If a `capturePart` `setter` type rejects a workspace setter, tsc names the mismatch; cast the setter the way `use-resource-directory.ts` already passes `setAbsences` to `capturePart`.)

- [ ] **Step 6: Human writer — failing hook test, then code**

Create `src/app/use-resource-directory.email-propagation.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useResourceDirectory } from "./use-resource-directory";
import { useUndoStack } from "./undo/use-undo-stack";
import { t } from "./i18n";
import type { Resource, Task } from "./types";

const wrapper = ({ children }: { children: ReactNode }) => (
  <FiltersProvider><WorkspaceProvider>{children}</WorkspaceProvider></FiltersProvider>
);

const ada: Resource = { id: 7, firstName: "Ada", lastName: "L", email: "old@x.com", roleId: null, utilizationMode: "percent", utilization: {} };
const linkedTask = { id: 1, taskName: "T", assignee: "Ada L", assigneeEmail: "old@x.com", resourceId: 7, dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do" } as Task;

function renderDirectory() {
  const showToastAction = vi.fn();
  const logUpdate = vi.fn();
  const { result } = renderHook(() => {
    const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction });
    const directory = useResourceDirectory({
      lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(),
      captureComposite: undo.captureComposite, captureFieldEdit: undo.captureFieldEdit, logUpdate,
    });
    return { undo, directory, ws: useWorkspace() };
  }, { wrapper });
  act(() => {
    result.current.ws.setResources([ada]);
    result.current.ws.setTasks([linkedTask]);
    result.current.ws.setProject({ name: "P", contactPersons: [{ name: "Ada L", email: "old@x.com", synced: true, resourceId: 7 }] } as never);
  });
  return { result, showToastAction, logUpdate };
}

describe("handleSaveResource propagates a corrected email (spec Part 7)", () => {
  it("updates linked copies as ONE undo entry, names the count, and logs one resource.updated", () => {
    const { result, showToastAction, logUpdate } = renderDirectory();
    act(() => { result.current.directory.handleEditResource(ada); });
    act(() => { result.current.directory.handleSaveResource({ ...ada, email: "new@x.com" }); });
    expect(result.current.ws.tasks[0].assigneeEmail).toBe("new@x.com");
    expect(result.current.ws.project?.contactPersons[0].email).toBe("new@x.com");
    expect(result.current.undo.stack).toHaveLength(1);
    expect(showToastAction).toHaveBeenLastCalledWith("info", t("en-US", "undoToastResourceEmailPropagated", 2), expect.anything());
    expect(logUpdate).toHaveBeenCalledTimes(1);
    expect(logUpdate).toHaveBeenCalledWith("resource.updated", expect.anything(), expect.anything(), 7, "Ada L");

    act(() => { result.current.undo.undo(); });
    expect(result.current.ws.resources[0].email).toBe("old@x.com");
    expect(result.current.ws.tasks[0].assigneeEmail).toBe("old@x.com");
    expect(result.current.ws.project?.contactPersons[0].email).toBe("old@x.com");
  });

  it("keeps the plain edit toast when nothing propagates", () => {
    const { result, showToastAction } = renderDirectory();
    act(() => { result.current.directory.handleEditResource(ada); });
    act(() => { result.current.directory.handleSaveResource({ ...ada, title: "Lead" }); });
    expect(showToastAction).toHaveBeenLastCalledWith("info", t("en-US", "undoToastEdit", 1), expect.anything());
  });
});
```

Run; Expected EXIT=1. Code in `src/app/use-resource-directory.ts`:
- `import { type Lang, t } from "./i18n";`; `import { propagateResourceEmail, resourceEmailChange } from "./resource-email-propagation";`; `import { commitEmailPropagation } from "./resource-email-propagation-commit";`.
- Extend the `useWorkspace()` destructure: `const { resources, setResources, absences, setAbsences, shifts, setShifts, tasks, setTasks, raid, setRaid, stakeholders, setStakeholders, project, setProject } = useWorkspace();`
- In the update branch of `handleSaveResource`, replace from `const withStamp` through the `captureFieldChanges(…);` call with:

```ts
        const withStamp: Resource = { ...next, localModifiedAt: stamp };
        setResources((prev) => prev.map((r) => (r.id === next.id ? withStamp : r)));
        setEditingResource(null);
        // Spec Part 7 — a corrected primary email reaches its FK-linked copies,
        // as ONE undo entry with the resource. Otherwise the capture is unchanged.
        const emailChange = resourceEmailChange(previous, withStamp);
        const propagationInput = { tasks, raid, absences, shifts, stakeholders, contactPersons: project?.contactPersons ?? [] };
        const propagation = emailChange ? propagateResourceEmail(emailChange, propagationInput) : null;
        if (emailChange && propagation && propagation.count > 0) {
          const cascade = commitEmailPropagation({ change: emailChange, input: propagationInput, result: propagation, setters: { setTasks, setRaid, setAbsences, setShifts, setStakeholders, setProject } });
          captureCompositeRef.current?.({
            kind: "resource.updated", primaryCount: 1, name, entityKey: "resource",
            toastText: t(langRef.current, "undoToastResourceEmailPropagated", propagation.count),
            parts: [capturePart({ setter: setResources, edited: [previous], fromArray: resources, isPrimary: true }), ...cascade],
          });
        } else {
          captureFieldChanges(captureFieldEditRef.current, {
            setter: setResources, kind: "resource.updated", id: next.id,
            prev: previous, next: withStamp, groups: RESOURCE_UNDO_GROUPS,
            stampField: "localModifiedAt", name,
          });
        }
```
- The `useCallback` deps become `[resources, setResources, logUpdate, editingResource, tasks, raid, absences, shifts, stakeholders, project, setTasks, setRaid, setAbsences, setShifts, setStakeholders, setProject]`.

Rerun the new file plus `use-resource-planner.test.tsx` and `use-resource-planner.undo.test.tsx`; Expected EXIT=0, `Test Files 3 passed (3)`.

- [ ] **Step 7: AI writer + parity + token test**

`src/app/test-providers.tsx`: add to `TestSeed` `shifts?: Shift[];` and `project?: ProjectMeta;` (import both types), to the `Seeder` destructure `setShifts, setProject`, and in the effect `if (seed.shifts?.length) setShifts(seed.shifts);` and `if (seed.project) setProject(seed.project);`.

Create `src/app/resource-email-propagation.parity.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { TestProviders, type TestSeed } from "./test-providers";
import { resetMintState } from "./id-mint-session";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useResourceDirectory } from "./use-resource-directory";
import { useWorkspace } from "./workspace-context";
import { entityToken } from "./ai-entity-token";
import type { Resource, Task } from "./types";

const ada: Resource = { id: 7, firstName: "Ada", lastName: "L", email: "old@x.com", roleId: null, utilizationMode: "percent", utilization: {} };
const seed: TestSeed = {
  resources: [ada],
  tasks: [
    { id: 1, taskName: "Linked", assignee: "Ada L", assigneeEmail: "OLD@x.com ", resourceId: 7, dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do" } as Task,
    { id: 2, taskName: "Jira", assignee: "Ada L", assigneeEmail: "old@x.com", resourceId: 7, jiraKey: "LOP-1", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do" } as Task,
  ],
  raid: [{ id: 1, category: "R", title: "Risk", ownerResourceId: 7, ownerEmail: "old@x.com", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-06-01" } as never],
  stakeholders: [{ id: 1, name: "Ada L", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "old@x.com", resourceId: 7 } as never],
  absences: [{ id: 1, assignee: "Ada L", assigneeEmail: "old@x.com", resourceId: 7, startDate: "2026-06-01", endDate: "2026-06-02", type: "vacation" } as never],
  shifts: [{ id: 1, assignee: "Ada L", assigneeEmail: "old@x.com", resourceId: 7, hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] } as never],
  project: { name: "P", contactPersons: [{ name: "Ada L", email: "old@x.com", synced: true, resourceId: 7 }] } as never,
};

function snapshot(ws: ReturnType<typeof useWorkspace>) {
  const strip = <T extends object>(rows: readonly T[]) => rows.map(({ localModifiedAt: _stamp, ...rest }: T & { localModifiedAt?: string }) => rest);
  return {
    tasks: strip(ws.tasks), raid: strip(ws.raid), absences: strip(ws.absences), shifts: strip(ws.shifts),
    stakeholders: strip(ws.stakeholders), contactPersons: ws.project?.contactPersons,
  };
}

beforeEach(() => resetMintState());

describe("human and AI resource writers propagate identically (spec Part 7 parity)", () => {
  it("produces identical linked arrays for the same before/after resource", () => {
    const human = renderHook(() => ({
      directory: useResourceDirectory({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), captureComposite: vi.fn(), captureFieldEdit: vi.fn(), logUpdate: vi.fn() }),
      ws: useWorkspace(),
    }), { wrapper: ({ children }: { children: ReactNode }) => <TestProviders seed={seed}>{children}</TestProviders> });
    act(() => { human.result.current.directory.handleEditResource(ada); });
    act(() => { human.result.current.directory.handleSaveResource({ ...ada, email: "new@x.com" }); });

    const ai = renderHook(() => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }), { wrapper: dispatcherWrapperWith(seed) });
    act(() => { ai.result.current.d.updateResource(7, { email: "new@x.com" }); });

    expect(snapshot(ai.result.current.ws)).toEqual(snapshot(human.result.current.ws));
    expect(ai.result.current.ws.tasks.find((r) => r.id === 1)?.assigneeEmail).toBe("new@x.com");
    expect(ai.result.current.ws.tasks.find((r) => r.id === 2)?.assigneeEmail).toBe("old@x.com");
  });

  it("invalidates an outstanding update token on every touched TokenEntity row", () => {
    const ai = renderHook(() => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }), { wrapper: dispatcherWrapperWith(seed) });
    const before = {
      task: entityToken("task", ai.result.current.ws.tasks[0]),
      raid: entityToken("raid", ai.result.current.ws.raid[0]),
      stakeholder: entityToken("stakeholder", ai.result.current.ws.stakeholders[0]),
      absence: entityToken("absence", ai.result.current.ws.absences[0]),
    };
    act(() => { ai.result.current.d.updateResource(7, { email: "new@x.com" }); });
    expect(entityToken("task", ai.result.current.ws.tasks[0])).not.toBe(before.task);
    expect(entityToken("raid", ai.result.current.ws.raid[0])).not.toBe(before.raid);
    expect(entityToken("stakeholder", ai.result.current.ws.stakeholders[0])).not.toBe(before.stakeholder);
    expect(entityToken("absence", ai.result.current.ws.absences[0])).not.toBe(before.absence);
  });
});
```

(If `makeDispatcherArgs` requires arguments, read its signature in `src/test/chat-dispatcher-fixture.tsx` and pass what `emails-write-parity.test.ts` passes. The destructuring-rename `_stamp` may trip `no-unused-vars` — lint is fatal; if so, replace `strip` with `rows.map((r) => { const copy = { ...r } as Record<string, unknown>; delete copy.localModifiedAt; return copy; })`.)

Run; Expected EXIT=1 (AI path does not propagate yet).

Code in `src/app/use-chat-dispatcher.ts`:
- imports: `propagateResourceEmail, resourceEmailChange` and `commitEmailPropagation`.
- `useWorkspace()` destructure gains `raid, setRaid, absences, setAbsences, shifts, setShifts, stakeholders, setStakeholders, project, setProject`.
- beside the other refs:
```ts
  // Spec Part 7 — the linked slices `updateResource` propagates into, read at
  // call time so the dispatcher's identity does not move on every register edit.
  const linkedRef = useRef({ raid, absences, shifts, stakeholders, project });
  useEffect(() => { linkedRef.current = { raid, absences, shifts, stakeholders, project }; }, [raid, absences, shifts, stakeholders, project]);
```
(If the file syncs its other refs without an effect, e.g. assigning during render, follow that file's existing pattern instead — read how `tasksRef` is kept current.)
- in `updateResource`, replace the `undoRef.current?.captureComposite({ … });` call with:
```ts
        // Spec Part 7 — after the popout throw and the token check in
        // `chat-tools.ts`, a corrected primary email reaches FK-linked copies,
        // through the same helpers `handleSaveResource` uses.
        // ★ KNOWN LIMIT: `use-register-tools.ts` keeps its own RAID/stakeholder/
        //  absence refs, refreshed by effect; a register write later in the SAME
        //  model turn reads the pre-propagation row and can overwrite the copy.
        const emailChange = resourceEmailChange(existing, merged);
        const linked = linkedRef.current;
        const propagationInput = { tasks: tasksRef.current, raid: linked.raid, absences: linked.absences, shifts: linked.shifts, stakeholders: linked.stakeholders, contactPersons: linked.project?.contactPersons ?? [] };
        const propagation = emailChange ? propagateResourceEmail(emailChange, propagationInput) : null;
        const cascade = emailChange && propagation && propagation.count > 0
          ? commitEmailPropagation({ change: emailChange, input: propagationInput, result: propagation, setters: { setTasks, setRaid, setAbsences, setShifts, setStakeholders, setProject } })
          : [];
        if (propagation && propagation.count > 0) tasksRef.current = propagation.tasks.next as Task[];
        undoRef.current?.captureComposite({
          kind: "resource.updated",
          primaryCount: 1,
          parts: [capturePart({
            setter: setResources,
            edited: [existing],
            fromArray: resourcesRef.current,
            isPrimary: true,
          }), ...cascade],
          name: resourceLogName(existing),
          entityKey: "resource",
          toastText: propagation && propagation.count > 0 ? t(settingsRef.current.language, "undoToastResourceEmailPropagated", propagation.count) : undefined,
        });
```
(`tasksRef.current` type: match its declared element type instead of `Task[]` if tsc disagrees.) Add the new setters to the dispatcher `useMemo` dependency array.

Rerun the parity file, `use-chat-dispatcher.test.tsx`, `use-chat-dispatcher.undo.test.tsx`, `chat-tools.test.ts`; Expected EXIT=0, `Test Files 4 passed (4)`.

- [ ] **Step 8: Mutation check and gates**

Mutation: in `retarget`, change `fold(email(row)) !== fold(change.from)` to `email(row) !== change.from`; the unit test "trimmed and case-insensitively" and the parity test must go red; revert; `git diff --stat` unchanged.

Run all Task 6 test files in one invocation (count asserted), `npx tsc --noEmit`, eslint over touched files, size:check, and re-run the Outlook grep from the census (must print nothing).

- [ ] **Step 9: Commit**

Subject `feat: carry a corrected person email to its linked copies`.

The paths, enumerated from the Files block (pre-flight M12):

```bash
T6_PATHS="src/app/resource-email-propagation.ts src/app/resource-email-propagation-commit.ts src/app/undo/use-undo-stack.ts src/app/use-resource-directory.ts src/app/use-chat-dispatcher.ts src/app/test-providers.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/resource-email-propagation.test.ts src/app/use-resource-directory.email-propagation.test.tsx src/app/resource-email-propagation.parity.test.tsx src/app/undo/use-undo-stack.test.tsx"
git status --porcelain=v1 --untracked-files=all
```

Every modified or untracked path in the status output must be in `$T6_PATHS`; any other is a STOP.

```bash
git add $T6_PATHS && git commit --only $T6_PATHS -F "$LOG/msg-t6.txt"; echo "EXIT=$?"
```

---

### Task 7: §90 — no resource creation from a popout

**Files:**
- Modify: `src/app/workspace-section-types.ts`, `src/app/raid-panel.tsx`, `src/app/raid-edit-modal.tsx`, `src/app/app-modals.tsx`, `src/app/task-form-modal.tsx`, `src/app/task-form-fields.tsx`, `src/app/shift-edit-modal.tsx` (`onCreateResource` becomes optional)
- Modify: `src/app/app-modals.tsx`, `src/app/task-form-modal.tsx`, `src/app/task-form-fields.tsx` (`onAddAssigneeToAddressBook` becomes optional; `TaskFormFields` does not render the "+" button when it is absent — an omission of an existing control, not a new one); `src/app/app-modals.tsx` (`ResourceEditModal` renders only when `!isPopout`)
- Modify: `src/app/task-manager.tsx` (three single-token edits, no new lines)
- Test: `src/app/task-manager.popout-guard.test.tsx`, `src/app/app-modals.test.tsx`, `src/app/task-form-fields.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `onCreateResource?: (name: string, email: string) => number` on the seven prop types above. `raid-create-host.tsx`, `escalate-popover.tsx` and `action-cta-controls.tsx` stay REQUIRED (main-window only; fed from `use-action-center-handlers.ts` / the `!isPopout` mount, not from the bag). `onAddAssigneeToAddressBook?: (name: string, email: string) => void` on `AppModalsProps`, `TaskFormModal`'s props and `TaskFormFields`' props.

**Reachability (Ruling Q8, corrected by pre-flight C1 — spec correction 7):** `TaskFormModal` (via unguarded `setTaskModalOpen`) and `RaidEditModal` (`"raid"` in `POPOUT_TABS`) are reachable in a popout; `ShiftEditModal` (`guardEdit(handleOpenShiftEditor)`) is not. The resource editor IS reachable: the task form's "+" add-to-address-book button calls `onAddAssigneeToAddressBook` → `handleAddAssigneeToAddressBook` → `handleOpenAddResource`, and `AppModals` then renders `ResourceEditModal`, whose save (`handleSaveResourceFromAnywhere` → `handleSaveResource`) creates the resource. Every resource-creation UI route and what closes it in a popout:

| Route | Popout state after this task |
|---|---|
| `ResourcePicker` "+ Add" row → `onCreateResource` (bag, `AppModals` → `TaskFormModal` / `ShiftEditModal`) | closed here: `isPopout ? undefined : handleCreateResource` at both mounts; the picker hides the row |
| task form "+" button → `onAddAssigneeToAddressBook` → `handleOpenAddResource` → `ResourceEditModal` | closed here: `isPopout ? undefined : handleAddAssigneeToAddressBook`; the button is not rendered |
| any future opener of `editingResource` | closed here: `AppModals` renders `ResourceEditModal` only when `!isPopout` |
| Resources view → `onAddResource` / `onEditResource` | already `guardEdit`-wrapped in the bag |
| `RaidCreateHost` → `onCreateResource` | mounted under `!isPopout` |
| Action Center assign / escalate → `onCreateResource` | `use-action-center-handlers.ts` checks `isPopout`; the Action Center is not in `POPOUT_TABS` |
| Outlook contacts import → `onImportOutlook` | `canImportOutlookContacts({ isPopout, … })` plus `guardEdit` |
| AI chat `createResource` | the dispatcher's own `isReadOnly` throw (not a UI route) |

Re-derive the table before editing: `git grep -n "handleOpenAddResource\|handleCreateResource\|onAddAssigneeToAddressBook\|setEditingResource\|onImportOutlook" -- src ':!*.test.*'`. A route not in the table is a STOP.

**Test census (run first; label every hit):**

```bash
git grep -n "onCreateResource\|onAddAssigneeToAddressBook\|taskAddAssigneeToAddressBook\|editingResource" -- src e2e scripts
```

- ADD popout and main-window cases to `task-manager.popout-guard.test.tsx`; MIGRATE its header paragraph that calls `onCreateResource` "still unguarded".
- MIGRATE `task-manager.popout-guard.test.tsx`'s mock shape (pre-flight C2): the new `AppModals` capture RENDERS THROUGH to the real component, so the toast region (`{toast && <div role="status">` inside `app-modals.tsx`) stays real for Task 8. The file's existing budget cases assert on captured `WorkspaceSection` props and `commitSpy`, which a render-through mock does not change.
- ADD `app-modals.test.tsx`: `ResourceEditModal` renders in the main window and not in a popout.
- ADD `task-form-fields.test.tsx`: the "+" button renders when `onAddAssigneeToAddressBook` is passed (positive control) and not when it is absent. Its `Harness` gains a `withAddressBook?: boolean` option.
- Unaffected (optional is a superset; each passes a function, so the button still renders): `action-hero-card.test.tsx`, `action-row.test.tsx`, `escalate-popover.test.tsx`, `raid-create-host*.test.tsx`, `raid-edit-modal.test.tsx`, `raid-panel.test.tsx`, `resource-picker.test.tsx` (already pins "omits the + Add row entirely when onCreateResource is not provided"), `shift-edit-*.test.tsx`, `task-form-feedback.test.tsx`, `task-form-fields.dictation.test.tsx`, `task-form-fields.resource-picker.test.tsx`, `task-form-modal.test.tsx` (its "fires onAddAssigneeToAddressBook with the current assignee + email" case passes a spy), `workspace-section*.test.tsx`.
- For every NON-test hit in `workspace-section.tsx`, confirm the value flows only into one of the seven now-optional types. If any flows into a REQUIRED `onCreateResource` (`escalate-popover.tsx`, `action-cta-controls.tsx`, `raid-create-host.tsx`), STOP and ask — do not widen those.

- [ ] **Step 1: Failing test**

In `src/app/task-manager.popout-guard.test.tsx`, below the `WorkspaceSection` mock, add a capture of `AppModals` (a named export, `export function AppModals`). ★ It RENDERS THROUGH to the real component (pre-flight C2): the toast region with the Undo action lives inside `AppModals`, and Task 8's seam test must observe the real one. A mock returning `null` would make Task 8's positive control unreachable.

```tsx
const capturedModals: { props: Record<string, unknown> | null } = { props: null };
vi.mock("./app-modals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./app-modals")>();
  const RealAppModals = actual.AppModals;
  return {
    ...actual,
    AppModals: (props: Parameters<typeof RealAppModals>[0]) => {
      capturedModals.props = props as unknown as Record<string, unknown>;
      return <RealAppModals {...props} />;
    },
  };
});
```

In `mountAt`, add `capturedModals.props = null;`. Append:

```tsx
const ADA = { id: 1, firstName: "Ada", lastName: "L", roleId: null, utilizationMode: "percent", utilization: {} };

describe("popout read-only guard — resource creation (open-followups §90)", () => {
  // ★ Positive controls first: every route below is proven LIVE in the main
  //  window by the same call on the same mount path, so each popout absence
  //  assertion is not vacuous.
  it("main window: passes onCreateResource and onAddAssigneeToAddressBook", async () => {
    await mountAt("/");
    expect(typeof captured.props!.onCreateResource).toBe("function");
    expect(typeof capturedModals.props!.onCreateResource).toBe("function");
    expect(typeof capturedModals.props!.onAddAssigneeToAddressBook).toBe("function");
  }, 45000);

  it("popout: passes NO onCreateResource and NO onAddAssigneeToAddressBook", async () => {
    await mountAt("/?popout=raid");
    // ★ Unlike onChangeBudgets, the props DISAPPEAR: `makeEditGuard` would
    // widen `number` to `number | undefined`, ResourcePicker already hides its
    // "+ Add" row when the callback is absent, and TaskFormFields now hides the
    // "+" address-book button the same way.
    expect(captured.props!.onCreateResource).toBeUndefined();
    expect(capturedModals.props!.onCreateResource).toBeUndefined();
    expect(capturedModals.props!.onAddAssigneeToAddressBook).toBeUndefined();
  }, 45000);

  it("main window: the address-book route opens a NEW-resource editor (positive control for route b)", async () => {
    await mountAt("/");
    const addToBook = capturedModals.props!.onAddAssigneeToAddressBook as (name: string, email: string) => void;
    act(() => addToBook("Ada Lovelace", "ada@x.com"));
    expect(capturedModals.props!.editingResource).toMatchObject({ isNew: true });
  }, 45000);

  it("main window: onEditResource opens the resource editor (positive control for the Part 7 pin)", async () => {
    await mountAt("/");
    const onEditResource = captured.props!.onEditResource as (r: unknown) => void;
    act(() => onEditResource(ADA));
    expect(capturedModals.props!.editingResource).toMatchObject({ isNew: false });
  }, 45000);

  it("popout: onEditResource opens no resource editor (spec Part 7 popout pin)", async () => {
    await mountAt("/?popout=resources");
    const onEditResource = captured.props!.onEditResource as (r: unknown) => void;
    act(() => onEditResource(ADA));
    expect(capturedModals.props!.editingResource ?? null).toBeNull();
  }, 45000);
});
```

Add to `src/app/app-modals.test.tsx`, inside `describe("AppModals", …)` (its `ResourceEditModal` is already mocked to `data-testid="resource-edit-modal"`):

```tsx
  it("renders ResourceEditModal in the main window and never in a popout (open-followups §90)", () => {
    stubTaskForm();
    const editing = { resource: { id: 1, firstName: "Ada", lastName: "L", roleId: null, utilizationMode: "percent", utilization: {} } as never, isNew: true };
    const { rerender } = render(<AppModals {...makeProps()} isPopout={false} editingResource={editing} />);
    expect(screen.getByTestId("resource-edit-modal")).toBeInTheDocument(); // positive control
    rerender(<AppModals {...makeProps()} isPopout={true} editingResource={editing} />);
    expect(screen.queryByTestId("resource-edit-modal")).toBeNull();
  });
```

In `src/app/task-form-fields.test.tsx`, widen `Harness`'s `over` type with `withAddressBook?: boolean` and change its `onAddAssigneeToAddressBook={vi.fn()}` line to `onAddAssigneeToAddressBook={over.withAddressBook === false ? undefined : vi.fn()}`. Append:

```tsx
describe("TaskFormFields — add-to-address-book button (open-followups §90)", () => {
  it("renders the button when onAddAssigneeToAddressBook is passed (positive control)", () => {
    render(<Harness />, { wrapper: TestProviders });
    expect(screen.getByRole("button", { name: t("en-US", "taskAddAssigneeToAddressBook") })).toBeInTheDocument();
  });

  it("renders no button when it is absent (a popout)", () => {
    render(<Harness withAddressBook={false} />, { wrapper: TestProviders });
    expect(screen.queryByRole("button", { name: t("en-US", "taskAddAssigneeToAddressBook") })).toBeNull();
  });
});
```

Run: `npx vitest run src/app/task-manager.popout-guard.test.tsx src/app/app-modals.test.tsx src/app/task-form-fields.test.tsx --maxWorkers=1 --reporter=dot > "$LOG/t7.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG/t7.log"` — Expected EXIT=1. The three positive controls (both main-window route cases and the `onEditResource` main-window case), the Part 7 popout pin (existing behaviour, green before any code change) and the task-form-fields positive control pass. The popout-props case, the `app-modals` popout gate and the "renders no button" case fail. If a positive control fails, STOP — the absence assertions beside it prove nothing.

- [ ] **Step 2: Code**

In each of the seven files change `onCreateResource: (name: string, email: string) => number;` to `onCreateResource?: (name: string, email: string) => number;`. Where a file CALLS it directly rather than forwarding to `ResourcePicker` (tsc reports "possibly undefined"), forward it untouched to the picker; if a direct call exists, STOP and ask.

`src/app/app-modals.tsx`, `src/app/task-form-modal.tsx`, `src/app/task-form-fields.tsx`: change `onAddAssigneeToAddressBook: (name: string, email: string) => void;` to `onAddAssigneeToAddressBook?: (name: string, email: string) => void;` (one prop-type line in each file; `AppModals` and `TaskFormModal` only forward it).

`src/app/task-form-fields.tsx`: wrap the existing address-book `<button type="button" onClick={() => onAddAssigneeToAddressBook(form.assignee, form.assigneeEmail)} … >+</button>` in `{onAddAssigneeToAddressBook && ( … )}`, leaving the button's markup unchanged. This omits an existing control, exactly as `ResourcePicker` omits its "+ Add" row; it adds no new UI.

`src/app/app-modals.tsx`: `{editingResource && (` (the `ResourceEditModal` mount) → `{editingResource && !isPopout && (`. `isPopout` is already a required `AppModalsProps` field that this component destructures for its footer.

`src/app/task-manager.tsx` (measure 3257 before and after):
- `    onCreateResource: handleCreateResource,` → `    onCreateResource: isPopout ? undefined : handleCreateResource,`
- `        onCreateResource={handleCreateResource}` inside `<AppModals` (8-space indent) → `        onCreateResource={isPopout ? undefined : handleCreateResource}`. The `<RaidCreateHost` mount's prop (10-space indent) stays unchanged (mounted under `!isPopout`).
- `        onAddAssigneeToAddressBook={handleAddAssigneeToAddressBook}` → `        onAddAssigneeToAddressBook={isPopout ? undefined : handleAddAssigneeToAddressBook}`. Exactly one occurrence at HEAD: `node -e "const s=require('fs').readFileSync('src/app/task-manager.tsx','utf8');console.log(s.split('        onAddAssigneeToAddressBook={handleAddAssigneeToAddressBook}\r\n').length-1)"` prints `1`.

Replace the header paragraph that begins `// ★★★ \`onChangeBudgets\` IS SAFE TO WRAP ONLY BECAUSE` so its last three sentences read: `// That is why it is NOT wrapped: task-manager passes \`isPopout ? undefined :\` // handleCreateResource\` instead, and \`ResourcePicker\` hides its "+ Add" row // when the callback is absent. A SECOND route reached the resource editor from // a popout — the task form's "+" address-book button — and is closed the same // way, with \`AppModals\` refusing to render \`ResourceEditModal\` in a popout at // all (open-followups §90, every route pinned below).`

- [ ] **Step 3: Run, gates, commit**

Rerun the three test files plus `task-form-modal.test.tsx` in one invocation (EXIT=0, `Test Files 4 passed (4)`), then `npx tsc --noEmit`, eslint over the eight source files and the three edited tests, `node -e` size of `task-manager.tsx` (3257).

Subject `fix: a popout can no longer create a resource (§90)`.

```bash
T7_PATHS="src/app/workspace-section-types.ts src/app/raid-panel.tsx src/app/raid-edit-modal.tsx src/app/app-modals.tsx src/app/task-form-modal.tsx src/app/task-form-fields.tsx src/app/shift-edit-modal.tsx src/app/task-manager.tsx src/app/task-manager.popout-guard.test.tsx src/app/app-modals.test.tsx src/app/task-form-fields.test.tsx"
git add $T7_PATHS && git commit --only $T7_PATHS -F "$LOG/msg-t7.txt"; echo "EXIT=$?"
```

---

### Task 8: §91 — the undo stack is read-only in a popout

**Files:**
- Modify: `src/app/undo/use-undo-stack.ts` (`UseUndoStackDeps.isReadOnly`, gates in `pushEntry`, `undo`, `redo`, `undoById`, `undoThrough`, `redoThrough`)
- Modify: `src/app/task-manager.tsx` (line-neutral ref + dep)
- Test: `src/app/undo/use-undo-stack.test.tsx`, `src/app/task-manager.popout-guard.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `UseUndoStackDeps.isReadOnly?: () => boolean` — read lazily through `depsRef` at every call.

**Test census:**

```bash
git grep -n "useUndoStack(\|useUndoHotkey\|undoThrough\|redoThrough" -- src e2e scripts
```

- ADD read-only cases to `undo/use-undo-stack.test.tsx`; ADD a popout seam case to `task-manager.popout-guard.test.tsx`; MIGRATE its "★★ A THIRD unguarded path" paragraph (its "invisible affordance" claim was wrong — the Undo toast is visible).
- Unaffected: every other `useUndoStack(` caller (the dep is optional), `use-undo-hotkey.test.ts`, the `undoThrough` describe (no `isReadOnly` passed).
- Verify, don't assume: list every `captureComposite` site the chat dispatcher reaches (`git grep -n "captureComposite" -- src/app/use-chat-dispatcher.ts src/app/use-register-tools.ts src/app/use-document-tools.ts`) and confirm each sits after an `isReadOnly` throw; record the count in the commit body. The stack gate covers them either way.

- [ ] **Step 1: Failing unit tests**

Append to `src/app/undo/use-undo-stack.test.tsx`:

```tsx
describe("useUndoStack — read-only (open-followups §91)", () => {
  const rows: readonly Row[] = [{ id: 1, name: "a" }];

  function seededStack(readOnly: { current: boolean }) {
    const deps = makeDeps({ isReadOnly: () => readOnly.current });
    const setter = vi.fn();
    const { result } = renderHook(() => useUndoStack(deps));
    return { deps, setter, result };
  }

  it("positive control: captures push and toast when not read-only", () => {
    const flag = { current: false };
    const { deps, setter, result } = seededStack(flag);
    act(() => { result.current.capture({ setter, kind: "task.deleted", removed: [rows[0]], fromArray: rows }); });
    expect(result.current.stack).toHaveLength(1);
    expect(deps.showToastAction).toHaveBeenCalledTimes(1);
  });

  it("every capture pushes nothing and shows no toast while read-only", () => {
    const flag = { current: true };
    const { deps, setter, result } = seededStack(flag);
    act(() => {
      result.current.capture({ setter, kind: "task.deleted", removed: [rows[0]], fromArray: rows });
      result.current.captureFieldEdit({ setter, kind: "task.updated", id: 1, before: { name: "a" }, after: { name: "b" } });
      result.current.captureComposite({ kind: "task.updated", primaryCount: 1, parts: [capturePart({ setter, edited: [rows[0]], fromArray: rows, isPrimary: true })] });
      result.current.captureFieldRows({ setter, kind: "bulk.edit", edits: [{ id: 1, before: { name: "a" }, after: { name: "b" } }] });
    });
    expect(result.current.stack).toHaveLength(0);
    expect(deps.showToastAction).not.toHaveBeenCalled();
  });

  it("the five restore entry points run nothing and log nothing while read-only", () => {
    const flag = { current: false };
    const { deps, setter, result } = seededStack(flag);
    act(() => { result.current.capture({ setter, kind: "task.deleted", removed: [rows[0]], fromArray: rows }); });
    act(() => { result.current.capture({ setter, kind: "task.deleted", removed: [rows[0]], fromArray: rows }); });
    act(() => { result.current.undo(); }); // one entry on the redo stack
    setter.mockClear();
    deps.logActivity.mockClear();
    flag.current = true;
    const topId = result.current.stack[0].id;
    const redoId = result.current.redoStack[0].id;
    act(() => {
      result.current.undo();
      result.current.redo();
      result.current.undoById(topId);
      result.current.undoThrough(topId);
      result.current.redoThrough(redoId);
    });
    expect(setter).not.toHaveBeenCalled();
    expect(deps.logActivity).not.toHaveBeenCalled();
    expect(result.current.stack).toHaveLength(1);
    expect(result.current.redoStack).toHaveLength(1);
  });
});
```

(If `captureFieldRows`' `edits` item shape differs, tsc names it; use the shape `CaptureFieldRowsOpts` declares.) Run; Expected EXIT=1.

- [ ] **Step 2: Hook code**

In `UseUndoStackDeps` add:

```ts
  /** True while this window may not mutate (a popout, §91). Read LAZILY
   *  through `depsRef` at call time: captures push nothing and toast nothing,
   *  and every restore entry point returns without running a runner or logging. */
  isReadOnly?: () => boolean;
```

Add as the FIRST statement of `undoById`, `undo`, `undoThrough`, `redoThrough`, `redo` and `pushEntry`:

```ts
    if (depsRef.current.isReadOnly?.()) return;
```

- [ ] **Step 3: task-manager wiring (line-neutral) and seam test**

`src/app/task-manager.tsx` (3257 before and after):
- line `  const allowDestructiveSaveRef = useRef<(() => void) | undefined>(undefined);` → `  const allowDestructiveSaveRef = useRef<(() => void) | undefined>(undefined); const isPopoutRef = useRef(false);`
- line `  const undoApi = useUndoStack({ lang, logActivity: logActivityUser, showToast, showToastAction, allowDestructiveSave: armDestructiveForUndo });` → `  const undoApi = useUndoStack({ lang, logActivity: logActivityUser, showToast, showToastAction, allowDestructiveSave: armDestructiveForUndo, isReadOnly: readOnlyForUndo });`
- line `  const armDestructiveForUndo = useCallback(() => { allowDestructiveSaveRef.current?.(); }, []);` → `  const armDestructiveForUndo = useCallback(() => { allowDestructiveSaveRef.current?.(); }, []); const readOnlyForUndo = useCallback(() => isPopoutRef.current, []);`
- line `  useEffect(() => { allowDestructiveSaveRef.current = allowDestructiveSave; }, [allowDestructiveSave]);` → `  useEffect(() => { allowDestructiveSaveRef.current = allowDestructiveSave; isPopoutRef.current = isPopout; }, [allowDestructiveSave, isPopout]);`

(If eslint rejects two statements on one line, STOP and ask — do not add lines to `task-manager.tsx`.)

Append to `src/app/task-manager.popout-guard.test.tsx`:

Add `within` to the file's `@testing-library/react` import and `import { t } from "./i18n";` (if missing), then append:

```tsx
describe("popout read-only guard — undo capture (open-followups §91)", () => {
  const capture = () => (captured.props!.onCaptureUndo as (o: unknown) => void)({
    setter: vi.fn(), kind: "task.deleted", removed: [{ id: 1 }], fromArray: [{ id: 1 }],
  });
  // ★★ Assert on the TOAST, never on a bare "Undo" button: the main window also
  //  renders the header undo control (`undoControlEl`), so a page-wide
  //  `getByRole("button", { name: "Undo" })` could pass with no toast at all.
  //  The toast is the REAL one — `app-modals.tsx` renders `{toast && <div
  //  role="status">…}` with the action button, and Task 7's AppModals capture
  //  renders through (pre-flight C2). `task.deleted` is a delete kind, so the
  //  text is `undoToastDelete`.
  const toastText = () => t("en-US", "undoToastDelete", 1);

  it("main window: a capture shows the Undo toast (positive control)", async () => {
    await mountAt("/");
    act(() => capture());
    const text = await screen.findByText(toastText());
    const region = text.closest('[role="status"]') as HTMLElement | null;
    expect(region).not.toBeNull();
    expect(within(region!).getByRole("button", { name: /undo/i })).toBeInTheDocument();
  }, 45000);

  it("popout: a capture records nothing and shows no Undo toast", async () => {
    await mountAt("/?popout=raid");
    act(() => capture());
    expect(screen.queryByText(toastText())).toBeNull();
  }, 45000);
});
```

Before running, confirm the render-through mock is in place: `grep -n "return <RealAppModals" src/app/task-manager.popout-guard.test.tsx` must print one line. If it prints nothing, or the positive control still fails, STOP and report — never assert the popout case alone, because a lone absence assertion is vacuous.

Rewrite the "★★ A THIRD unguarded path" header paragraph: `// ★★ The undo stack itself is now read-only in a popout (§91): \`useUndoStack\` // takes \`isReadOnly\`, so a popout capture pushes nothing and shows no Undo toast, // and Ctrl+Z / undoThrough / redoThrough run nothing. Pinned below. (An earlier // revision called the affordance invisible; the Undo toast was visible.)`

- [ ] **Step 4: Run, gates, commit**

Run `undo/use-undo-stack.test.tsx` and `task-manager.popout-guard.test.tsx` (`Test Files 2 passed (2)`), tsc, eslint, size readings.

Subject `fix: the undo stack records and restores nothing in a popout (§91)`.

```bash
git add src/app/undo/use-undo-stack.ts src/app/undo/use-undo-stack.test.tsx src/app/task-manager.tsx src/app/task-manager.popout-guard.test.tsx
git commit --only src/app/undo/use-undo-stack.ts src/app/undo/use-undo-stack.test.tsx src/app/task-manager.tsx src/app/task-manager.popout-guard.test.tsx -F "$LOG/msg-t8.txt"; echo "EXIT=$?"
```

---

### Task 9: §204 — a project hard delete sweeps every project-scoped side table

**Files:**
- Create: `src/app/project-side-tables.ts`
- Modify: `src/app/turso-portfolio.ts` (`hardDeleteProject`)
- Modify: `src/app/document-assets-store.ts` (delete `deleteAllAssetDataForProject`), `src/app/document-assets-schema.ts` (delete `assetDataDeleteAllForProject`)
- Modify: `src/app/scheduled-jobs-store.ts` (export `SCHEDULED_JOBS_DDL`), `src/app/color-schemes-store.ts` (rename `DDL` → exported `COLOR_SCHEMES_DDL`)
- Modify: `src/app/workspace-panels.tsx` (comment naming the deleted helper), `docs/AGENTS/documents.md` (paragraph naming it and §204)
- Create: `src/app/turso-side-tables.guard.test.ts`, `src/app/turso-portfolio.execute.test.ts`
- Test (MIGRATE/DELETE): `src/app/turso-portfolio.test.ts`, `src/app/document-assets-store.test.ts`, `src/app/chat-tool-block.test.tsx`, `src/app/documents-panel.test.tsx`

**Interfaces:**
- Produces:
  - `interface ProjectSideTable { table: string; ddl: readonly string[] }`
  - `PROJECT_SCOPED_SIDE_TABLES: readonly ProjectSideTable[]` — `chat_threads`, `committee_report_versions`, `document_asset_data`, `snapshot`, `snapshot_series`, `project_versions`
  - `projectSideTableSweepStatements(projectId: string): SqlStmt[]` — every entry's DDL (deduplicated) then one `DELETE FROM <table> WHERE project_id = ?` per entry

**Test census:**

```bash
git grep -n "deleteAllAssetDataForProject\|assetDataDeleteAllForProject\|hardDeleteProject\|projectAssetCleanupFailed\|SCHEDULED_JOBS_DDL" -- src e2e scripts docs/AGENTS AGENTS.md
```

- MIGRATE `turso-portfolio.test.ts`: the three hard-delete tests keep their assertions (`DELETE FROM projects WHERE id = ?` in the first call, `DELETE FROM document_asset_data WHERE project_id = ?` with `[{ type: "text", value: "p1" }]` somewhere, `toHaveBeenCalledTimes(2)` on failure — the sweep is ONE pipeline); their comments naming `deleteAllAssetDataForProject` are rewritten; ADD one test that the second call deletes every registered table.
- DELETE the `deleteAllAssetDataForProject` test in `document-assets-store.test.ts` (and its import name).
- MIGRATE `chat-tool-block.test.tsx` and `documents-panel.test.tsx`: drop the `deleteAllAssetDataForProject` key from their `vi.mock` factories.
- Unaffected: `turso-tenant-schema.test.ts`, `use-storage-backend.test.tsx`, `use-storage-turso-ops.test.ts`, `task-manager.portfolio-mode.test.tsx` (they mock `hardDeleteProject`). `e2e/version-history-documents.spec.ts` names `hardDeleteProjectStatements` in a comment that stays true.
- Doc hits in `docs/AGENTS/documents.md` are swept in this task (Step 5), because `docs:symbols:check` fails on the deleted name.

- [ ] **Step 1: Failing guard + execute tests**

Create `src/app/turso-side-tables.guard.test.ts`:

```ts
// ★★★ open-followups §204 guard (Ruling Q6). Executes EVERY schema DDL the
// repo declares in node:sqlite, reads each table's columns, and fails on a table
// with a `project_id` column that is neither a TABLE_NAMES member (swept by the
// tenant transaction) nor in PROJECT_SCOPED_SIDE_TABLES (swept after it).
// DISCOVERED, not hardcoded: every `export const <NAME>_DDL` in src/app is
// imported, and a file whose CODE holds a quoted CREATE TABLE literal without
// exporting one must be on the allowlist below with a reason. ★ Comments are
// stripped before that check (pre-flight I2): seven files mention CREATE TABLE
// only in comments, and allowlisting them would hide a real table added to one
// of them later.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { TABLE_NAMES } from "./turso-schema";
import { tenantSchemaDdl } from "./turso-tenant-schema";
import { PROJECT_SCOPED_SIDE_TABLES } from "./project-side-tables";

const APP = resolve(__dirname);
// Real DDL only, each with a reason. Never add a comment-only file here.
const NO_EXPORTED_DDL_ALLOWLIST: Record<string, string> = {
  "turso-tenant-schema.ts": "DDL is the tenantSchemaDdl() function, executed explicitly below",
  "turso-backend.ts": "OLD_BLOB_DDL: the legacy single-row `workspace` blob table, no project_id",
};
const EXPORT_RE = /export const ([A-Z0-9_]+_DDL)\b/g;
export const DDL_LITERAL_RE = /[`"']\s*CREATE TABLE/;
/** Drops block comments and line comments (a `//` at line start or after
 *  whitespace; a `://` inside a URL is kept). */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

async function discoverDdl(): Promise<{ statements: string[]; sources: string[] }> {
  const statements = [...tenantSchemaDdl()];
  const sources: string[] = [];
  for (const file of readdirSync(APP).filter((f) => f.endsWith(".ts") && !f.includes(".test."))) {
    const text = readFileSync(join(APP, file), "utf8");
    const names = [...text.matchAll(EXPORT_RE)].map((m) => m[1]);
    if (names.length === 0) {
      if (DDL_LITERAL_RE.test(stripComments(text))) expect(NO_EXPORTED_DDL_ALLOWLIST[file], `${file} creates a table without an exported *_DDL`).toBeDefined();
      continue;
    }
    const mod = (await import(pathToFileURL(join(APP, file)).href)) as Record<string, unknown>;
    for (const name of names) {
      sources.push(`${file}:${name}`);
      statements.push(...(mod[name] as string[]));
    }
  }
  return { statements, sources };
}

describe("project-scoped side tables (open-followups §204)", () => {
  it("the discovery ignores comment mentions and sees a quoted DDL literal", () => {
    expect(DDL_LITERAL_RE.test(stripComments("// SCHEMA_DDL uses `CREATE TABLE IF NOT EXISTS`\n/* CREATE TABLE x */\n"))).toBe(false);
    expect(DDL_LITERAL_RE.test(stripComments('const X = ["CREATE TABLE IF NOT EXISTS t (id TEXT)"];\n'))).toBe(true);
  });

  it("every table with a project_id column is swept by a project hard delete", async () => {
    const { statements, sources } = await discoverDdl();
    const db = new DatabaseSync(":memory:");
    for (const sql of statements) db.exec(sql);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    const scoped = tables.filter((name) =>
      (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).some((c) => c.name === "project_id"));
    const registered = new Set([...TABLE_NAMES, ...PROJECT_SCOPED_SIDE_TABLES.map((e) => e.table)]);
    expect(scoped.filter((name) => !registered.has(name))).toEqual([]);
    // Anti-vacuity floors: the discovery saw real DDL, and the registry is live.
    expect(sources.length).toBeGreaterThanOrEqual(10);
    expect(tables.length).toBeGreaterThanOrEqual(TABLE_NAMES.length + PROJECT_SCOPED_SIDE_TABLES.length);
    for (const entry of PROJECT_SCOPED_SIDE_TABLES) expect(scoped, entry.table).toContain(entry.table);
  });
});
```

(Allowlist census, measured at plan-fix time by stripping comments exactly as `stripComments` does: `comm-templates-store.ts`, `document-assets-store.ts`, `learning-store-turso.ts`, `snapshot-store.ts`, `turso-migrate.ts`, `use-portfolio-health.ts` and `version-store.ts` mention CREATE TABLE only in comments, so none needs an entry. `color-schemes-store.ts` and `scheduled-jobs-store.ts` hold real DDL and export it from Step 3 on. Before Step 3 those two fail the guard for the right reason. Count the exported `*_DDL` constants first with `git grep -c "export const [A-Z0-9_]*_DDL" -- "src/app/*.ts"` after Step 3's two exports — the floor must be ≤ that number and is quoted with that command in the commit body. `node:sqlite` import handling: copy whatever `turso-schema.execute.test.ts` does around its `DatabaseSync` import, e.g. an experimental-warning note.)

Create `src/app/turso-portfolio.execute.test.ts`:

```ts
// open-followups §204 — runs the REAL hard-delete statements (tenant transaction
// + the side-table sweep) against node:sqlite. Rows are inserted generically
// from PRAGMA columns: the subject is the DELETE, not each store's insert.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { tenantSchemaDdl, hardDeleteProjectStatements } from "./turso-tenant-schema";
import { PROJECT_SCOPED_SIDE_TABLES, projectSideTableSweepStatements } from "./project-side-tables";
import type { SqlStmt } from "./turso-schema";

function run(db: DatabaseSync, statements: readonly SqlStmt[]): void {
  for (const s of statements) {
    if (!s.args || s.args.length === 0) { db.exec(s.sql); continue; }
    db.prepare(s.sql).run(...s.args.map((a) => a.value ?? null));
  }
}

function insertFor(db: DatabaseSync, table: string, projectId: string, n: number): void {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const values = cols.map((c) => (c === "project_id" ? projectId : `${projectId}-${n}`));
  db.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...values);
}

const count = (db: DatabaseSync, table: string, projectId: string): number =>
  Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`).get(projectId) as { n: number | bigint }).n);

describe("hardDeleteProject statements against a real engine (open-followups §204)", () => {
  it("empties every registered side table for p1 and leaves p2 untouched", () => {
    const db = new DatabaseSync(":memory:");
    run(db, tenantSchemaDdl().map((sql) => ({ sql })));
    run(db, projectSideTableSweepStatements("setup-only").filter((s) => !s.sql.startsWith("DELETE")));
    for (const { table } of PROJECT_SCOPED_SIDE_TABLES) {
      insertFor(db, table, "p1", 1);
      insertFor(db, table, "p2", 2);
    }
    run(db, hardDeleteProjectStatements("p1"));
    run(db, projectSideTableSweepStatements("p1"));
    for (const { table } of PROJECT_SCOPED_SIDE_TABLES) {
      expect(count(db, table, "p1"), table).toBe(0);
      expect(count(db, table, "p2"), table).toBe(1);
    }
  });
});
```

(A column typed INTEGER that rejects the generic text value: give `insertFor` a numeric fallback for columns whose PRAGMA `type` contains `INT` — read the PRAGMA `type` field.)

Run both; Expected EXIT=1 (module missing).

- [ ] **Step 2: Registry**

Create `src/app/project-side-tables.ts`:

```ts
// open-followups §204 — the side tables that carry a `project_id` but are
// deliberately OUTSIDE TABLE_NAMES (a workspace save's per-table DELETE sweep
// would otherwise wipe them), so the tenant hard-delete transaction never
// reaches them. `hardDeleteProject` sweeps these in ONE separate, non-fatal
// pipeline. `turso-side-tables.guard.test.ts` fails on any project-keyed table
// missing from both lists.
import { CHAT_THREADS_DDL } from "./chat-threads-schema";
import { MEETING_REPORT_VERSION_DDL } from "./committee-report-versions-schema";
import { DOCUMENT_ASSET_DATA_DDL } from "./document-assets-schema";
import { SNAPSHOT_DDL } from "./snapshot-schema";
import { VERSION_DDL } from "./version-schema";
import { txt, type SqlStmt } from "./turso-schema";

export interface ProjectSideTable { table: string; ddl: readonly string[] }

export const PROJECT_SCOPED_SIDE_TABLES: readonly ProjectSideTable[] = [
  { table: "chat_threads", ddl: CHAT_THREADS_DDL },
  { table: "committee_report_versions", ddl: MEETING_REPORT_VERSION_DDL },
  { table: "document_asset_data", ddl: DOCUMENT_ASSET_DATA_DDL },
  { table: "snapshot", ddl: SNAPSHOT_DDL },
  { table: "snapshot_series", ddl: SNAPSHOT_DDL },
  { table: "project_versions", ddl: VERSION_DDL },
];

/** Create-if-missing DDL for every entry (so a never-used side table does not
 *  fail the DELETE), then one project-scoped DELETE per entry. */
export function projectSideTableSweepStatements(projectId: string): SqlStmt[] {
  const seen = new Set<string>();
  const out: SqlStmt[] = [];
  for (const { ddl } of PROJECT_SCOPED_SIDE_TABLES) {
    for (const sql of ddl) {
      if (seen.has(sql)) continue;
      seen.add(sql);
      out.push({ sql });
    }
  }
  for (const { table } of PROJECT_SCOPED_SIDE_TABLES) {
    out.push({ sql: `DELETE FROM ${table} WHERE project_id = ?`, args: [txt(projectId)] });
  }
  return out;
}
```

- [ ] **Step 3: Wire it; export the store-local DDL; delete the special case**

`src/app/turso-portfolio.ts`: replace `import { deleteAllAssetDataForProject } from "./document-assets-store";` with `import { projectSideTableSweepStatements } from "./project-side-tables";` and the body of `hardDeleteProject` after the first `await` with:

```ts
  // open-followups §204 — every project-scoped side table lives OUTSIDE
  // TABLE_NAMES (a workspace save's per-table DELETE would wipe it), so the
  // transaction above never reaches them. ONE separate, non-fatal pipeline:
  // leaked rows are recoverable, a half-deleted project is not. ★ A libSQL
  // pipeline does not abort on a failing statement, so a sweep can be partial;
  // it is logged and re-runnable.
  try {
    await runTursoPipeline(config, projectSideTableSweepStatements(id));
  } catch (err) {
    logDiag("warn", "storage.projectAssetCleanupFailed", { id, message: err instanceof Error ? err.message : String(err) });
  }
```

Delete `deleteAllAssetDataForProject` (and its docstring) from `document-assets-store.ts`, remove `assetDataDeleteAllForProject` from that file's import, and delete `export const assetDataDeleteAllForProject …` from `document-assets-schema.ts`. Re-run the census grep: only docs/comments may remain.

`scheduled-jobs-store.ts`: `const SCHEDULED_JOBS_DDL: string[] = [` → `export const SCHEDULED_JOBS_DDL: string[] = [`.
`color-schemes-store.ts`: `const DDL: string[] = [` → `export const COLOR_SCHEMES_DDL: string[] = [` and `DDL.map` → `COLOR_SCHEMES_DDL.map`.

- [ ] **Step 4: Migrate the existing tests**

`turso-portfolio.test.ts`: rewrite the two comments that name `deleteAllAssetDataForProject` to name "the side-table sweep" (`projectSideTableSweepStatements`); add:

```ts
  it("hardDeleteProject sweeps every project-scoped side table in ONE second pipeline (§204)", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([]);
    await hardDeleteProject(cfg, "p1");
    const calls = vi.mocked(runTursoPipeline).mock.calls;
    expect(calls).toHaveLength(2);
    const sweep = calls[1][1].filter((s) => s.sql.startsWith("DELETE"));
    expect(sweep.map((s) => s.sql)).toEqual(PROJECT_SCOPED_SIDE_TABLES.map((e) => `DELETE FROM ${e.table} WHERE project_id = ?`));
    for (const s of sweep) expect(s.args).toEqual([{ type: "text", value: "p1" }]);
  });
```
(import `PROJECT_SCOPED_SIDE_TABLES` from `./project-side-tables`).

`document-assets-store.test.ts`: delete the `it(...)` that calls `deleteAllAssetDataForProject(config, "p1")` and remove the name from the import. `chat-tool-block.test.tsx`, `documents-panel.test.tsx`: delete the line `  deleteAllAssetDataForProject: vi.fn(async () => {}),`.

- [ ] **Step 5: Sweep prose the change falsifies**

`src/app/workspace-panels.tsx`: the comment line `// \`deleteAllAssetDataForProject\` is keyed the same way, so those orphans would` → `// the project hard-delete sweep (\`projectSideTableSweepStatements\`) is keyed the same way, so those orphans would`.

`docs/AGENTS/documents.md`: in the paragraph beginning `★★★ **\`document_asset_data\` is deliberately OUTSIDE \`TABLE_NAMES\`**`, replace the sentences from `Consequence: nothing cleans it automatically` through `way (§204).` with:

`Consequence: nothing cleans it automatically on ordinary project use, so \`hardDeleteProject\` (\`turso-portfolio.ts\`) sweeps it — together with every other project-keyed side table (\`chat_threads\`, \`committee_report_versions\`, \`snapshot\`, \`snapshot_series\`, \`project_versions\`) — through \`PROJECT_SCOPED_SIDE_TABLES\` (\`project-side-tables.ts\`) in one separate pipeline, **non-fatally**, via \`logDiag\`, because leaked rows are recoverable and a half-deleted project is not. \`turso-side-tables.guard.test.ts\` fails on a new project-keyed table missing from that registry (§204).`

Also replace `the \`hardDeleteProject\` cleanup above` later in the file only if it still reads true (it does — leave it).

`docs/AGENTS/documents.md` names the helper a SECOND time (pre-flight I3), in the Safe Mode paragraph that begins `★★★ **THE ASSET LIBRARY REFUSES TO OPERATE IN SAFE MODE RATHER THAN RE-PARTITIONING BYTES.**`. At HEAD the sentence wraps across two LF lines:

```
`deleteAllAssetDataForProject` is keyed the same way, so those orphans then survived project
deletion too.
```

Replace those two lines with:

```
The project hard-delete sweep (`projectSideTableSweepStatements`) is keyed the same way, so those
orphans then survived project deletion too.
```

(The claim stays true: bytes written under a Safe Mode key are orphans the sweep cannot reach by the project's own id.) Then:

```bash
git grep -n "deleteAllAssetDataForProject" -- src docs/AGENTS AGENTS.md e2e scripts
npm run docs:symbols:check > "$LOG/sym.log" 2>&1; echo "EXIT=$?"
npm run docs:claims:check > "$LOG/claims.log" 2>&1; echo "EXIT=$?"
```
Expected: the grep prints nothing; both gates EXIT=0.

- [ ] **Step 6: Run, gates, commit**

Run `turso-side-tables.guard.test.ts`, `turso-portfolio.execute.test.ts`, `turso-portfolio.test.ts`, `document-assets-store.test.ts`, `chat-tool-block.test.tsx`, `documents-panel.test.tsx`, `turso-schema.execute.test.ts` (`Test Files 7 passed (7)`). Mutation: remove the `project_versions` entry from the registry, confirm the guard test goes red, restore, `git diff --stat` unchanged. Then tsc, eslint over touched files.

Subject `fix: a project hard delete sweeps every project-scoped side table (§204)`.

```bash
git add src/app/project-side-tables.ts src/app/turso-portfolio.ts src/app/document-assets-store.ts src/app/document-assets-schema.ts src/app/scheduled-jobs-store.ts src/app/color-schemes-store.ts src/app/workspace-panels.tsx docs/AGENTS/documents.md src/app/turso-side-tables.guard.test.ts src/app/turso-portfolio.execute.test.ts src/app/turso-portfolio.test.ts src/app/document-assets-store.test.ts src/app/chat-tool-block.test.tsx src/app/documents-panel.test.tsx
git commit --only src/app/project-side-tables.ts src/app/turso-portfolio.ts src/app/document-assets-store.ts src/app/document-assets-schema.ts src/app/scheduled-jobs-store.ts src/app/color-schemes-store.ts src/app/workspace-panels.tsx docs/AGENTS/documents.md src/app/turso-side-tables.guard.test.ts src/app/turso-portfolio.execute.test.ts src/app/turso-portfolio.test.ts src/app/document-assets-store.test.ts src/app/chat-tool-block.test.tsx src/app/documents-panel.test.tsx -F "$LOG/msg-t9.txt"; echo "EXIT=$?"
```

---

### Task 10: §539 — `sanitizeIsoDate` rejects non-calendar dates

**Scope addition approved by the user 2026-09-14.** Register entry §539 (work item #329) is already filed on this branch (`6e8c397e`, `f5a8f445`); this task only fixes it. Task 11 closes it.

**Ruling:** reject a non-calendar date EVERYWHERE the function is used, load paths included, by returning `""` (its existing invalid result). Validate month 1..12 and the day against the real month length, leap years included, through a `Date.UTC` round trip. The 1900..2100 year bound stays.

**Why dropping on load is acceptable (record in the closure):** such a value is already unusable. An `<input type="date">` blanks an invalid value under the HTML value-sanitization algorithm. V8 `new Date("2026-02-30")` silently rolls over to 2026-03-02 and `"2026-04-31"` to 2026-05-01, so a DAY overflow MOVES the date in date math with no error, while `"2026-13-01"` and `"2026-00-10"` give Invalid Date, so a MONTH overflow yields NaN. The Gantt's own `parseISO` (`gantt-engine.ts`, which wraps `new Date`; date-fns is not installed) returns null for a month overflow — the milestone gets a row but draws nothing — and draws `"2026-02-30"` on 2026-03-02. Related consumer, not a dependency: the peer's §273 branch (`fix/ui-residuals-batch`) drops undrawable Gantt milestones and does not edit `sanitize-core.ts`.

**Files:**
- Modify: `src/app/sanitize-core.ts` (`sanitizeIsoDate`)
- Modify (docstrings the fix falsifies): `src/app/inline-ai-edit/entity-descriptor.ts` (`acceptsDate` docstring, calendarEvent `acceptsDate` comment), `src/app/inline-ai-edit/plan.ts` (`defaultAcceptsDate` docstring, the "Match the sanitizer EXACTLY" comment), `src/app/calendar-event.ts` (`acceptsEventDate` docstring)
- Create: `src/app/sanitize-core.iso-date.test.ts`
- Test (MIGRATE/RECOMPUTE): `src/app/sanitize.property.test.ts`, `src/app/sanitize.test.ts`, `src/app/inline-ai-edit/plan.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `sanitizeIsoDate(s: unknown): string` — same signature; now `""` for a shape-valid string that is not a real calendar date.

**Test census (113 references in 30 files at HEAD: `git grep -c sanitizeIsoDate -- src`). Run and label every hit:**

```bash
git grep -n "sanitizeIsoDate\|defaultAcceptsDate" -- src e2e scripts
git grep -nE "\"(19|20|21)[0-9]{2}-(00|1[3-9])-[0-9]{2}|\"(19|20|21)[0-9]{2}-[0-9]{2}-(00|3[2-9])|-02-(29|30|31)\"|-(04|06|09|11)-31\"" -- src e2e scripts
```

Labels already determined from HEAD:
- ADD `src/app/sanitize-core.iso-date.test.ts` (below).
- MIGRATE `sanitize.property.test.ts` "sanitizeIsoDate returns '' or a valid in-range date, and is idempotent": its generator builds dates from `fc.date`, so every generated date is real and it stays green as written — strengthen the invariant (a non-empty output is a real calendar date by `Date.UTC` round trip) and add a generator arm for shape-valid non-calendar strings.
- MIGRATE `sanitize.test.ts` `describe("sanitizeIsoDate")`: add the calendar cases beside the year-bound cases (they stay).
- RECOMPUTE `inline-ai-edit/plan.test.ts` "keeps absence free of the calendar check its own writer lacks": its premise ("`sanitizeIsoDate` … has no `Date.parse` leg, so an impossible day IS stored") becomes false. `sanitizeAbsence` now refuses `"2026-01-32"`, so parity means the card REJECTS it. Rewrite the case to assert `plan.updates` is `[]` and `plan.rejected[0].detail` is `"startDate=2026-01-32"`, retitled "rejects an impossible day, as its own writer now does (§539)". The sibling "keeps absence on the year bound its own writer applies" stays unchanged.
- Must stay green unchanged (verified premises): `calendar-event.test.ts` (`acceptsEventDate` / `isoDateOrUndefined` are a separate predicate), `calendar-recurrence-text.test.ts`, `action-rebaseline.test.ts` (`isValidIsoDate`), `gantt-engine.property.test.ts`, `outlook-contacts.test.ts` (`parseGraphBirthday`), `src/test/sweep-probes.test.ts`, `calendar-window.test.ts` (real leap dates).
- Review each remaining non-test caller for a fixture or seed that relies on an impossible date surviving: `templates.ts`, `jira-api.ts` (`dueDate`/`lastUpdateDate` from Jira are real ISO dates — no change expected), `ai-project-proposal.ts`, `bulk-operations-helpers.ts`, `chat-task-patch.ts`, `project-validation.ts`, `task-inline-patch.ts`, `task-validation.ts`, `use-gantt-handlers.ts`, `use-register-tools.ts`, `use-task-submit.ts`, `use-chat-dispatcher.ts`, `sanitize-entities.ts`, `sanitize-records.ts`, `src/test/offered-surface-axis.ts`. The second grep prints every literal non-calendar date in the repo at HEAD; none of them reaches `sanitizeIsoDate` except the plan.test.ts absence case above. Re-run it after the change and re-confirm.
- Also run the test files that reference the function in a date-bearing path: `sanitize-records.test.ts`, `sanitize-change-patch.test.ts`, `sanitize-milestone-patch.test.ts`, `sanitize-raid-patch.test.ts`, `chat-task-patch.test.ts`, `inline-ai-edit/plan.sanitizer-parity.test.ts`, `inline-ai-edit/plan.write-path.test.ts`, `calendar-event.test.ts`.
- `golden-workspace.test.ts` must stay green with no regeneration (sample dates are real).

- [ ] **Step 1: Failing tests**

Create `src/app/sanitize-core.iso-date.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeIsoDate } from "./sanitize";

describe("sanitizeIsoDate rejects non-calendar dates (open-followups §539)", () => {
  it.each(["2026-00-10", "2026-13-01"])("rejects month %s", (value) => {
    expect(sanitizeIsoDate(value)).toBe("");
  });

  it.each(["2026-01-00", "2026-01-32"])("rejects day %s", (value) => {
    expect(sanitizeIsoDate(value)).toBe("");
  });

  it("accepts Feb 29 only in a leap year", () => {
    expect(sanitizeIsoDate("2024-02-29")).toBe("2024-02-29");
    expect(sanitizeIsoDate("2000-02-29")).toBe("2000-02-29"); // divisible by 400
    expect(sanitizeIsoDate("2025-02-29")).toBe("");
    expect(sanitizeIsoDate("2100-02-29")).toBe(""); // divisible by 100, not 400
  });

  it.each(["2026-02-30", "2026-04-31", "2026-06-31", "2026-09-31", "2026-11-31"])("rejects %s, which date math silently rolls over", (value) => {
    expect(sanitizeIsoDate(value)).toBe("");
  });

  it("accepts the last real day of every month", () => {
    for (const value of ["2026-01-31", "2026-03-31", "2026-04-30", "2026-12-31"]) expect(sanitizeIsoDate(value)).toBe(value);
  });

  it("still enforces the year bounds and the shape", () => {
    expect(sanitizeIsoDate("1899-12-31")).toBe("");
    expect(sanitizeIsoDate("1900-01-01")).toBe("1900-01-01");
    expect(sanitizeIsoDate("2100-12-31")).toBe("2100-12-31");
    expect(sanitizeIsoDate("2101-01-01")).toBe("");
    expect(sanitizeIsoDate("2026-1-01")).toBe("");
    expect(sanitizeIsoDate(20260101)).toBe("");
  });
});
```

In `src/app/sanitize.test.ts`, inside `describe("sanitizeIsoDate", …)` add:

```ts
  test("rejects shape-valid strings that are not calendar dates (§539)", () => {
    expect(sanitizeIsoDate("2026-13-01")).toBe("");
    expect(sanitizeIsoDate("2026-02-30")).toBe("");
    expect(sanitizeIsoDate("2024-02-29")).toBe("2024-02-29");
  });
```

In `src/app/sanitize.property.test.ts`, replace the whole `test("sanitizeIsoDate returns '' or a valid in-range date, and is idempotent", …)` with:

```ts
  test("sanitizeIsoDate returns '' or a REAL in-range calendar date, and is idempotent (§539)", () => {
    const pad = (n: number, w: number) => String(n).padStart(w, "0");
    const mixed = fc.oneof(
      fc.string(),
      fc
        .date({ min: new Date("1850-01-01"), max: new Date("2150-12-31"), noInvalidDate: true })
        .map((d) => d.toISOString().slice(0, 10)),
      // ★ Shape-valid but frequently NON-calendar (month 00–19, day 00–39):
      //  the arm the fc.date generator above can never produce.
      fc
        .tuple(fc.integer({ min: 1890, max: 2110 }), fc.integer({ min: 0, max: 19 }), fc.integer({ min: 0, max: 39 }))
        .map(([y, m, d]) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`),
    );
    fc.assert(
      fc.property(mixed, (s) => {
        const out = sanitizeIsoDate(s);
        if (out !== "") {
          expect(/^\d{4}-\d{2}-\d{2}$/.test(out)).toBe(true);
          const [year, month, day] = out.split("-").map(Number);
          expect(year).toBeGreaterThanOrEqual(1900);
          expect(year).toBeLessThanOrEqual(2100);
          const utc = new Date(Date.UTC(year, month - 1, day));
          expect([utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate()]).toEqual([year, month, day]);
        }
        expect(sanitizeIsoDate(out)).toBe(out); // idempotent
      }),
    );
  });
```

Recompute the `plan.test.ts` absence case as labelled above:

```ts
  it("rejects an impossible day, as its own writer now does (§539)", () => {
    // `sanitizeAbsence` calls `sanitizeIsoDate`, which since §539 refuses a
    // non-calendar date — so parity now means the card rejects it too.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_absence", input: { id: 50, startDate: "2026-01-32" } }],
      { descriptor: INLINE_DESCRIPTORS.absence, item: holiday as never, ws: calWs },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.rejected[0].detail).toBe("startDate=2026-01-32");
  });
```

Run: `npx vitest run src/app/sanitize-core.iso-date.test.ts src/app/sanitize.test.ts src/app/sanitize.property.test.ts src/app/inline-ai-edit/plan.test.ts --maxWorkers=1 --reporter=dot > "$LOG/t10.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG/t10.log"` — Expected EXIT=1.

- [ ] **Step 2: Implementation**

`src/app/sanitize-core.ts`:

```ts
/** A `YYYY-MM-DD` string that is a REAL calendar date in 1900..2100, returned
 *  verbatim; otherwise "". ★ §539: the shape and year alone let "2026-13-01",
 *  "2026-00-10" and "2026-02-30" through. The `Date.UTC` round trip rejects a
 *  month outside 1..12 and a day past the month's real length (leap years
 *  included). It runs on LOAD paths too, deliberately: such a value is already
 *  unusable — `<input type="date">` blanks it, and date math either rolls a day
 *  overflow silently into the next month or turns a month overflow into NaN. */
export function sanitizeIsoDate(s: unknown): string {
  if (typeof s !== "string" || !ISO_DATE_RE.test(s)) return "";
  const y = Number(s.slice(0, 4));
  if (!Number.isFinite(y) || y < 1900 || y > 2100) return "";
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) return "";
  return s;
}
```

(Replace the existing docstring above `sanitizeIsoDate`, if any, with this one. Years 1900..2100 are outside `Date.UTC`'s two-digit-year remap, which only affects years 0..99.)

Rerun Step 1's command; Expected EXIT=0, `Test Files 4 passed (4)`.

- [ ] **Step 3: Sweep the docstrings the fix falsifies**

Each currently says `sanitizeIsoDate` is "regex + a 1900–2100 year bound and nothing else" / "no calendar check". After §539 the two date rules still diverge in ONE direction only (`isoDateOrUndefined` has no year bound); the calendar check now exists on both.
- `entity-descriptor.ts` `acceptsDate` docstring: replace "The default is `sanitizeIsoDate(v) === v` — regex + a 1900–2100 year bound and nothing else — which is exactly what `sanitizeAbsence` calls" with "The default is `sanitizeIsoDate(v) === v` — regex, a real calendar date (§539) and a 1900–2100 year bound — which is exactly what `sanitizeAbsence` calls", and after "and `\"1899-12-31\"` previewed as REJECTED and landed." add "★ Since §539 both rules refuse an impossible day, so only the year-bound direction still differs."
- `entity-descriptor.ts` calendarEvent comment: `\`sanitizeIsoDate\` (regex + 1900–2100, no calendar check)` → `\`sanitizeIsoDate\` (regex + calendar check + 1900–2100)`, and "the two disagree in BOTH directions" → "the two disagree on the year bound".
- `calendar-event.ts` `acceptsEventDate` docstring: "`sanitizeIsoDate` (sanitize-core.ts) is regex + a 1900–2100 year bound and nothing else" → "`sanitizeIsoDate` (sanitize-core.ts) is regex + a calendar check (§539) + a 1900–2100 year bound", and add after the `"1899-12-31"` sentence: "★ The `\"2026-01-32\"` direction was closed at the source by §539; the year-bound direction is why this override remains."
- `plan.ts`: "Match the sanitizer EXACTLY — sanitizeIsoDate is format + year-range (1900-2100)" → "Match the sanitizer EXACTLY — sanitizeIsoDate is format + real calendar date + year-range (1900-2100)".
- `plan.ts`, the same comment block (pre-flight M6): the seven lines from `//  \`sanitizeCalendarEvent\` calls \`isoDateOrUndefined\` instead (regex +` through `//  REJECTED and landed. See \`EntityDescriptor.acceptsDate\`.` still say the default rule is "regex + 1900–2100 and nothing else" and that the two rules "disagree in BOTH directions". Replace them with these seven lines (same 8-space indent, so the file stays line-neutral):

```ts
        //  `sanitizeCalendarEvent` calls `isoDateOrUndefined` instead (regex +
        //  `Date.parse`, NO year bound, against the default's regex + calendar
        //  check + 1900–2100). Before §539 the two disagreed in BOTH directions
        //  (`startDate: "2026-01-32"` previewed as accepted, then threw in
        //  `updateCalendarEvent` and cost the WHOLE patch); since §539 both
        //  refuse an impossible day, and only `"1899-12-31"` still differs: it
        //  previews as REJECTED and lands. See `EntityDescriptor.acceptsDate`.
```

Then `npm run src:symbols:check > "$LOG/srcsym.log" 2>&1; echo "EXIT=$?"` (report only) and confirm no new finding names these files.

- [ ] **Step 4: Run the census files, gates, commit**

Run, in ONE invocation, every test file listed in the census (assert the file count), plus `golden-workspace.test.ts` and `codec-roundtrip.property.test.ts`. Then `npx tsc --noEmit`, eslint over the touched files, size:check.

Subject `fix: sanitizeIsoDate rejects dates that are not real calendar dates (§539)`.

```bash
git add src/app/sanitize-core.ts src/app/sanitize-core.iso-date.test.ts src/app/sanitize.test.ts src/app/sanitize.property.test.ts src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/entity-descriptor.ts src/app/inline-ai-edit/plan.ts src/app/calendar-event.ts
git commit --only src/app/sanitize-core.ts src/app/sanitize-core.iso-date.test.ts src/app/sanitize.test.ts src/app/sanitize.property.test.ts src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/entity-descriptor.ts src/app/inline-ai-edit/plan.ts src/app/calendar-event.ts -F "$LOG/msg-t10.txt"; echo "EXIT=$?"
```

---

### Task 11: Closures — §323 comment and test, register closures for §90, §91, §204, §323, §533, §539, prose sweeps

**Files:**
- Modify: `src/app/use-task-row-handlers.ts` (`onDelete` comment)
- Test (ADD): `src/app/is-workspace-empty.test.ts`
- Modify: `docs/open-followups.md` (six closures; the ONLY writer of this file in the batch)
- Modify only if a sweep finds a falsified claim: `AGENTS.md`, `docs/AGENTS/*.md`

**Interfaces:** none.

**Test census:**

```bash
git grep -n "isMassDeletion\|allowDestructiveSave" -- src/app/use-task-row-handlers.ts src/app/use-task-row-handlers.test.ts src/app/is-workspace-empty.test.ts
```
- ADD the single-row case to `is-workspace-empty.test.ts`. Nothing else pins `onDelete`'s arming.

- [ ] **Step 1: §323 — test and comment**

In `src/app/is-workspace-empty.test.ts`, inside `describe("isMassDeletion", …)`:

```ts
  it("can never flag a single-row delete, whatever the workspace size (open-followups §323)", () => {
    for (let prev = 1; prev <= 2000; prev++) expect(isMassDeletion(prev, prev - 1), `prev=${prev}`).toBe(false);
  });
```

Run it (EXIT=0 — it pins existing behaviour; the positive control is the existing "flags losing almost everything" case in the same describe). Mutation: in `workspace-metrics.ts` temporarily change `floor = 5` to `floor = 1`, confirm red, revert, `git diff --stat` unchanged.

In `src/app/use-task-row-handlers.ts`, directly above `const onDelete = useCallback(`, add:

```ts
  // ★★ Deliberately does NOT arm `allowDestructiveSave` (open-followups §323),
  //  unlike every other entity's single delete. One call removes exactly ONE
  //  row, and `isMassDeletion` (workspace-metrics.ts) needs `prev - cur >= 5`,
  //  so this delete can never trip the guard; arming would only hand a one-shot
  //  bypass to the NEXT save. Pinned in is-workspace-empty.test.ts.
```

- [ ] **Step 2: Register closures (one writer)**

For EACH of §90, §91, §204, §323, §533, §539, in `docs/open-followups.md` (LF; Edit tool):
1. Heading: replace the trailing ` — open` / ` — OPEN` (or append, for §204 and §323 whose headings carry no suffix) with ` — CLOSED 2026-09-14` (§533: ` — CLOSED 2026-09-14 as an accepted limit`).
2. `**Status:**` block: replace with a CLOSED witness naming the commit subject and the pinning test:
   - §90: `CLOSED 2026-09-14 — every resource-creation route is closed in a popout. task-manager passes \`isPopout ? undefined :\` for \`handleCreateResource\` (WorkspaceSection and AppModals, so the picker offers no "+ Add" row) and for \`handleAddAssigneeToAddressBook\` (so the task form shows no "+" address-book button), and \`AppModals\` never renders \`ResourceEditModal\` in a popout; the Resources-view openers were already \`guardEdit\`-wrapped. Pinned by "popout: passes NO onCreateResource and NO onAddAssigneeToAddressBook" and "popout: onEditResource opens no resource editor" (\`task-manager.popout-guard.test.tsx\`, each beside a main-window positive control), "renders ResourceEditModal in the main window and never in a popout" (\`app-modals.test.tsx\`) and "renders no button when it is absent" (\`task-form-fields.test.tsx\`).` Correct the body with a dated `★ Closed 2026-09-14:` note: it named the resource picker as the only route, but the task form's address-book button also reached the resource editor (pre-flight C1).
   - §91: `CLOSED 2026-09-14 — \`useUndoStack\` takes \`isReadOnly\`; in a popout every capture pushes nothing and shows no toast, and \`undo\`/\`redo\`/\`undoById\`/\`undoThrough\`/\`redoThrough\` run nothing. Pinned by "useUndoStack — read-only" (\`undo/use-undo-stack.test.tsx\`) and the popout undo seam case.` Correct the body: the affordance was NOT invisible — every capture showed a clickable Undo toast.
   - §204: `CLOSED 2026-09-14 — \`hardDeleteProject\` sweeps \`PROJECT_SCOPED_SIDE_TABLES\` (six tables, not the two this heading named: chat_threads, committee_report_versions, document_asset_data, snapshot, snapshot_series, project_versions) in one non-fatal pipeline; \`turso-side-tables.guard.test.ts\` fails on an unregistered project-keyed table and \`turso-portfolio.execute.test.ts\` runs the sweep on node:sqlite.` Mark the body's "Do NOT build it from this entry" paragraph as superseded by this closure (banner it, do not delete the dated record).
   - §323: `CLOSED 2026-09-14 by design — \`onDelete\` does not arm, and a comment there now says why; "can never flag a single-row delete" (\`is-workspace-empty.test.ts\`) pins the unreachability.`
   - §533: `CLOSED 2026-09-14 as an accepted limit — "," and ";" are legal only inside a quoted local part (RFC 5321/5322), which this app has no use for, and every email write boundary now refuses a changed value holding either (\`emailWriteRefusal\` / \`findTornEmail\`, \`sanitize-core.email-rule.test.ts\`). An address already torn by a past CSV, Markdown or Turso save cannot be rebuilt.` Replace "Options, deliberately left open." with "Options (not taken):".
   - §539: `CLOSED 2026-09-14 — \`sanitizeIsoDate\` rejects a non-calendar date on every path by returning ""; pinned by \`sanitize-core.iso-date.test.ts\` and the strengthened property in \`sanitize.property.test.ts\`.` Keep the rationale paragraph (input-type-date blanking, V8 day rollover, month NaN, Gantt `parseISO`).
3. DELETE the entry's `**Work item:** #NN` line (#127, #128, #188, #238, #323, #329) — a closed entry carries none.
4. Index row: hand-edit the anchor (derive it from the NEW heading: lowercase, drop backticks and punctuation, spaces → `-`; the ` — ` becomes `--`, as the existing `…--closed-2026-09-14` rows show), the title cell, and the status cell → `**CLOSED** 2026-09-14` (§533: `**CLOSED** 2026-09-14 as an accepted limit`). §90's row is also repaired. At HEAD the pipe inside `number | undefined` split its title, so the cells read: Item `` `onCreateResource` is unguarded in a popout and cannot take `guardEdit` — open ``, Origin `` undefined` ``, Size `found in the help-coverage slice-3 review, unreleased`, State `open`. Rebuild the row with five cells: Item (the new title), Origin `found in the help-coverage slice-3 review, unreleased`, Size `—`, State `**CLOSED** 2026-09-14`. `—` is the register's value for an unsized entry (the §86 and §87 rows use it), and the §90 body records no size, so no size is invented (pre-flight M12).
5. Sweep falsified body sentences: grep the entry body for the changed symbols and old wording — `onCreateResource: handleCreateResource`, `useUndoHotkey`, `invisible`, `deleteAllAssetDataForProject`, `Neither gets the equivalent call`, `OPEN`, `left open`, `no calendar check`, `shape + year only` — and correct each in place with a dated `★ Closed 2026-09-14:` note rather than rewriting the record.

Gates:

```bash
npm run followups:index:check > "$LOG/idx.log" 2>&1; echo "EXIT=$?"
npm run followups:workitems:check > "$LOG/wi.log" 2>&1; echo "EXIT=$?"
npm run followups:status:check > "$LOG/st.log" 2>&1; echo "EXIT=$?"
npx vitest run scripts/followup-workitem-lib.test.mjs scripts/followup-index-lib.test.mjs --maxWorkers=1 --reporter=dot > "$LOG/fu.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG/fu.log"
```
Expected: each EXIT=0 (exit 2 means the gate could not scan — fix the markers, never re-run hoping).

- [ ] **Step 3: AGENTS prose sweep**

```bash
git grep -n "§90\b\|§91\b\|§204\b\|§323\b\|§533\b\|§539\b\|onCreateResource\|useUndoHotkey\|isEscalationEmail\|findTornEmail\|sanitizeIsoDate\|resourceErrorEmailDelimiter\|chat_threads\|committee_report_versions" -- AGENTS.md docs/AGENTS
```
For every hit, decide whether the batch falsified it (e.g. a claim that `sanitizeIsoDate` has no calendar check, that a popout can create a resource or record undo, that side tables outlive a hard delete, that only `resource.emails` is delimiter-checked). Correct only falsified claims, citing symbols, never `path:LINE`. At HEAD the known hits are `AGENTS.md` (`chat_threads` out of `TABLE_NAMES` — still true), `docs/AGENTS/ai-assistant.md` (`chat_threads` project scoping — still true) and `docs/AGENTS/documents.md` (swept in Task 9). Then:

```bash
npm run docs:symbols:check > "$LOG/sym.log" 2>&1; echo "EXIT=$?"
npm run docs:claims:check > "$LOG/claims.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 4: Commit**

Subject `docs: close §90, §91, §204, §323, §533 and §539`. The body names each entry as §N only — never `#N` after a closing verb — and ends with the session line. Scan the message before committing:

```bash
grep -niE "(clos(e[sd]?|ing)|fix(e[sd]|ing)?|resolv(e[sd]?|ing)|implement(s|ed|ing)?):? +(issues? +)?#[0-9]+" "$LOG/msg-t11.txt"; echo "EXIT=$? (1 = clean)"
git add src/app/use-task-row-handlers.ts src/app/is-workspace-empty.test.ts docs/open-followups.md
git commit --only src/app/use-task-row-handlers.ts src/app/is-workspace-empty.test.ts docs/open-followups.md -F "$LOG/msg-t11.txt"; echo "EXIT=$?"
```
(Add `AGENTS.md` / `docs/AGENTS/<file>.md` to both path lists only if Step 3 edited them.)

**GitLab — for the MR description only, never a commit message (one per line):**

```
Closes #127
Closes #128
Closes #188
Closes #238
Closes #323
Closes #329
```
(#127 = §90, #128 = §91, #188 = §204, #238 = §323, #323 = §533, #329 = §539.) GitLab issues close after merge only. No push, MR, version bump, CHANGELOG or tag without the user's explicit say.

---

## Self-review

### Spec coverage

| Spec requirement | Task |
|---|---|
| Part 1 predicates `isWriteSafeEmail`, `emailWriteRefusal` (blank / unchanged / invalid / delimiter / create) | 1 |
| Part 1 `findTornEmail` list form, docstring and §533 sentence rewritten | 1 |
| Part 1 dual-use split `isEscalationEmail` (load) / write form, three write legs | 2 |
| Part 1 `sanitizeTimelogConfig` needs no split | n/a (spec correction 1 in the spec itself) |
| Part 1 i18n `errorEmailDelimiter`; `resourceErrorEmailDelimiter` removed | 2 (add), 3 (remove) |
| Part 1 record-level write checks in a new module; `refuseInvalidAbsenceEmail` gains `stored` | 2 |
| Matrix: `Task.assigneeEmail` — editor / AI create+update / bulk / inline cell / card | 3 / 2 / 2 / 2 / 2 |
| Matrix: `Absence.assigneeEmail` — editor / AI / card | 3 / 2 / 2 (existing descriptor, stored now passed) |
| Matrix: `Shift.assigneeEmail` — editor | 3 |
| Matrix: `Resource.email` — editor / AI / card | 3 / 2 / 2 |
| Matrix: `Resource.emails` — all boundaries | 1 |
| Matrix: `Stakeholder.email` — editor / AI / card | 3 / 2 / 2 |
| Matrix: `RaidItem.ownerEmail` — editor / inquiry prompt / AI / card; bulk reassign exempt | 3 / 2 / 2 / 2; exempt by construction (no validator on `applyBulk`) |
| Matrix: `RaidEscalation.toEmail` — popover / AI | 2 |
| Matrix: `ContactPerson.email` — add refusal + FieldError | 3 |
| Matrix: Jira / Timelog settings — draft + FieldError | 4 |
| Prompt flows move to `isWriteSafeEmail` (incl. AI `sendInquiry`) | 2 |
| Copied stored emails exempt; editors flag stored-unsafe values | 1 (`copySources`), 2 (inline cell — only the picked resource's email is exempt, pre-flight M10), 3 (every editor that shows the field flags it, the task form and absence editor included, pre-flight I7; contact add) |
| Task inline cell: revert + ambient toast, reachability verified | 2 (spec correction 6) |
| Preview ⇔ write parity per newly guarded field | 2 (`plan.sanitizer-parity.test.ts` readers + `plan.test.ts`) |
| Part 2 normaliser (scalar, list, unchanged otherwise) | 5 |
| Part 2 applied on every load funnel, named per path | 5 (six-path table; spec corrections 1–3) |
| Part 2 escalation load unwraps before judging (Ruling Q5) | 5 |
| Part 2 Jira/Timelog settings not normalised (Q7) | 5 (stated; no code) |
| Part 2 notice on file open/switch, template apply, new project from template, AI import panel; ordering before the report | 5 (spec corrections 4, 5, 19): one test per action, including file-mode `createProject` and `createTursoProject` each with a template AND an AI seed (pre-flight I5); template apply through the pure `templateSeedEmailScope` test plus the behavioural `task-manager.template-notice.test.tsx` (I4); notice-before-diagnostic ordering for `onOpenStorageFile` and `loadProjectFromFile`, asserted on the surviving toast (I9) |
| Part 2 Outlook contacts import: diagnostic only, no notice | 5 (the diagnostic is tested; "no notice" holds by construction because `handleImportResources` is unchanged, and has no test — pre-flight M4, deferred) |
| Part 2 synced records drop the bad address + `logDiag` without the address | 5 |
| Part 3 §90 optional `onCreateResource`, popout passes undefined, seam test, header migrated — plus the second route (the task form's address-book button, `onAddAssigneeToAddressBook`) and the `ResourceEditModal` popout render gate, every route pinned beside a main-window positive control (pre-flight C1, I8; spec correction 7) | 7 |
| Part 4 §91 `isReadOnly` on `pushEntry` + five restore entry points, task-manager ref, tests, header migrated; the seam test reads the REAL toast through Task 7's render-through `AppModals` capture (pre-flight C2) | 8 |
| Part 5 §204 registry, one non-fatal sweep, `deleteAllAssetDataForProject` removed, guard test (Q6) that strips comments before matching DDL (pre-flight I2), execute test, test migrations, doc sweep of both `documents.md` mentions (I3) | 9 |
| Part 6 §323 comment + test; closures for §90/§91/§204/§323/§533 with body corrections | 11 |
| Part 7 pure helper, both writers, FK + old-value match, jiraKey skip, escalations never, one composite with contact-person whole-array fragment, toast count key, parity test, token invalidation, one activity entry, popout pin, Outlook re-push check | 6 (popout pin in 7, covering both resource-editor routes) |
| Scope addition §539 `sanitizeIsoDate` calendar check, tests, census, closure | 10, 11 |

Unmet as written: none. The template-apply notice now has a behavioural test (pre-flight I4). Known test gaps deferred from the pre-flight to the final review (reasons in `.superpowers/sdd/2026-09-14-email-rule-and-guard-escapes/preflight.md`, "Resolution"): M4 (no Outlook contacts-import no-notice test), M7 (the Task 2 census lists `updateRaid` / `updateStakeholder` / `updateAbsence` changed-only dispatcher tests without test code; Part 7 tokens are checked by value, not by an `update_*` refusal; no one-activity-entry check on the AI path), M8 (the copy sites exempt by construction carry no per-site pin), M11 (the refusal-key and linked-email lookups stay copied, not extracted).

### Placeholder scan

Searched for "TBD", "TODO", "implement later", "similar to Task", "add appropriate". None. Steps that depend on a helper not read at plan time (a test file's local fixture name, a picker's ARIA role) state exactly what to read and what to substitute, and give the full test body. Every commit step names its paths (pre-flight M12): no `<…>` path template remains, and a status check turns any unlisted modified path into a STOP.

### Type consistency

- `EmailRefusal`, `isWriteSafeEmail`, `emailWriteRefusal(incoming, stored, copySources?)` — defined Task 1, used unchanged in Tasks 2–6.
- `refuseEmailWrite(field, incoming, stored)` / `emailRefusalMessage` — Task 2, reused by `refuseInvalidAbsenceEmail`.
- `EMAIL_REFUSAL_KEY` values `"errorInvalidEmail" | "errorEmailDelimiter"` — Task 2; `TaskErrorKey` gains `"errorEmailDelimiter"` in Task 3 so the map's values assign.
- `InlinePatchContext.storedAssigneeEmail` / `copySourceEmails`, `inlineAssigneeEmailRefusal` — Task 2 only.
- `UseTaskSubmitArgs.resources?: readonly Resource[]`, `AssigneeField` props `emailInvalid?` / `emailDescribedBy?` — Task 3.
- `normalizeEmailShape`, `normalizeEmailListShape`, `withNormalizedEmailField`, `withNormalizedResourceEmails`, `summarizeUnsafeEmailRecords`, `UnsafeEmailScope`, `templateSeedEmailScope(before, after)` — Task 5.
- `onAddAssigneeToAddressBook?: (name: string, email: string) => void` on `AppModalsProps`, `TaskFormModal` and `TaskFormFields` props — Task 7.
- `ResourceEmailChange`, `ArrayPropagation<T>`, `EmailPropagationInput`, `EmailPropagationResult`, `propagateResourceEmail(change, input)`, `retarget*Emails`, `PropagationSetters`, `contactPersonsFragment`, `commitEmailPropagation({ change, input, result, setters })`, `CaptureCompositeOpts.toastText` — Task 6.
- `UseUndoStackDeps.isReadOnly` — Task 8. `PROJECT_SCOPED_SIDE_TABLES`, `projectSideTableSweepStatements`, `SCHEDULED_JOBS_DDL`, `COLOR_SCHEMES_DDL` — Task 9.
- `sanitizeIsoDate` signature unchanged — Task 10.
