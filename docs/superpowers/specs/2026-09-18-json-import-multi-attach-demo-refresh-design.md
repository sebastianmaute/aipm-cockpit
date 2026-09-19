# JSON project import, multi-attachment chat, demo refresh — design

**Date:** 2026-09-18 · **Branch:** `feat/json-import-multi-attach-demo-refresh` (off `origin/main` 5c664157)
**Status:** approved in brainstorming (answers: Q1 A, Q2 B, Q3 A, Q4 A; approach 1)

## Why

Three user asks, folded into one slice:

1. A project must be loadable from, and creatable from, a **JSON** file — e.g. the repo's own
   `sample-workspace-*.json`.
2. The AI Assistant must take **several attachments in one go** and have Claude process them together.
3. The **demo project and sample workspace** must reflect today's feature set, budget first.

## What the code does today (measured, not assumed)

- **Load from file already accepts `.json`.** `use-storage-file-ops.ts` `loadProjectFromFile()` →
  `fs-access.ts` `pickOpenFileAny()` offers JSON/CSV/MD via `showOpenFilePicker`, and
  `formatFromFileName` routes `.json` to `jsonToWorkspace`. Works in Chromium; throws
  `file-system-access-unsupported` in Firefox/Safari (out of scope — see §6).
- **Create-from-file does not.** The create wizard's Step 0 (`step0-import-panel.tsx`) reads files through
  `attachment-ingest.ts` and sends them to Claude as a proposal. Its picker uses `ATTACHMENT_ACCEPT`
  (`chat-attachments.ts`), which has **no `.json`**, and nothing on that path calls `jsonToWorkspace`.
  Step 0 renders **only when an API key is set**.
- **Chat multi-select already works in code.** `chat-panel.tsx` `handleFiles` iterates every picked file,
  collects every failure, and `submitPrompt` sends all staged blocks in ONE user message. Gaps: `.json`
  rejected (same accept list); no count cap; no total-payload cap (the Messages API rejects a body over
  **32 MB** with 413); button reads "Attach a document"; no drag-and-drop; no happy-path test for N files.
- **The demo is a finished project.** `task-manager.tsx` `loadDemo` loads `sample-workspace-small.json`
  with no date handling. Its plan runs 2026-04-01 → 2026-07-31 and every budget window sits inside it;
  today (2026-09-18) is after the end, so the 1.6.0 forecast cards render an ended project.
- **Sample gaps:** `budgetFollowsPlan` unset; `fxRates` null; `Role.order` unset and every role
  day-rated; dated actuals only 3 day-keys on one bucket; each bucket option demoed once. Absent slices:
  `activityLog`, `insights`, `knowledgeItems`, `timelogLinks`, `documentAssets`, `features`,
  `fieldVisibility`, `settingsOverrides`, `budgetHistory`. RAID `noteLog` on 2 of 13.

## Design

### 1. Shared accept list — `.json` becomes a text attachment

Add `".json"` to `TEXT_EXTENSIONS` in `chat-attachments.ts`. `ATTACHMENT_ACCEPT` is derived from those
tables, so chat and Step 0 both gain it with no second list. Classification is `"text"`; the ingest path
already reads text files as a text block. MIME `application/json` must classify the same way when the
extension is missing — check `classifyAttachment`'s MIME branch and add it there if it is extension-only.

### 2. Create a project from a native workspace JSON (approach 1)

**Pure detector** — new `src/app/native-workspace-import.ts`:

```ts
export type NativeWorkspaceResult =
  | { kind: "workspace"; workspace: Workspace }
  | { kind: "not-workspace" }               // JSON, but not our shape → caller sends it to Claude
  | { kind: "invalid"; reason: string };    // our shape, but strict decode failed → error, create nothing
export function parseNativeWorkspace(text: string): NativeWorkspaceResult;
```

"Our shape" = parses as a JSON object carrying the top-level keys `jsonToWorkspace` requires (read the
decoder for the exact discriminator; do not invent one). Decoding uses `jsonToWorkspace(text, { strict: true })`
— the same decoder "Load from file" uses, so the two paths cannot disagree on what a valid file is.
`jsonToWorkspace` needs a DOM (memory `jsontoworkspace-needs-dom`): the unit test runs under jsdom.

**Wizard wiring** (`create-project-wizard.tsx`):

- New wizard state `importedWorkspace: Workspace | null`.
- **Step 0:** before ingest, each picked/dropped `.json` goes through `parseNativeWorkspace`.
  `workspace` → set `importedWorkspace`, pre-fill Step 1 from `workspace.project` (name, code), advance to
  Step 1, **no model call**. `not-workspace` → unchanged AI path. `invalid` → Step 0's existing error
  surface, nothing staged. If several files are picked and one is a native workspace, the native file wins
  alone and the others are reported as ignored (a workspace import and an AI proposal cannot merge).
- **Step 1:** an "Import workspace file…" control using the existing `FilePickerButton` primitive
  (`accept="application/json,.json"`), placed in the Step 1 footer-left slot the wizard already builds
  (`step1FooterLeft`). Reachable **without** an API key. Same three outcomes.
- When `importedWorkspace` is set, Step 1 shows a one-line notice naming the file and what it carries
  (counts of tasks/RAID/budgets), with a ✕ that clears the import. Storage format choice is unchanged.
- **On Create:** the project is created with the full imported workspace instead of an empty one, in the
  storage kind the user chose, with the user's Step 1 name/code overriding the file's. Reuse the create
  path the wizard already calls (`use-storage-file-ops.ts` `createProject`) — extend it to accept an
  optional seed `Workspace`, mirroring how `createDemoProject(ws)` seeds. Do not add a third create path.

Why here and not "Load from file": load binds the project to the picked file in place; create writes a
new project into storage of the user's choice. Both are wanted; they are different operations.

### 3. Chat: multiple attachments, hardened (answer B)

All in `chat-panel.tsx` + `chat-attachments.ts`; no new UI primitive.

- **Copy:** `chatAttach` → "Attach documents" (EN) and the DE equivalent; `chatAttachmentHint` states
  several files may be picked or dropped. DE edits via node utf8 write only, never the Edit tool
  (`i18n.de.ts` rule).
- **Count cap:** `MAX_CHAT_ATTACHMENTS = 10` in `chat-attachments.ts`, counted over **already-staged plus
  newly picked**. Excess files are not staged and are named in the error.
- **Payload cap:** `MAX_STAGED_PAYLOAD_BYTES = 30 * 1024 * 1024` over the staged BLOCKS (base64 data length
  + text length), not raw file size — office/mail files arrive as extracted text, so raw size is the wrong
  measure. 30 MB leaves 2 MB of the API's 32 MB body for the prompt, system and history. A file that would
  push the total over is not staged; the error names it. Pure helper `stagedPayloadBytes(blocks)` so the
  measure is unit-testable. (Earlier turns' attachments re-sent as history are NOT covered — out of scope,
  §6.)
- **Drag-and-drop:** `onDragOver={(e) => e.preventDefault()}` + `onDrop` on the chat panel's container,
  following `asset-library.tsx`. `onDrop` passes `e.dataTransfer.files` to the existing `handleFiles`, so
  type, size, count and payload caps apply identically. No visual drop overlay (that would be a new control;
  ask before adding one). Disabled whenever the paperclip is disabled (busy / AI off).
- **Tests** (`chat-panel.test.tsx`): N valid files → ONE request whose user content has the text block plus
  N attachment blocks; 11 files → 10 staged + error naming the 11th; payload overflow → offending file named,
  others staged; a drop stages exactly like a pick; `.json` stages as text.

### 4. Demo and sample refresh (answers A + A)

**4a. Date shift on demo load.** New pure `src/app/shift-workspace-dates.ts`:

```ts
export function demoShiftFor(asOf: string, today: string, granularity: PlanGranularity): number;
export function shiftWorkspaceDates(ws: Workspace, n: number): Workspace; // new object, input untouched
```

- **Unit = the plan's granularity**, because period keys are `"YYYY-MM"` (month) or `"YYYY-Www"` (week) and
  index the plan's allocations and every budget map. Month plans shift by `n` calendar months, week plans by
  `n` weeks. `DEMO_AS_OF` (constant beside `loadDemo`) is the date the master is authored to represent;
  `demoShiftFor` returns whole units from it to today, so "today" always sits at the same point in the demo.
- **Every date-bearing field shifts**: the inventory is the one measured on the current master (tasks
  start/due/created/completed/lastUpdate/localModified/lastSynced + noteLog timestamps; RAID
  raised/target/closed + escalations + noteLog; changes; milestones; absences; shifts; calendarEvents
  start + exceptions; steering meetings; plan + project start/end; budgets start/end/closed; documents and
  versions; status narrativeUpdatedAt) **plus every field the new content adds**. The test enumerates date
  fields by walking the master for ISO-date strings and date-shaped keys and fails on any it does not
  shift — a hardcoded list would go stale the day a field is added (memory
  `discovery-sweep-survives-a-move-hardcoded-does-not`).
- **Keys shift too:** period keys recomputed through the existing `periodKeyForDate`; day keys
  (`actualHours` dated actuals) shift as dates.
- **Weekends (month unit only):** a date-only value that lands on Sat/Sun rolls forward to Monday. Rolling
  forward is monotone, so start ≤ end is preserved. Two day-keys that land on the same Monday are **summed**,
  never overwritten. Datetime timestamps shift but do not roll.
- **n = 0 is the identity** (byte-identical round trip) — true today, since the master is authored as of now.
- The golden fixtures stay pinned to the **unshifted** file; the shift runs only in `loadDemo`.

**4b. Re-date the master** so `DEMO_AS_OF` = 2026-09-18 reads mid-project: plan roughly 2026-06 → 2026-12,
budget buckets spanning past/current/future months, some tasks done, some overdue, some upcoming.

**4c. Content** (hand-edited in `sample-workspace-small.json`, the only hand-edited sample):

- Budget: `plan.budgetFollowsPlan: true` on the plan (read `ResourcePlan.budgetFollowsPlan` for its exact
  semantics first); an `fxRates` table with a second currency and one bucket in it; manual `Role.order`;
  one role with `rateBasis: "hour"`; dated actuals across ≥3 buckets and several weeks up to `DEMO_AS_OF`
  so burn and forecast draw a real curve; fixed-price, discipline-split, rate-override and closed each on a
  second bucket; `createdDate` on buckets.
- Other slices: a dozen `activityLog` entries; a few `insights`; several `knowledgeItems`; `timelogLinks`
  for the tasks that carry dated actuals; `noteLog` on more RAID items and on changes.
- Deliberately NOT seeded: `documentAssets` (image bytes bloat the JSON), `features` / `fieldVisibility` /
  `settingsOverrides` (seeding can only hide things in a demo), `budgetHistory` (append-only, written by
  live budget edits — `budget-history.ts` header).
- Every new record must pass the sanitizers: the load goes through `jsonToWorkspace(strict)`, so a record
  that sanitizes away silently is a defect. The test asserts post-decode counts equal the file's counts per
  slice.

**4d. Downstream, regenerated deliberately, in this order:**

1. `npx vite-node scripts/generate-sample-workspace.ts` → `-big.json` / `-huge.json` (never hand-edit).
2. Golden fixtures `src/app/__fixtures__/golden-workspace.{csv,md}` regenerated from the new master through
   the real serializers. This is a legitimate *input* change (the AGENTS.md rule); the commit says so.
3. Update `sample-workspace-budget.test.ts` and `sample-workspace-stakeholders.test.ts` to the new content —
   re-derive every pinned value from the file, never from the old assertion.
4. `e2e/seed.ts` reads the master at module top level: run `npx playwright test --list` to prove it still
   loads, and re-read its layered data for collisions with new ids.
5. Grep `e2e/` and `src/` for pinned sample counts/names (`version-diff.test.ts`, `scale-workspace.ts`
   comments) and correct what the change falsifies.

### 5. Testing and gates

Per task, targeted only (standing constraint — no full suite without the user's say): the touched test
files via `vitest --maxWorkers=1 --reporter=dot`, `npx tsc --noEmit`, `npx eslint --max-warnings=0 src`.
Plus, where the task touches them: `golden-workspace.test.ts`; `docs:symbols:check`; `size:check`
(`chat-panel.tsx` and `create-project-wizard.tsx` sizes checked with the `+1` rule before editing);
`dup:check`. Mutation-prove each new guard (count cap, payload cap, native-vs-other routing, weekend roll,
key merge) — a guard with no failing mutant is not pinned. a11y: the new Step 1 import control and the
drop target need accessible names; run the axe spec for the wizard/AI Assistant views before push.

### 6. Out of scope — recorded, not done

- "Load from file" in Firefox/Safari (no File System Access API → throws). File as a register entry + issue.
- Attachments from earlier turns re-sent in history can still push a later request past 32 MB. File as a
  register entry + issue.
- A visual drop overlay for the chat panel (needs a primitive decision).

## Risks

- **Sample edits ripple wide.** Mitigation: 4d order; golden regeneration only after the master is final.
- **Sanitizers can silently drop seeded records.** Mitigation: per-slice post-decode count assertion.
- **Shift misses a date field.** Mitigation: discovery-based test, not a list.
- **`createProject` seed changes a shared create path.** Mitigation: seed is optional; the no-seed path is
  pinned by the existing create tests unchanged.
