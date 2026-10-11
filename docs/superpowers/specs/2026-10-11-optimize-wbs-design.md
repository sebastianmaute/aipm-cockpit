# `optimize_wbs`: AI work-breakdown proposals

**Date:** 2026-10-11
**Status:** Approved design (brainstorm 2026-10-11), pending the implementation plan
**Register:** §3 (#85), owed from R4 (roadmap 4.3b)
**Predecessors:** `2026-07-25-r4-ai-planning-structure-design.md` §5 (deferred the item and its open question)

## Decision

R4 left one question open: is `optimize_wbs` a tool at all, or a prompt affordance over `create_task` / `update_task`? **It is a real tool** (owner decision, 2026-10-11).

The approach is **a separate forced proposal call, modelled on "Plan with AI"** (`use-alloc-plan.tsx`, `alloc-plan-call.ts`, `alloc-plan/alloc-plan.ts`):

- One forced Anthropic call proposes changes.
- A pure engine grounds the proposal against the live task list.
- A preview modal lets the user tick individual items.
- Nothing is written until the user confirms.

Two alternatives were considered and rejected:

- **(B) The chat model writes the proposal inside its own turn.** Rejected: the preview would be cramped in the chat panel, the toolbar button would depend on the AI panel, and the proposal's quality would depend on how much context the chat had already used.
- **(C) Compose the existing create/update/link tools.** Rejected: it has no single grounding step and no whole-proposal preview.

## The current model this works within

These were checked against the tree on 2026-10-11.

- **The WBS is flat.** `Task` (`types.ts`) has no parent and no order field. The only structure is `group` (one level), `labels`, `dependencies` and the estimate minutes. The tool stays flat; nested tasks are out of scope.
- **Duplicates already have a flow.** Merging duplicates is `use-tasks-dedup.tsx`'s job and stays out of scope.
- **The undo engine cannot reverse a create** (`docs/AGENTS/undo.md` "Creates"). Capturing a create duplicates the row, so apply captures updates only.
- **`runForcedToolCall` exists** (`ai-forced-call.ts`), and `alloc-plan-call.ts` is the model call site.
- **`wouldCreateDependencyCycle` exists** (`sanitize-core.ts`), and `set_task_dependencies` uses it.

## Scope

### The four operations (all in v1)

1. **Split** an oversized or vague task into 2–6 pieces.
   - Piece 1 **is the original row**: it keeps its id, notes, time booked, budget-bucket membership and RAID links, and the proposal rewrites its name, description and estimate.
   - Pieces 2 onward are new tasks. They inherit the original's assignee, assignee email, `resourceId`, group, labels, priority and due date.
   - Nothing is deleted or cancelled.
2. **Regroup** a task into an existing group or a new one (`group`).
3. **Fill gaps** with new tasks the plan is missing.
4. **Estimates and links:**
   - An estimate (`originalEstimateMinutes`) is proposed only for a task that has none. An existing estimate is never overwritten.
   - Links are FS only, between any combination of existing tasks, new tasks and split pieces. Links are only ever **added**; existing ones are never removed.

### Which tasks a run sees

- **The toolbar button:** the tasks the Open Points table currently shows, with its filters and search applied.
- **The chat tool:** the whole project, or one group if the user names it.
- **Always excluded from changes:** closed tasks (`isTaskClosed`, i.e. Done or Cancelled) and Jira-synced tasks (`!!task.jiraKey`, which are read-only by the existing rule). They may appear in the context as background.

### Out of scope

- removing links, merging tasks, and deleting or cancelling anything;
- nested tasks or an order field;
- changing Jira-synced or closed tasks;
- auto-applying anything.

## Design

### 1. The proposal and its grounding

**The proposal tool `propose_wbs_changes`** is forced and returns a list of items, up to `MAX_WBS_ITEMS = 60`. Every item carries a short `why`, which the preview shows.

| Kind | Fields |
|---|---|
| `split` | `taskId`, `pieces: { taskName, description?, estimateMinutes? }[]` (2..`MAX_SPLIT_PIECES = 6`) |
| `regroup` | `taskId`, `group` |
| `newTask` | `ref` (temporary key, unique within the proposal), `taskName`, `dueDate`, plus optional `group`, `description`, `assignee`, `estimateMinutes` |
| `estimate` | `target` (a task id or a `ref`), `estimateMinutes` |
| `link` | `from`, `to` (each a task id, a `ref`, or a split piece `{ taskId, piece }`), `type: "FS"` |

**The context** (`buildWbsContext`) holds:

- the project name and dates;
- the existing group names;
- the milestones, by name and date;
- the in-scope tasks: id, name, group, status, assignee, start and due dates, estimate, dependencies, and a plain-text description truncated per task.

It is capped the way `buildAllocContext` caps its context.

**Grounding is a pure function, `groundWbsProposal(raw, liveTasks, scope)`.** The model's output is untrusted. Each item is either kept or dropped with a `SkipReason` the preview lists. An item is dropped when it:

- names an unknown task id, or one that is closed, Jira-synced or outside the scope;
- splits into more than six pieces or fewer than two, or goes past the item cap (the overflow is reported, never silently cut);
- carries a malformed or impossible date;
- carries an estimate that is not a positive whole number of minutes, or is above `MAX_WBS_ESTIMATE_MINUTES = 9600` (20 working days of 8 hours; a bigger piece should be split, not estimated);
- is an estimate on a task that already has one;
- is a link to itself, a duplicate of an existing or proposed link, or a link whose endpoint does not resolve;
- is a link that would create a cycle, judged with `wouldCreateDependencyCycle` against the graph **after the whole kept proposal applies**.

Rich descriptions go through `sanitizeAiRichText`, on the same boundary as every other AI rich-text write (`docs/AGENTS/rich-text.md`). Names and groups go through the existing task sanitizers.

**Files:**

- `src/app/wbs-plan/wbs-plan.ts` is the pure, i18n-free engine: the context, the tool schema, `parseWbsProposal`, `groundWbsProposal` and `applyWbsProposal`.
- `src/app/wbs-plan-call.ts` is the one forced call through `runForcedToolCall`, which never logs the key or the body.

### 2. Preview, apply and undo

**The preview** is `src/app/wbs-plan-modal.tsx`, modelled on `AllocPlanModal`.

- Rows are grouped by kind. Each row has a checkbox (ticked by default), a before/after line and its `why`.
  - A split shows the original name, followed by its pieces.
  - A regroup shows the old group and the new one.
- A link whose endpoint is an unticked new task or split piece is disabled, shows the reason, and is not applied.
- Dropped items sit in a collapsed "Not applied" list, each with its reason.
- The apply button shows the count ("Apply 12 changes").
- The footer says: "Undo reverts the changes to existing tasks; new tasks stay and can be deleted by hand."

**Apply** runs `applyWbsProposal(prevTasks, ticked, mintId, today)` inside **one `setTasks(prev => …)` updater**:

- The ticked items are grounded **again** against `prev`. An item whose task was edited, closed or deleted since the proposal is skipped, and a toast reports how many were skipped. This rules out the snapshot-overwrite class (§698).
- New task ids are minted at apply time from `prev`, never at proposal time (the AGENTS.md id-mint race).
- New tasks get `createdDate` and `lastUpdateDate` set to today and the status `DEFAULT_TASK_STATUS`.
- Split piece 1 keeps its id.
- Apply never removes a row, so it does not arm `allowDestructiveSave`. The arming gate must see no counted delete.

**Undo:** one capture holds every **update** to an existing row (rename, regroup, estimate, added links). Created rows are excluded from the images, per the undo rule above.

**Activity log:** the "Plan with AI" convention applies. That is one `logActivityAs("ai", "ai.wbsPlan", count)` summary entry; `ai.wbsPlan` is a new `ActivityKind`. Like `ai.allocationPlan`, it needs three entries: the union and the label map in `activity-log.ts`, and the message map in `activity-message.ts`. Its EN/DE label takes the count as `{0}`.

### 3. The chat tool, gating and placement

**The chat tool `optimize_wbs`:**

- Its arguments are `group?` and `instructions?`. The `instructions` text is passed into the proposal call (for example "split anything over 3 days").
- **It writes nothing.** It opens the same flow and returns `{ opened: true, tasksInScope }` to the model. It needs no write token and no arming.
- The flow's hook, `src/app/use-wbs-plan.tsx`, runs at the task-manager level, and its modal renders from `modalsBlock` (`app-modals-block.tsx`). So it works from any view, and the remount-swallow trap cannot drop a request.
- In a popout window, the tool returns "not available in a popout window" and the button is hidden.
- Tool definitions go in `chat-tool-defs.ts`, the handler in `chat-tools.ts`, and the wiring in the dispatcher. The tool list in `docs/AGENTS/ai-assistant.md` gains the tool.

**Gating:** the button and the tool work only with the AI master switch on and a key present (`isAiEnabled`, `aiKeyIfEnabled`), the same as "Plan with AI". Otherwise the button is disabled and shows its reason.

**Placement:** "Optimize with AI" (`AiTriggerButton`) leads the Open Points control row (`tasks-section-toolbar.tsx`). That follows the "primary action leads" rule that Planning's AI button (`resources-panel-toolbar.tsx`) and RACI's "Suggest RACI" already set.

**i18n:** every string goes in both `i18n.ts` and `i18n.de.ts`, with real umlauts and a utf8 node write for the DE file.

## Testing

- **Engine (`wbs-plan.test.ts`):**
  - parsing, including malformed and partial output;
  - every `SkipReason`;
  - ref and split-piece resolution;
  - the post-proposal cycle check;
  - split piece 1 keeping its id and its links;
  - ids minted at apply time, with a collision seeded explicitly between proposal and apply;
  - the re-ground at apply time skipping an edited, closed or deleted task.
- **Property test:** for random task lists and proposals, apply never removes a row and never changes a closed or Jira-synced task. It uses a seeded fast-check run.
- **Modal:**
  - checkbox defaults;
  - a link disabled while its endpoint is unticked;
  - the apply count;
  - the "Not applied" list.
- **Hook:** with the forced call mocked, cover propose, preview, apply, the cancel/abort path, and the error-to-toast mapping that "Plan with AI" uses.
- **Chat tool:** it opens the flow with its scope, refuses in a popout, and writes nothing on its own.
- **Mutation-test the guards:** the closed and Jira exclusions, the scope check, the cycle check, the apply-time re-ground, and the no-overwrite rule for estimates.
- **a11y:** Open Points is in `A11Y_VIEWS`, so axe scans the button. The modal needs an eye check by the owner, through a seeded Playwright spec with a mocked proposal.

## Gates to expect

- Every new `.ts` file under `src/app/` is coverage-gated; the engine is logic, so it is tested rather than excluded.
- Adding a toolbar button shifts the Open Points button order: check `expectButtonOrder` users in `tasks-section*.test.tsx`.
- A user-visible feature needs a CHANGELOG entry under Unreleased → Added.
- On merge, §3 closes and #85 is closed in the PR description.
