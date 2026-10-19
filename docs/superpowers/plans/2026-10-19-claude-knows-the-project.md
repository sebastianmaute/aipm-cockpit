# Claude Knows the Project — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude fills every offered project field when proposing a new project, and the AI Assistant can read and change the project record afterwards through a reviewed card.

**Architecture:** One pure module (`project-ai-fields.ts`) owns the offered field list, the excluded list and a per-field judge; the proposal, the new `get_project` / `update_project` tools, the card describer and the write all read it. The tools follow the forecast tools' shape (own defs module, own `run*Tool` routed before `runTool`'s switch, own dispatcher hook). The write goes through the project form's own path, made awaitable, so Turso multi-project mode reaches the projects table.

**Tech Stack:** TypeScript, React 19, Next.js (see AGENTS.md), Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-10-19-claude-knows-the-project-design.md` (owner-approved 2026-10-19, with answers A and B).

## Global Constraints

- `src/**` files are CRLF in the working tree; edit `src/app/i18n.de.ts` only by a node UTF-8 write with `\r\n` anchors (AGENTS.md "i18n"). EN and DE key sets identical (tsc enforces).
- `src/app/task-manager.tsx` is over the size LIMIT (1600) and sits on its baseline: every change to it is net-zero lines. Never run `check-file-sizes.mjs --update`.
- No new `Workspace` field. No `--amend`, no `sed -i` on repo files; commit with `git commit --only <paths>`; commits cite §715 only; no `Claude-Session` trailer, no URLs.
- Vitest only through `bash .superpowers/sdd/2026-10-17-video-guides-recorder/vt.sh <log> <files…>`, one run at a time; read `Test Files N` from the log.
- Before every commit of a task: `npx eslint --max-warnings=0 <changed files>` and `npx tsc --noEmit` with 0 errors.
- Model output is untrusted: every URL through `isSafeHttpUrl`, every enum against its set, never a value the judge did not accept.

## Review Focus

1. **Remote write fails on Apply (Turso multi-project, network down or token expired).** The card row says it failed, the in-memory project is unchanged, nothing is logged, no undo entry. → Task 5 test `update fails: card row error, project unchanged, no log, no undo`.
2. **A human edits the project between preview and Apply.** The stale token refuses the write at apply time; nothing changes. → Task 4 test `stale token at apply refuses update_project`.
3. **A project switch between preview and Apply.** The write is dropped by the existing scope-epoch check, not applied to the new project. → Task 5 test `project switch before apply drops the write`.
4. **Pop-out window or AI switched off.** `update_project` refuses in a read-only window; neither tool is offered while AI is off. → Task 3 test `read-only window refuses update_project`.
5. **A model sends `endDate` alone before the stored `startDate`, or a 5,000-character name.** The end date is refused and shown refused on the card; the name is stored truncated and the card shows the truncated value. → Task 1 tests (judge) and Task 4 test `card parity: refused and truncated rows`.

---

### Task 1: The field list and the per-field judge

**Files:**
- Create: `src/app/project-ai-fields.ts`
- Test: `src/app/project-ai-fields.test.ts`

**Interfaces:**
- Consumes: `ProjectMeta` (`types.ts`); `REGULATORY_REQUIREMENTS`, `REGULATORY_NOT_APPLICABLE`, `IDENTITY_TYPE_SET`, `DEPLOYMENT_SET` (`project-options.ts`); `NACE_SECTION_SET`, `BUDGET_NAME_MAX`, `sanitizeText`, `sanitizeIsoDate`, `isSafeHttpUrl` (where `sanitize-records.ts` imports them from); the IANA check the project form uses for `operatingTimezone` (find it with `grep -rn "operatingTimezone" src/app/project-form*.tsx`).
- Produces:
  - `export const PROJECT_AI_FIELDS: readonly ProjectAiField[]` — the 25 offered keys (with the 4 excluded, all 29 `ProjectMeta` keys), in the spec's table order.
  - `export type ProjectAiField` — the union of those keys.
  - `export const PROJECT_AI_EXCLUDED: Readonly<Record<Exclude<keyof ProjectMeta, ProjectAiField>, string>>` — `contactPersons`, `keyStakeholdersInternal`, `keyStakeholdersExternal`, `knowledgeLinks`, each with the spec's reason.
  - `export type FieldVerdict = { kind: "accepted"; value: unknown } | { kind: "normalised"; value: unknown; note: string } | { kind: "refused"; reason: string }`
  - `export function judgeProjectField(field: ProjectAiField, raw: unknown, context: { startDate: string; endDate: string }): FieldVerdict`
  - `export function applyProjectPatch(stored: ProjectMeta, raw: Record<string, unknown>): { next: ProjectMeta; rows: { field: ProjectAiField; before: unknown; verdict: FieldVerdict }[]; unknownKeys: string[] }` — judges each passed offered key (dates against the merged pair), skips `expectedToken`, lists any other key in `unknownKeys`, and builds `next` from accepted/normalised values only.

- [ ] **Step 1: Write the failing tests** (`project-ai-fields.test.ts`)
  - `every ProjectMeta key is offered or excluded with a reason` — build the key list from a full `ProjectMeta` literal typed `Required<ProjectMeta>` and assert each key is in exactly one of `PROJECT_AI_FIELDS` / `Object.keys(PROJECT_AI_EXCLUDED)`, and every reason is a non-empty string.
  - `regulatory: GDPR accepted; an unknown value refused; "Not applicable" with GDPR normalises to ["Not applicable"]` — `judgeProjectField("regulatory", ["GDPR / data protection regulation"], ctx)` → `{ kind: "accepted", value: ["GDPR / data protection regulation"] }`; `["Made-up act"]` → `refused`; `["Not applicable", "GDPR / data protection regulation"]` → `normalised` with value `["Not applicable"]`.
  - `deployment and naceSection outside their sets are refused, not the record` — `("deployment", "Moon")` and `("naceSection", "ZZ")` → `refused`; `("deployment", "Cloud")` → `accepted`.
  - `a text over its cap is normalised to the truncated value` — `("name", "x".repeat(BUDGET_NAME_MAX + 50))` → `normalised`, value length `BUDGET_NAME_MAX`.
  - `an unsafe URL is refused` — `("jiraUrl", "javascript:alert(1)")` → `refused`; `("jiraUrl", "https://jira.example.com/browse/X")` → `accepted`.
  - `endDate before the stored startDate is refused; both passed and inverted refuses the endDate` — via `applyProjectPatch(stored /* startDate 2026-03-01 */, { endDate: "2026-02-01" })`: row for `endDate` is `refused`, `next.endDate` equals the stored one; with `{ startDate: "2026-05-01", endDate: "2026-04-01" }`: `startDate` accepted, `endDate` refused.
  - `counts: a negative or non-integer identityCount is refused` — `-1` and `2.5` → `refused`; `"40"` and `40` → `accepted` with value `40`.
  - `applyProjectPatch leaves fields it was not given untouched and reports unknown keys` — stored with `customer: "Northwind"`, patch `{ sponsor: "Elena Fischer", contactPersons: [], expectedToken: "t" }` → `next.customer === "Northwind"`, `next.sponsor === "Elena Fischer"`, `unknownKeys` equals `["contactPersons"]`.

- [ ] **Step 2: Run to verify they fail**
  Run: `bash .superpowers/sdd/2026-10-17-video-guides-recorder/vt.sh <scratchpad>/t1.log src/app/project-ai-fields.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `project-ai-fields.ts`** with the signatures above, reusing `sanitize-records.ts`'s rules field by field (its caps, `NACE_SECTION_SET`, the regulatory collapse) without its whole-record rejection, and the form's end-not-before-start rule.

- [ ] **Step 4: Run to verify they pass** — same command → `Test Files 1 passed`.

- [ ] **Step 5: Commit** — `git add -- src/app/project-ai-fields.ts src/app/project-ai-fields.test.ts && git commit --only src/app/project-ai-fields.ts src/app/project-ai-fields.test.ts -m "feat: one list of the project fields Claude may set, judged field by field (§715)"`

### Task 2: The proposal fills every offered field

**Files:**
- Modify: `src/app/ai-project-proposal.ts` (`ProposalMeta`, `PROPOSAL_TOOL` meta schema, `parseProposal`, `proposalToDraftPatch`, `buildProposalSystemPrompt`)
- Test: `src/app/ai-project-proposal.test.ts`, `src/app/ai-project-proposal.offered-surface.test.ts`

**Interfaces:**
- Consumes: `PROJECT_AI_FIELDS`, `judgeProjectField` (Task 1); `ProjectFormDraft` (`project-form-fields.tsx` — counts are strings there).
- Produces: `ProposalMeta` = `{ name: string } & Partial<Record<ProjectAiField, unknown>>` holding judged values; the schema's meta properties are generated from `PROJECT_AI_FIELDS` with enums from `project-options.ts`.

- [ ] **Step 1: Write the failing tests**
  - `a proposal naming GDPR ticks GDPR in the draft` — `proposalToDraftPatch(parseProposal({ meta: { name: "CIAM", regulatory: ["GDPR / data protection regulation"], identityTypes: ["B2C"], deployment: "Cloud" }, features: [] })!)` → `regulatory` equals `["GDPR / data protection regulation"]`, `identityTypes` `["B2C"]`, `deployment` `"Cloud"`.
  - `a refused value never reaches the draft` — `regulatory: ["Made-up act"]`, `jiraUrl: "javascript:x"`, `naceSection: "ZZ"` → none of those keys in the patch.
  - `counts reach the draft as strings` — `identityCount: 250000` → patch `identityCount === "250000"`.
  - `the schema offers every PROJECT_AI_FIELDS key and nothing excluded` — `Object.keys(PROPOSAL_TOOL.input_schema.properties.meta.properties)` sorted equals `PROJECT_AI_FIELDS` sorted; the `regulatory` items enum equals `REGULATORY_REQUIREMENTS`.
  - Update `offered-surface.test.ts` where it pins the old eight meta fields.
  - `the system prompt asks for regulatory needs only from what the brief says` — `buildProposalSystemPrompt()` contains `"only from what the description says"`.

- [ ] **Step 2: Run to verify they fail** — vt.sh on both files → FAIL on the new tests.
- [ ] **Step 3: Implement.** Schema properties built from `PROJECT_AI_FIELDS` (strings; arrays with `enum` items for `regulatory`/`identityTypes`; `enum` for `deployment`; `integer` for the two counts); `parseProposal` keeps each offered key only when `judgeProjectField` accepts or normalises it (context dates from the same meta); `proposalToDraftPatch` maps every judged key, stringifying counts. Add the prompt sentence: `Infer regulatory requirements, identity types and deployment only from what the description says (e.g. GDPR erasure → GDPR; an online retailer's customers → B2C); never guess them.`
- [ ] **Step 4: Run to verify they pass** — `Test Files 2 passed`.
- [ ] **Step 5: Commit** — the two source/test files, message `feat: the project proposal fills every project field Claude can infer (§715)`.

### Task 3: `get_project` and `update_project`

**Files:**
- Create: `src/app/chat-tool-defs-project.ts`, `src/app/chat-tools-project.ts`, `src/app/chat-tools-project.test.ts`
- Modify: `src/app/ai-entity-token.ts` (a `"project"` token entity), `src/app/chat-tool-defs.ts` (include the defs; same gating as other write tools), `src/app/chat-tools.ts` (route before the switch; add `ProjectToolDispatcher` to `ToolDispatcher`)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `export type ProjectToolDispatcher = { getProjectMeta(): ProjectMeta | null; updateProjectMeta(next: ProjectMeta): Promise<ProjectMeta> }` — `updateProjectMeta` rejects with `Error(<message the model can relay>)` on failure or in a read-only window.
  - `export const NOT_PROJECT_TOOL: unique symbol`; `export function runProjectTool(name: string, input: Record<string, unknown>, d: ProjectToolDispatcher): Promise<unknown> | typeof NOT_PROJECT_TOOL`.
  - `get_project` → `{ ...offered fields, expectedToken }`; `update_project` input `{ expectedToken (required), ...offered fields }` → `{ project: <offered fields>, refused: { field, reason }[], ignored: string[] }`.
  - Token: `entityToken("project", meta)` derived from `PROJECT_CSV_COLUMNS` / `projectFieldToString` (add the case to `ai-entity-token.ts`; the existing token tests show the pattern).

- [ ] **Step 1: Write the failing tests** (`chat-tools-project.test.ts`, fake dispatcher)
  - `get_project returns the offered fields and a token, never an excluded field`.
  - `update_project with a stale token is refused and nothing is written` — `updateProjectMeta` not called; error mentions the token.
  - `update_project changes only the passed fields` — stored customer kept; `sponsor` set; result `refused` empty.
  - `update_project keeps a refused field at its stored value and reports it` — `jiraUrl: "javascript:x"` → `updateProjectMeta` called with the stored `jiraUrl`; `refused[0].field === "jiraUrl"`.
  - `a patch with only refused fields writes nothing` — `updateProjectMeta` not called; result `refused` non-empty.
  - `read-only window refuses update_project` — dispatcher's `updateProjectMeta` rejects with the read-only message; the tool rejects with it.
  - `runTool routes both names` (in `chat-tools.test.ts`): `runTool(d, "get_project", {})` reaches `getProjectMeta`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** with the signatures above; defs text names the fields and says `Only the fields you pass change. Contact persons, key-stakeholder lists and knowledge links are not editable here.`
- [ ] **Step 4: Run to verify they pass** — the new file plus `chat-tools.test.ts`, `chat-tool-defs.test.ts`, `ai-entity-token.test.ts`.
- [ ] **Step 5: Commit** — `feat: the assistant reads and updates the project record (§715)`.

### Task 4: Always a card, with honest rows

**Files:**
- Modify: `src/app/chat-proposal.ts` (`shouldStage`: any `update_project` stages; classify it as an entity write), `src/app/chat-proposal-apply.ts` (`TOKEN_ROW_SOURCE.update_project` with `getRow: (d) => d.getProjectMeta()`), `src/app/chat-proposal-describe.ts` (project rows), the card's row rendering only if it cannot show a per-field refused/normalised state already
- Create: `src/app/chat-proposal-describe.project.test.ts`, `src/app/project-tool-coverage.test.ts`

**Interfaces:**
- Consumes: `applyProjectPatch` (Task 1), `ProjectToolDispatcher` (Task 3).
- Produces: `describeProjectCall(input: Record<string, unknown>, stored: ProjectMeta): { label: string; rows: { field: ProjectAiField; before: string; after: string; state: "change" | "normalised" | "refused" }[] }`, and the plan's `rejected` entries for refused fields so `stripRejectedFields` drops them before replay.

- [ ] **Step 1: Write the failing tests**
  - `a lone update_project stages` — `shouldStage([{ name: "update_project", input: { sponsor: "x" } }])` → `true` (owner answer A).
  - `card parity: refused and truncated rows` — for stored meta and a patch with a truncatable name and an `endDate` before the stored start: each describer row's `after` equals the value `applyProjectPatch(...).next` stores for accepted/normalised rows, and refused rows equal the stored value with `state: "refused"`.
  - `stale token at apply refuses update_project` — through the existing apply path with `TOKEN_ROW_SOURCE`, a meta changed after preview → the row reports stale and `updateProjectMeta` is not called.
  - `every update_project input is described or excluded with a reason` (`project-tool-coverage.test.ts`) — keys of the tool's `input_schema.properties` minus `expectedToken` equal `PROJECT_AI_FIELDS`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Row labels reuse the project form's i18n labels (EN + DE already exist; add none unless a field has no label).
- [ ] **Step 4: Run to verify they pass** — new files plus `chat-proposal.test.ts`, `chat-proposal-apply*.test.ts*`, `chat-proposal-describe*.test.ts`.
- [ ] **Step 5: Commit** — `feat: a project update is always a card that shows what will be stored (§715)`.

### Task 5: The write goes through the project form's path

**Files:**
- Modify: `src/app/use-turso-projects.ts` (`handleUpdateCurrentProjectByMode(meta): Promise<boolean>` — resolves `true` once written, `false` after its toast on failure; the async branch is awaited), `src/app/use-portfolio-projects.ts` (pass-through type), `src/app/task-manager.tsx` (hand the handler to the dispatcher through a ref, **net-zero lines**)
- Create: `src/app/use-project-tools.ts` (the `ProjectToolDispatcher` hook, spread into `useChatDispatcher` like `useForecastTools`), `src/app/use-project-tools.test.tsx`
- Modify: `src/app/use-chat-dispatcher.ts` (`ChatDispatcherArgs.projectWriterRef: RefObject<((meta: ProjectMeta) => Promise<boolean>) | null>`; call `useProjectTools`), `src/app/use-chat-dispatcher-wiring.ts` (forward it)

**Interfaces:**
- Consumes: Tasks 1, 3; `UndoStackApi.captureComposite`; `LogActivityAsFn`; `getScopeEpoch` / `dropStaleScopeWrite` (`scope-epoch.ts`).
- Produces: `useProjectTools(deps: { isReadOnly: boolean; logActivityAs?: LogActivityAsFn; undoRef: …; projectWriterRef: … }): ProjectToolDispatcher`.

- [ ] **Step 1: Write the failing tests** (`use-project-tools.test.tsx`)
  - `update writes through the writer and resolves the stored meta` — fake writer resolves `true`; `updateProjectMeta(next)` resolves `next`.
  - `update fails: card row error, project unchanged, no log, no undo` — writer resolves `false` → `updateProjectMeta` rejects; `logActivityAs` not called; `captureComposite` not called.
  - `project switch before apply drops the write` — scope epoch moves between call and writer → writer not called (or its result discarded) and the call rejects with the stale-scope message.
  - `read-only window refuses` — `isReadOnly: true` → rejects, writer not called.
  - In `use-turso-projects` tests: `handleUpdateCurrentProjectByMode resolves false after a failed tenant write` and `resolves true in file mode`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** The project form's caller ignores the boolean (no behaviour change for it). task-manager: create the ref where the dispatcher is wired and assign it once the handler exists, keeping the file's line count unchanged (`node scripts/check-file-sizes.mjs` exit 0).
- [ ] **Step 4: Run to verify they pass** — new file, `use-turso-projects*.test.ts*`, `use-chat-dispatcher.test.tsx`, `use-chat-dispatcher-wiring.test.tsx`; `node scripts/check-file-sizes.mjs` → exit 0.
- [ ] **Step 5: Commit** — `feat: the assistant's project update writes where the project form writes (§715)`.

### Task 6: Logged for both, undoable for the AI edit

**Files:**
- Modify: `src/app/activity-log.ts` (`"project.updated"` kind + label key), `src/app/activity-message.ts` (if its `Record<ActivityKind,…>` needs the entry), `src/app/i18n.ts` + `src/app/i18n.de.ts` (`activityProjectUpdated`, and the undo singular/plural keys), `src/app/undo/use-undo-stack.ts` (`"project"` in `UndoEntityKey`, `ENTITY_SINGULAR`, `ENTITY_PLURAL`, `ENTITY_KEY_SET`), `src/app/use-project-tools.ts` (log + capture on success), the project form's save path (log the human edit: find the caller of `onUpdateCurrentProject` in `project-edit-modal.tsx`)
- Test: `src/app/use-project-tools.test.tsx`, the project edit modal's test file

**Interfaces:**
- Consumes: Task 5.
- Produces: `logActivityAs("ai", "project.updated", <changed field names joined by ", ">)` after a successful AI write; the same kind with actor `user` from the form when its write resolves `true`; one undo entry (`entityKey: "project"`) whose fragment restores the before-meta through `projectWriterRef` and whose redo re-applies `next` the same way.

- [ ] **Step 1: Write the failing tests**
  - `a successful AI update logs project.updated with the changed fields`.
  - `undo after an AI project update restores the previous meta through the writer` — writer called a second time with the before-meta.
  - `a form save logs project.updated as the user` (project edit modal test).
  - `a form save is not undoable` — no undo entry pushed (owner answer B).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**; DE strings through the node UTF-8 write with `\r\n` anchors.
- [ ] **Step 4: Run to verify they pass** — plus `activity-log*.test.ts`, `undo/*.test.ts*` touched by the new key, `i18n-encoding.test.ts`; `npx tsc --noEmit` → 0 errors.
- [ ] **Step 5: Commit** — `feat: project edits are logged, and the assistant's can be undone (§715)`.

### Task 7: Docs and changelog

**Files:**
- Modify: `docs/AGENTS/ai-assistant.md` (a short "Project tools" bullet: the field list module, always staged, the write path, the excluded fields), `CHANGELOG.md` (`### Added` under `[Unreleased]`), the design doc's status line.

- [ ] **Step 1:** Write both; every backticked name must exist (`npm run docs:symbols:check` exit 0).
- [ ] **Step 2:** `node scripts/gate-local.mjs --group static --keep-going --allow-dirty` → only the known untracked `.superpowers/tmp` lint fails.
- [ ] **Step 3: Commit** — `docs: the assistant's project tools (§715)`.

After merge (not this plan): the `ch2-connect` prologue caption points at the ticked GDPR box; recorded with the re-takes.
