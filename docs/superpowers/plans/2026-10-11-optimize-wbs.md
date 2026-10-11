# `optimize_wbs` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An AI work-breakdown optimizer. The AI proposes splits, regroups, new tasks, estimates and FS links; the user ticks the items they want in a preview; only the ticked items are written. It is reachable from an Open Points toolbar button and from the chat tool `optimize_wbs`.

**Architecture:** This mirrors "Plan with AI".

- A pure, i18n-free engine (`src/app/wbs-plan/wbs-plan.ts`) owns the context, the tool schema, the parser, grounding and apply.
- `wbs-plan-call.ts` makes the one forced Anthropic call.
- `use-wbs-plan.tsx` (called in `task-manager.tsx`) owns the propose → preview → apply state machine, the toolbar button and the modal. The modal renders from `modalsBlock`.
- The chat tool only opens the flow.

**Tech stack:** React 19, TypeScript, vitest with Testing Library, fast-check, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-optimize-wbs-design.md`. Read it before Task 1; this plan argues from it.

## Global Constraints

- **Values from the spec:**
  - `MAX_WBS_ITEMS = 60`
  - `MAX_SPLIT_PIECES = 6`, with a minimum of 2 pieces
  - `MAX_WBS_ESTIMATE_MINUTES = 9600`
  - links are FS only
- **What the tool may never do:**
  - remove a row, cancel a task, remove a link, or overwrite an existing estimate;
  - change a closed task (`isTaskClosed`) or a Jira-synced one (`!!task.jiraKey`);
  - change anything outside the scope.
- **Split rule:** piece 1 IS the original row and keeps its id. Pieces 2 onward are new tasks inheriting the original's `assignee`, `assigneeEmail`, `resourceId`, `group`, `labels`, `priority` and `dueDate`.
- **Sanitizers:**
  - names: `sanitizeTaskName`
  - groups: `sanitizeGroup`
  - assignees: `sanitizeAssignee`
  - dates: `sanitizeIsoDate`
  - rich descriptions: `sanitizeAiRichText` (`ai-rich-text.ts`)
- **ID minting:** new task ids come from `mintIds("task", list, n)` (`id-mint-session.ts`), called once per apply, in the click handler, never inside a state updater. The minter is session-monotonic, so minted ids cannot collide.
- **Undo:** capture updates only (`kind: "bulk.edit"`, `entityKey: "task"`). Created rows are never in the undo images (`docs/AGENTS/undo.md` "Creates").
- **Activity:** one `logActivityAs("ai", "ai.wbsPlan", appliedCount)` per apply.
- **Strings:** EN and DE for every string, with `wbsPlan*` key names. `i18n.de.ts` is written with a node utf8 script that preserves CRLF, never with the Edit tool. Lang literals are `"en-US"` / `"de"`.
- **Line endings:** `src/app/*` and `e2e/*` are CRLF. Use the Edit tool or a CRLF-preserving node script, never `sed -i`. Docs are LF.
- **Gates before every push:** `npx eslint --max-warnings=0 <changed files>` and `npx tsc --noEmit`, each exit 0 with zero errors in total, read unpiped.
- **Vitest:** targeted runs only, under the lock: `until mkdir /c/Projects/.vitest-lock 2>/dev/null; do sleep 5; done; npx vitest run <files> --reporter=dot; rm -rf /c/Projects/.vitest-lock`. Never run the full suite, e2e or build locally, except the one e2e spec in Task 9, run from the main checkout as that task describes.
- **Commits:** no `Claude-Session:` trailer, no URLs, no `Closes #`. Cite §3 in commits. `Closes #85` goes only in the PR body.
- **`task-manager.tsx` size:** it sits exactly at its baseline (2079). The wiring may add at most 3 lines. Task 7 raises `docs/baselines/file-sizes.json` by hand to the measured value and says so in the §491 status. Never run `size:check --update`.

## Review Focus

1. **A task edited while the preview is open.** The user expects their edit to survive, and the stale item to be skipped with a toast. Pinned in Task 3 (`skips an item whose target row changed since the proposal`) and Task 6 (`apply after a concurrent edit keeps the edit`).
2. **Unticking a new task or split piece that a link points at.** The user expects that link not to be written, and no dangling dependency. Pinned in Task 3 (`drops a ticked link whose endpoint is unticked`) and Task 5 (`disables a link while its endpoint is unticked`).
3. **The model returns a link chain that forms a cycle only once the new tasks exist.** The user expects that link refused, not a cyclic graph. Pinned in Task 2 (`refuses a link that cycles through a proposed new task`).
4. **Starting from chat while another view is open, or in a popout.** From another view the user expects the modal to open over it; in a popout, a clear refusal. Pinned in Task 6 (`open() from any view shows the modal`) and Task 8 (`refuses in a popout`).
5. **Pressing Undo after an apply that created tasks.** The user expects the existing tasks to revert and the new tasks to stay, with nothing duplicated. Pinned in Task 6 (`undo reverts edits and leaves created rows single`).

---

### Task 1: Engine — types, context, tool schema, parser

**Files:**
- Create: `src/app/wbs-plan/wbs-plan.ts`
- Test: `src/app/wbs-plan/wbs-plan.parse.test.ts`

**Interfaces — produces:**

```ts
export const MAX_WBS_ITEMS = 60;
export const MAX_SPLIT_PIECES = 6;
export const MAX_WBS_ESTIMATE_MINUTES = 9600;
export type WbsTarget =
  | { kind: "task"; id: number }
  | { kind: "ref"; ref: string }
  | { kind: "piece"; taskId: number; piece: number }; // piece is 1-based; piece 1 = the original row
export type RawWbsItem =
  | { kind: "split"; taskId: number; pieces: { taskName: string; description?: string; estimateMinutes?: number }[]; why: string }
  | { kind: "regroup"; taskId: number; group: string; why: string }
  | { kind: "newTask"; ref: string; taskName: string; dueDate: string; group?: string; description?: string; assignee?: string; estimateMinutes?: number; why: string }
  | { kind: "estimate"; target: WbsTarget; estimateMinutes: number; why: string }
  | { kind: "link"; from: WbsTarget; to: WbsTarget; why: string }; // FS: `from` must finish before `to` starts
export interface ParsedWbsProposal { items: RawWbsItem[]; truncated: boolean }
export interface WbsContextArgs { tasks: readonly Task[]; scopeIds: ReadonlySet<number>; milestones: readonly Milestone[]; project: ProjectMeta | undefined }
export function buildWbsContext(args: WbsContextArgs): string;
export function buildWbsSystemPrompt(): string;
export const PROPOSE_WBS_TOOL: { name: "propose_wbs_changes"; description: string; input_schema: object };
export function parseWbsProposal(input: unknown): ParsedWbsProposal | null;
```

**Rulings for Task 1:**

- **JSON encoding of a target:** an object with exactly one of `taskId` (number), `ref` (string), or `taskId` plus `piece` (integer ≥ 1). The parser maps it to `WbsTarget`. Any other shape drops the item.
- **Context contents:**
  - the project's name, `startDate` and `endDate`;
  - the distinct non-empty groups;
  - the milestones, by name and date;
  - every task, each marked `[in scope]` or not;
  - per task: id, name, group, status, assignee, `startDate`/`dueDate`, `originalEstimateMinutes`, dependency ids, and the plain-text description cut to 300 characters (strip the tags the way `buildAllocContext` handles text).
- **Context caps:** at most 400 tasks. In-scope tasks come first, and a final line says how many were omitted.

- [ ] **Step 1: Write failing tests** in `wbs-plan.parse.test.ts`.
  - `parseWbsProposal` returns `null` for a non-object, and for a missing `items` array.
  - It keeps each of the five kinds with its fields, and drops an item with an unknown `kind` or a missing required field (it does not throw).
  - It maps the target objects `{taskId:3}` → `{kind:"task",id:3}`, `{ref:"a"}` → `{kind:"ref",ref:"a"}` and `{taskId:3,piece:2}` → `{kind:"piece",taskId:3,piece:2}`.
  - It drops a link whose target is `{}` or has both `taskId` and `ref`.
  - It cuts the list to `MAX_WBS_ITEMS` and sets `truncated: true` when more items arrive.
  - `buildWbsContext` contains `[in scope]` only for the scope ids, lists the milestones, and caps a 401-task list with an omitted-count line.
  - `PROPOSE_WBS_TOOL.name === "propose_wbs_changes"`.
- [ ] **Step 2: Run them and expect FAIL** (module not found).
- [ ] **Step 3: Implement the exports above.** Model the system prompt on `buildAllocSystemPrompt`. It must state the four operations, that the tool never deletes, cancels or overwrites estimates, the item cap, and that it should prioritise rather than enumerate.
- [ ] **Step 4: Run the tests and expect PASS.** Then run `npx tsc --noEmit` and eslint on both files: exit 0.
- [ ] **Step 5: Commit** with `feat: optimize_wbs engine — context, tool schema, parser (§3)`.

### Task 2: Engine — grounding

**Files:**
- Modify: `src/app/wbs-plan/wbs-plan.ts`
- Test: `src/app/wbs-plan/wbs-plan.ground.test.ts`

**Interfaces:**

- **Consumes:** Task 1's types.
- **Produces:**

```ts
export type WbsSkipReason =
  | "unknownTask" | "closedTask" | "jiraTask" | "outOfScope" | "badPieces" | "overCap"
  | "emptyName" | "badDate" | "badEstimate" | "hasEstimate" | "duplicateRef"
  | "selfLink" | "duplicateLink" | "unresolvedRef" | "cycle" | "staleTask";
export interface SkippedWbsItem { item: RawWbsItem; reason: WbsSkipReason }
export interface GroundedWbsItem {
  key: string;                    // stable within one proposal, e.g. "i3"
  item: RawWbsItem;               // sanitized copy
  baseRows: readonly Task[];      // the existing rows it touches, by reference, as seen at grounding
  requires: readonly string[];    // keys of the items whose untick disables this one (links → their newTask/split endpoints)
}
export interface WbsScope { taskIds: ReadonlySet<number> }
export interface GroundedWbsProposal { items: GroundedWbsItem[]; skipped: SkippedWbsItem[]; truncated: boolean }
export function groundWbsProposal(raw: ParsedWbsProposal, liveTasks: readonly Task[], scope: WbsScope): GroundedWbsProposal;
```

**Rulings for Task 2:**

- `truncated` carries over from the parser, so the overflow is reported. Items past the cap are counted as `overCap` by the parser path.
- **Estimates:** an `estimate` aimed at an existing task that has `originalEstimateMinutes` set is `hasEstimate`. One aimed at a `ref` or piece is fine.
- **Duplicates:** a second `regroup` or `split` of the same task is `duplicateRef`. So is a repeated `newTask` `ref`.
- **Cycle check:** build the post-proposal graph. That is the live tasks, plus every kept new task and split piece under provisional negative ids (−1, −2, …), plus every kept link. Then call `wouldCreateDependencyCycle` (`sanitize-core.ts`) for each link, in proposal order, adding the links that pass. A link that closes a cycle is `cycle`.

- [ ] **Step 1: Write failing tests**, one per reason, each asserting `skipped[i].reason`:
  - `unknownTask`;
  - `closedTask`, with a Done task and with a Cancelled task;
  - `jiraTask` (`jiraKey: "PRJ-1"`);
  - `outOfScope` (id not in `scope.taskIds`);
  - `badPieces`, with 1 piece and with 7;
  - `emptyName`, for a whitespace name on a piece and on a newTask;
  - `badDate` (`"2026-02-30"`);
  - `badEstimate`, for `0`, `-5`, `1.5` and `9601` (and `9600` is kept);
  - `hasEstimate`;
  - `duplicateRef`;
  - `selfLink`;
  - `duplicateLink`, against an existing dependency and against an earlier proposed link;
  - `unresolvedRef`, for an unknown ref and for `piece: 3` on a two-piece split;
  - `cycle`: the test `refuses a link that cycles through a proposed new task`. Task 2 depends on 1 today; the proposal adds `newTask a`, a link 2 → a, and a link a → 1. The last link is `cycle` and the first is kept.
  - Also:
    - a kept split's `baseRows[0]` is the very live row object;
    - a link to a piece ≥ 2 has `requires` containing the split's key;
    - a link to a `ref` requires that newTask's key;
    - a description containing `<script>` comes back sanitized.
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Implement `groundWbsProposal`.**
- [ ] **Step 4: Run them and expect PASS.** Then run tsc and eslint: exit 0.
- [ ] **Step 5: Commit** with `feat: optimize_wbs grounding (§3)`.

### Task 3: Engine — apply

**Files:**
- Modify: `src/app/wbs-plan/wbs-plan.ts`
- Test: `src/app/wbs-plan/wbs-plan.apply.test.ts`
- Test: `src/app/wbs-plan/wbs-plan.property.test.ts`

**Interfaces:**

- **Consumes:** `GroundedWbsItem`, `WbsScope` and `groundWbsProposal`.
- **Produces:**

```ts
export function countNewRows(ticked: readonly GroundedWbsItem[]): number; // newTask count + Σ(split pieces − 1)
export interface WbsApplyResult {
  nextTasks: Task[];
  created: Task[];
  editedBefore: Task[];   // existing rows as they were
  editedAfter: Task[];    // the same rows after
  applied: number;        // items actually written
  skippedStale: number;   // ticked items dropped at apply time
}
export function applyWbsProposal(prevTasks: readonly Task[], ticked: readonly GroundedWbsItem[], newIds: readonly number[], today: string, scope: WbsScope): WbsApplyResult;
```

**Rulings for Task 3:**

- **Stale items:** an item is stale when any `baseRows[k]` is no longer the identical object in `prevTasks` (found by id), meaning it was edited or removed. It is also stale when re-grounding its raw item against `prevTasks` and `scope` no longer keeps it (for example, the task was closed or became Jira-linked). Stale items count toward `skippedStale`.
- **Requirements:** a ticked item whose `requires` names a key that is not ticked, or that went stale, is dropped too, without being counted in `skippedStale`.
- **New ids:** `newIds` are consumed in proposal order. The new-task row shape follows `createTask` in `use-chat-dispatcher.ts`: `status: DEFAULT_TASK_STATUS`, `blockers: ""`, `inquiriesSent: 0`, `createdDate` and `lastUpdateDate` set to `today`, `labels` (inherited for pieces, else `[]`), `assigneeEmail` (inherited, else `""`), `priority` (inherited, else the sanitizer's default) and `originalEstimateMinutes`.
- **Links:** a link appends `{ taskId: <from id>, type: "FS" }` to the `to` row's `dependencies`. A link into an existing row makes that row an edited row.
- **Edited rows:** every existing row that changes gets `lastUpdateDate: today` and appears once in `editedBefore`/`editedAfter`.
- **Purity:** the function never mutates its inputs.

- [ ] **Step 1: Write failing tests:**
  - **Splits:**
    - `split keeps the original id and appends the other pieces`: the original id now carries piece 1's name and estimate, and piece 2 is a new row with `id === newIds[0]` that inherits the assignee, group, labels, priority and dueDate;
    - `split piece 1 keeps notes, time booked and dependencies`.
  - **Existing rows:** a regroup changes only `group` and `lastUpdateDate`; an estimate fills an empty estimate.
  - **Links:**
    - a link from an existing row to a new row lands on the new row's `dependencies`;
    - `drops a ticked link whose endpoint is unticked`: the split is unticked and its piece-2 link is ticked; the result has no dependency on a missing id, and `applied` excludes the link.
  - **Stale items:**
    - `skips an item whose target row changed since the proposal`: replace the target row with an edited copy in `prevTasks`; the result is `skippedStale === 1`, and that row is untouched;
    - a target closed since the proposal is skipped as stale.
  - **Bookkeeping:**
    - `countNewRows` for 1 newTask plus a 3-piece split is `3`;
    - `editedBefore` and `editedAfter` hold the same ids in the same order, and created rows are absent from both;
    - inputs are left unmutated (`Object.freeze` the fixtures).
- [ ] **Step 2: Write the property test** `wbs-plan.property.test.ts`, with `fc.assert` and a fixed `seed`.
  - **Generator:** for any generated task list, mix in some Done, Cancelled and Jira tasks. For any generated raw proposal over its ids, run it through ground → tick all → apply.
  - **Assertions:**
    - every input id is still present;
    - every closed or Jira row is the identical object;
    - no row outside `scope.taskIds` changes, other than created rows.
  - Use `fc.integer`-based dates: never `fc.date()`, and never the regex `/s` flag (AGENTS.md).
- [ ] **Step 3: Run both test files and expect FAIL.**
- [ ] **Step 4: Implement `countNewRows` and `applyWbsProposal`.**
- [ ] **Step 5: Run them and expect PASS.** Then run tsc and eslint: exit 0.
- [ ] **Step 6: Commit** with `feat: optimize_wbs apply (§3)`.

### Task 4: The forced call

**Files:**
- Create: `src/app/wbs-plan-call.ts`
- Test: `src/app/wbs-plan-call.test.ts`

**Interfaces:**

- **Consumes:** `PROPOSE_WBS_TOOL`, `buildWbsSystemPrompt` and `parseWbsProposal`.
- **Produces:**

```ts
export async function runWbsProposal(context: string, ai: { apiKey: string; model: string }, instruction: string, signal?: AbortSignal): Promise<ParsedWbsProposal>;
```

It mirrors `runAllocProposal` (`alloc-plan-call.ts`): the user message is `${context}\n\n---\nUSER REQUEST: ${instruction}`, `maxTokens: 8192`, and it throws `Error("parse")` when the parse returns null.

- [ ] **Step 1: Write failing tests**, with `runForcedToolCall` mocked through `vi.mock("./ai-forced-call")`:
  - it passes `toolName: "propose_wbs_changes"`, the system prompt and `maxTokens: 8192`;
  - it returns the parsed proposal;
  - it throws `"parse"` on `{}`;
  - it passes the signal through;
  - the user message contains `USER REQUEST: split big ones`.
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and expect PASS.** Then run tsc and eslint: exit 0.
- [ ] **Step 5: Commit** with `feat: optimize_wbs forced proposal call (§3)`.

### Task 5: The preview modal

**Files:**
- Create: `src/app/wbs-plan-modal.tsx`
- Test: `src/app/wbs-plan-modal.test.tsx`
- Modify: `src/app/i18n.ts` and `src/app/i18n.de.ts` (the modal's `wbsPlan*` keys)

**Interfaces:**

- **Consumes:** `GroundedWbsItem`, `SkippedWbsItem` and `WbsSkipReason`.
- **Produces:**

```ts
export interface WbsPlanModalProps {
  lang: Lang;
  tasksById: ReadonlyMap<number, Task>;     // for before-values and names
  items: readonly GroundedWbsItem[];
  skipped: readonly SkippedWbsItem[];
  truncated: boolean;
  selected: ReadonlySet<string>;            // ticked keys
  onToggle: (key: string) => void;
  onApply: () => void;
  onCancel: () => void;
  applying: boolean;
}
export function WbsPlanModal(props: WbsPlanModalProps): JSX.Element;
```

**Rulings for Task 5:**

- **Primitives:** build on the shared `Modal` and `Button` primitives, and use checkboxes with row-unique accessible names (see `docs/AGENTS/accessibility.md`, `buildRowTokens`). Never hand-roll a dialog.
- **Sections:** the order is splits, regroups, new tasks, estimates, links. A section with no items is not rendered.
- **Count:** the apply button's count is the number of ticked items that are not disabled, through `tPlural`.
- **Disabled links:** a link whose `requires` includes an unticked key renders its checkbox disabled, with the reason text `wbsPlanLinkNeedsEndpoint`.
- **Footer:** shows the `wbsPlanUndoNote` text.
- **Truncation:** when `truncated` is set, a line shows `wbsPlanTruncated`.
- **"Not applied" list:** a `<details>` holding one line per skipped item, with the `wbsPlanSkip_<reason>` text. All 16 reasons get EN and DE keys.

- [ ] **Step 1: Write failing tests:**
  - every item checkbox reflects `selected`;
  - clicking one calls `onToggle(key)`;
  - `disables a link while its endpoint is unticked` (`toBeDisabled()`, plus its reason text visible);
  - the apply label shows the enabled-ticked count (for example, "Apply 2 changes" when 3 are ticked and one is disabled);
  - apply is disabled at a count of 0;
  - the "Not applied" list shows the reason text for a `cycle` skip;
  - the checkbox accessible names are unique across rows;
  - the split row shows the original name and both piece names.
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Implement the modal and add the keys.** Add the EN keys with the Edit tool. Add the DE keys with a node utf8 script that matches `\r\n`. Then run `npx tsc --noEmit`, which enforces EN/DE parity.
- [ ] **Step 4: Run the tests and expect PASS**, then run eslint: exit 0.
- [ ] **Step 5: Commit** with `feat: optimize_wbs preview modal (§3)`.

### Task 6: The hook — state machine, button, apply, undo, activity

**Files:**
- Create: `src/app/use-wbs-plan.tsx`
- Test: `src/app/use-wbs-plan.test.tsx`
- Modify: `src/app/activity-log.ts` (the `"ai.wbsPlan"` union member and label-map entry), `src/app/activity-message.ts` (`"ai.wbsPlan": { base: "activityAiWbsPlan", slot: 0 }`), and `i18n.ts` / `i18n.de.ts` (`activityAiWbsPlan` with `{0}`, plus the button and toast keys)

**Interfaces:**

- **Consumes:** `runWbsProposal`, `buildWbsContext`, `groundWbsProposal`, `applyWbsProposal`, `countNewRows`, `WbsPlanModal`, `mintIds`, `AiTriggerButton`, `aiKeyIfEnabled` / `isAiEnabled`, `useToastContext`, `UndoStackApi["capture"]` and `LogActivityAsFn`.
- **Produces:**

```ts
export interface WbsPlanDeps {
  settings: Settings;
  isPopout: boolean;
  lang: Lang;
  capture?: UndoStackApi["capture"];
  logActivityAs?: LogActivityAsFn;
}
export interface WbsOpenRequest { group?: string; instructions?: string }
export interface WbsPlan {
  button: ReactNode;                         // null in a popout
  modal: ReactNode;                          // null while idle
  open(req: WbsOpenRequest): { opened: boolean; tasksInScope: number };
}
export function useWbsPlan(deps: WbsPlanDeps): WbsPlan;
```

**Rulings for Task 6:**

- **Workspace reads:** the hook reads `tasks`, `setTasks`, `milestones`, `project` and `filteredSortedTasks` from `useWorkspace()`. That keeps `task-manager.tsx` to one line.
- **Phases:** `idle | input | thinking | preview | applying`, as in `use-alloc-plan.tsx`.
  - **The button** opens `input`, an optional instructions field, with the scope set to the open ids of `filteredSortedTasks`.
  - **`open(req)` from chat** goes straight to `thinking`.
    - Its scope is the open, non-Jira tasks in `req.group`, or all of them when no group is given.
    - It returns `{ opened: false, tasksInScope: 0 }` in a popout, with the AI off, or with an empty scope.
- **Abort and errors:** the call carries an `AbortController`, which aborts on cancel and on unmount. An abort is detected by `err.name === "AbortError"`, the `use-alloc-plan.tsx` rule. Errors go through `classifyAiError` / `aiKeyMessageKeyForError` and a toast, as "Plan with AI" does.
- **Preview:** on a result, ground it against `tasks`, select every item key, and go to `preview`. With zero items, show the `wbsPlanEmpty` toast and reset.
- **Apply, in the click handler and in this order:**
  1. `const live = tasksRef.current;`
  2. `const ticked = items.filter(selected)`;
  3. `const ids = mintIds("task", live, countNewRows(ticked))`;
  4. `const result = applyWbsProposal(live, ticked, ids, today, scope)`;
  5. `setTasks(prev => applyWbsProposal(prev, ticked, ids, today, scope).nextTasks)`;
  6. `capture?.({ setter: setTasks, kind: "bulk.edit", edited: result.editedBefore, editedAfter: result.editedAfter, fromArray: live, entityKey: "task" })`, only when `editedBefore.length > 0`;
  7. `logActivityAs?.("ai", "ai.wbsPlan", result.applied)`;
  8. the toast `wbsPlanApplied` (count), plus `wbsPlanStaleSkipped` when `skippedStale > 0`;
  9. reset.

  `tasksRef` is a ref kept in sync with `tasks`, the dispatcher's pattern. Step 5 is a pure updater, so StrictMode's double invocation is harmless.
- **The button itself:** `AiTriggerButton` with `idleLabelKey: "wbsPlanButton"` and `SparklesIcon`. It is disabled with a description when AI is off or no key is set. It is `null` in a popout.

- [ ] **Step 1: Write failing tests**, mocking `./wbs-plan-call` and wrapping in the workspace and toast providers the way `use-alloc-plan.test.tsx` does (copy its provider wrapper and its abort test's shape):
  - **The flow:**
    - button → input → propose → preview, with the modal showing the grounded items;
    - apply writes the ticked items: a split creates a new row with a fresh id above every existing id, and the original keeps its id.
  - **Review Focus 1:** `apply after a concurrent edit keeps the edit`. Propose, then edit an unrelated task and the targeted task through `setTasks`, then apply. The unrelated edit survives, the targeted item is skipped, and the stale toast appears.
  - **Review Focus 5:** `undo reverts edits and leaves created rows single`. After an apply with one regroup and one newTask, call the undo stack's undo. The regroup reverts, and the new task exists exactly once.
  - **Review Focus 4:** `open() from any view shows the modal`. `open({})` with the AI on returns `{opened:true, tasksInScope:N}` and renders the modal.
  - **Refusals:**
    - `open` returns `opened:false` in a popout, and with the AI off;
    - the button is `null` in a popout.
  - **Errors and logging:**
    - cancel during `thinking` aborts the signal and shows no error toast;
    - a mocked `AiHttpError(401)` shows the key-error toast;
    - `logActivityAs` is called with `("ai","ai.wbsPlan", applied)`.
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Implement the hook and add the activity kind and keys** (DE through a node utf8 script).
- [ ] **Step 4: Run** `use-wbs-plan.test.tsx`, `activity-log*.test.ts` and `activity-message*.test.ts`: PASS. Then run tsc and eslint: exit 0.
- [ ] **Step 5: Commit** with `feat: optimize_wbs flow hook, apply and undo (§3)`.

### Task 7: Wiring — task-manager, modals block, toolbar

**Files:**
- Modify: `src/app/task-manager.tsx`
  - one line: `const wbsPlan = useWbsPlan({ settings, isPopout, lang, capture: undoApi.capture, logActivityAs });`, placed before `useChatDispatcherWiring`;
  - `wbsPlanModal: wbsPlan.modal` added to an existing line of the `buildAppModalsBlock({…})` call;
  - `aiOptimizeButton={wbsPlan.button}` on `tasksSectionEl`.
- Modify: `src/app/app-modals-block.tsx` (an `wbsPlanModal: ReactNode` dep, rendered after `RaidCreateHost`, ungated, since the hook already returns null in a popout)
- Modify: `src/app/app-modals-block.test.tsx`
- Modify: the tasks-section prop chain down to `TasksToolbar` (`tasks-section.tsx`, `tasks-section-toolbar.tsx` `TasksToolbarProps.aiOptimizeButton?: ReactNode`), rendered first in the control row
- Modify: `src/app/tasks-section.test.tsx` (button order)
- Modify: `docs/baselines/file-sizes.json` and the `docs/open-followups.md` §491 status (one sentence: the measured new length, and why it grew)

**Interfaces:**

- **Consumes:** `WbsPlan` from Task 6.
- **Produces:** nothing new.

- [ ] **Step 1: Write failing tests:**
  - `app-modals-block.test.tsx` gains `wbsPlanModal` in `makeDeps`, plus a test that it renders, and renders in a popout too;
  - `tasks-section.test.tsx` gains a test that a passed `aiOptimizeButton` is the first control in the toolbar row, through `expectButtonOrder` from `src/test/toolbar-order.ts`, with the existing trailing group still `contiguous: true`.
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Wire it.**
- [ ] **Step 4: Measure** with `node -e "console.log(require('fs').readFileSync('src/app/task-manager.tsx','utf8').split('\n').length)"`. It must be ≤ 2082. Set that number in `file-sizes.json`, add the §491 sentence, and run `npm run size:check`: exit 0.
- [ ] **Step 5: Run** `app-modals-block.test.tsx`, `tasks-section*.test.tsx` and every `task-manager*.test.tsx` (the lock covers one run): PASS. Then run tsc, eslint, `followups:index:check` and `followups:status:check`: exit 0.
- [ ] **Step 6: Commit** with `feat: wire optimize_wbs into Open Points and the modals block (§3)`.

### Task 8: The chat tool

**Files:**
- Modify: `src/app/chat-tool-defs.ts` (an `optimize_wbs` entry: optional `group` (string) and `instructions` (string); the description says it opens a reviewable proposal and writes nothing until the user confirms)
- Modify: `src/app/chat-tools.ts` (`ToolDispatcher.openWbsPlan(req: { group?: string; instructions?: string }): { opened: boolean; tasksInScope: number }`, and a `case "optimize_wbs"` that sanitizes `group` with `sanitizeGroup` and `instructions` as a string capped at 1000 characters, then returns the result; when `opened` is false it throws `optimize_wbs is not available here (popout window, AI off, or no tasks in scope)`)
- Modify: `src/app/use-chat-dispatcher.ts` (a `ChatDispatcherArgs.openWbsPlan` field, wired into the returned dispatcher; it throws `popoutReadOnly` when `args.isReadOnly`, mirroring `createTask`)
- Modify: `src/app/use-chat-dispatcher-wiring.ts` (forward `openWbsPlan`; `satisfies ForwardedArgs` makes this a tsc error until it is done)
- Modify: `src/app/task-manager.tsx` (`openWbsPlan: wbsPlan.open`, added to an existing line of the `useChatDispatcherWiring({…})` call; re-measure against Task 7's number)
- Modify: `src/app/view-ai-scope.ts` (add `"optimize_wbs"` to the Open Points view's `toolHints`)
- Tests: `src/app/chat-proposal.test.ts` (add `optimize_wbs` to `NON_WRITE_NAMES`), `src/app/chat-tools.test.ts`, and `src/app/use-chat-dispatcher-wiring.test.tsx`

**Interfaces:**

- **Consumes:** `WbsPlan.open`.
- **Produces:** `ToolDispatcher.openWbsPlan`.

- [ ] **Step 1: Write failing tests:**
  - `runTool("optimize_wbs", {group:"Build", instructions:"x"})` calls `openWbsPlan({group:"Build", instructions:"x"})` and returns its result;
  - an `opened:false` result throws the message above;
  - `refuses in a popout`: the dispatcher with `isReadOnly: true` throws `popoutReadOnly`, and `openWbsPlan` is not called;
  - `chat-proposal.test.ts`'s "every live tool is classified exactly once" passes with `optimize_wbs` in `NON_WRITE_NAMES`, and `shouldStage` treats two `optimize_wbs` calls as non-staging;
  - the wiring forwards `openWbsPlan` (the wiring test's forwarded-field pattern).
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the touched test files: PASS. Then run tsc, eslint, `npm run size:check` and `docs:symbols:check`: exit 0.
- [ ] **Step 5: Commit** with `feat: optimize_wbs chat tool (§3)`.

### Task 9: Docs, CHANGELOG, register, eye-check spec, mutation run

**Files:**
- Modify: `docs/AGENTS/ai-assistant.md` (add `optimize_wbs` to the tool list: it opens a proposal, is not an entity write, and points at `wbs-plan/`)
- Modify: `CHANGELOG.md` (Unreleased → Added: one entry in user language, e.g. "**Optimize with AI** in Open Points proposes splits, regroups, missing tasks, estimates and links; you tick what to keep before anything changes.")
- Modify: `docs/open-followups.md` (close §3, per the file's closure convention; rebuild the index with `node scripts/rebuild-followup-index.mjs`)
- Create: `e2e/wbs-plan-eye.spec.ts` (seeded with `e2e/seed.ts`; the Anthropic call is routed to a canned `propose_wbs_changes` tool_use the way `e2e/ai-chat-tool-call.spec.ts` stubs it; screenshots of the preview, one with a link disabled, go to the scratchpad)

- [ ] **Step 1: Mutation run** against `wbs-plan.ts` and `use-wbs-plan.tsx`, on a green base, one mutant at a time, restored after each. It covers the closed exclusion, the Jira exclusion, the scope check, the `hasEstimate` rule, the cycle check, the stale-row identity check, the `requires` drop, piece 1 keeping its id, and capture excluding created rows. Every mutant must be killed. Add a test for any survivor, then re-run.
- [ ] **Step 2: Write the docs, the CHANGELOG entry and the register closure.** Then run `followups:index:check`, `followups:status:check`, `followups:workitems:check`, `followups:github:check`, `docs:claims:check`, `docs:symbols:check` and `npm run test:run -- scripts` (the changelog check, if present): exit 0.
- [ ] **Step 3: Eye-check spec.** Write it, then run it once from the main checkout against the running dev server: `PLAYWRIGHT_REUSE_SERVER=1 npx playwright test e2e/wbs-plan-eye.spec.ts --project=chromium --workers=1`. Copy the spec in, back up any file you overwrite, restore it after, and verify the restore with `cmp`. Hand the screenshots to the owner for the eye check.
- [ ] **Step 4: Commit** with `docs: optimize_wbs docs, changelog, register closure, eye-check spec (§3)`.
