# Inline "Ask Claude" per-item edit — SP2 (RAID · Change · Milestone · Stakeholder)

**Goal:** Extend the inline natural-language edit popover (shipped for tasks in SP1, v0.165.0) to RAID items, change requests, milestones, and stakeholders — one generic engine driven by a per-entity descriptor, tasks refactored onto it.

**Context:** SP1 built plan-then-apply inline edit for tasks: a per-row ✨ popover takes an NL instruction, makes ONE bounded `callClaude` proposing `tool_use` blocks (no agentic loop), renders a preview diff, and on confirm replays each block through the existing `runTool` dispatcher (per-entity `sanitizeX`). All four target entities already have full `update_*`/`delete_*`/`create_*` AI tools + field schemas in `chat-tool-defs.ts`. SP2 surfaces the same popover on their rows and generalizes the two task-hardcoded cores (`plan.ts`, `use-inline-ai-edit.ts`).

**Approved decisions:**
- All four entities in **one SP**.
- **Architecture A — generic engine + per-entity descriptor**; refactor SP1 tasks onto it (matches the `useEntityCalendarPush<T>` calendar-generic precedent; the enum/diff guards are pure validation, safe to parameterize — unlike the SSRF guards AGENTS.md warns against).
- Zero new AI tools, Workspace fields, or backend write paths. Every apply re-runs the dispatcher's per-entity `sanitizeX`.

---

## Architecture

`InlineEntity = "task" | "raid" | "change" | "milestone" | "stakeholder"`.

### Modules

**`inline-ai-edit/entity-descriptor.ts`** *(new, pure, i18n-free)*
```ts
export type InlineEntity = "task" | "raid" | "change" | "milestone" | "stakeholder";

export interface EnumGuard { field: string; valid: (value: string, item: unknown) => boolean; }

export interface EntityDescriptor<T extends { id: number }> {
  entity: InlineEntity;
  updateTool: string;            // e.g. "update_raid_item"
  deleteTool: string;            // e.g. "delete_raid_item"
  wsKey: keyof Workspace;        // e.g. "raid" — for id grounding + delete labels
  diffFields: string[];          // EXACTLY the dispatcher's writable set for updateTool
  numberFields: ReadonlySet<string>; // fields coerced to number on apply
  arrayFields: ReadonlySet<string>;  // comma-split string -> string[] on apply (e.g. task labels)
  enumGuards: EnumGuard[];       // reject out-of-enum values the dispatcher would silently drop
  titleOf: (item: T) => string;  // display label ("taskName"/"title"/"name")
  gate?: (item: T) => boolean;   // extra per-entity enable clause (task: !jiraKey)
}

export const INLINE_DESCRIPTORS: { [K in InlineEntity]: EntityDescriptor<never> };
```

**`inline-ai-edit/plan.ts`** *(generalize)* — `describeEntityCalls(blocks, { descriptor, item, ws })` replaces the task-hardcoded `describeToolCalls`. Same rules, descriptor-driven:
- `updateTool` block whose `id !== item.id` → `rejected` (unknown-id vs unsupported by whether the id exists in `ws[wsKey]`).
- For each `f in descriptor.diffFields` present in `input`: string-compare `before`/`after`; skip no-ops; run any `enumGuards[f]` → `rejected: "bad-input"` on failure, else push to `updates`.
- `create_*` tools (any of the five) → `creates` (cross-entity creates allowed).
- `delete_*` tools: the entity's OWN `deleteTool` restricted to `item.id`; cross-entity deletes allowed; unknown id → `rejected`.
- `describeToolCalls(blocks, { task, ws })` kept as a thin wrapper = `describeEntityCalls(blocks, { descriptor: INLINE_DESCRIPTORS.task, item: task, ws })` so SP1's `plan.test.ts` + `plan.property.test.ts` stay green unchanged.
- `EditPlan`/`FieldDiff`/`NewItem`/`Deletion`/`Rejected`/`isEmptyPlan` unchanged.

**`use-inline-entity-edit.ts`** *(generalize `use-inline-ai-edit.ts`)* — same state machine (`idle→thinking→preview|clarify→applying→error`), typed over `InlineEntity`:
- `deps` gains `descriptor` + `item: T`-agnostic `activeItem`. `aiEditEnabled(item) = isAiEnabled(ai) && !isPopout && !!apiKey.trim() && (descriptor.gate?.(item) ?? true)`.
- `reqIdRef` stale-response guard, partial-apply `applied` count, coerce-on-apply — all preserved. `coerceField` reads `descriptor.numberFields`/`arrayFields` instead of the hardcoded `labels` special-case.
- `apply()` reconstructs the update patch from accepted diffs with `patch.id = activeItem.id` (model id can't redirect).
- `useInlineAiEdit(deps)` (task signature from SP1) kept as a thin wrapper binding the task descriptor, so `use-inline-ai-edit.test.tsx` stays green.

**`inline-ai-edit-call.ts`** *(generalize)* — `callInlineEdit({ entity, item, itemLabel, instruction, snapshot, guides, ... })`. Prompt: "You are editing this <entity>: <itemLabel>. …". Security unchanged: never logs/echoes apiKey or body; thrown errors carry only HTTP-status digits or `"parse"`.

**`inline-ai-edit-popover.tsx`** *(generalize)* — prop `task: Task` → `itemTitle: string` + `entityLabel: string`. Header shows `entityLabel`; the truncated subline shows `itemTitle`. a11y unchanged (autofocus via ref, dialog + input aria-labels, stable `cancel`).

**`use-entity-inline-ai-edit.tsx`** *(new, ONE generic glue hook, coverage-excluded UI glue)* — replaces the task-only `use-tasks-inline-ai-edit.tsx` (which becomes a thin `entity="task"` call, or is folded in). Signature `useEntityInlineAiEdit(entity, deps) → { onAiEdit, aiEditEnabled, popover }`. Wraps `useInlineEntityEdit` with the pane adapters (toast, AI-usage naming, effective key via `aiKeyIfEnabled`) and owns the popover element. Reads `useWorkspace()` for `ws`.

### Data flow (unchanged from SP1)
row ✨ → `openFor(item)` → NL input → one bounded `callInlineEdit` → `describeEntityCalls` → preview diff → confirm → `runTool(dispatcher, tool, patch)` per block → `sanitizeX` inside the dispatcher.

---

## Per-entity descriptors

`diffFields` = **exactly** the dispatcher's writable set for that `update_*` tool. The tool DEF in `chat-tool-defs.ts` exposes candidate fields, but the DISPATCHER (`use-chat-dispatcher.ts`) is the source of truth — during implementation each `diffFields` is verified ⊆ the dispatcher's actual `cleanPatch`/write set, and a guard test enforces it (see Testing). Relational id-list fields (`linkedTaskIds`, `causedByRaidIds`, `stakeholderIds`, `linkedRaidIds`) are EXCLUDED from `diffFields` (they are not friendly scalar diffs — same reason SP1 excluded them; the model can still set them via a `create_*` related item, not an inline field diff).

Candidate `diffFields` (scalar/enum/date/number only; final set pinned to the dispatcher during Task 1):

| Entity | updateTool / deleteTool | candidate diffFields | numberFields | enumGuards |
|---|---|---|---|---|
| task | `update_task`/`delete_task` | taskName, assignee, assigneeEmail, dueDate, status, priority, notes, blockers, group, labels | — | status (`TASK_STATUSES`), priority (`PRIORITIES`) |
| raid | `update_raid_item`/`delete_raid_item` | title, description, category, owner, ownerEmail, severity, probability, impact, status, mitigation, raisedDate, targetDate, closedDate | probability, impact | category (`RAID_CATEGORIES`), severity (`RAID_SEVERITIES`), status (category-valid via `sanitizeRaidItem`'s per-category set) |
| change | `update_change`/`delete_change` | title, description, type, status, impact, impactDescription, scheduleImpactDays, costImpact, requestedBy, raisedDate, decisionBy, decisionDate, resolutionNotes | scheduleImpactDays, costImpact | type (`CHANGE_TYPES`), status (`CHANGE_STATUSES`), impact (`RAID_SEVERITIES`) |
| milestone | `update_milestone`/`delete_milestone` | name, date, description, achievedDate | — | — |
| stakeholder | `update_stakeholder`/`delete_stakeholder` | name, organization, title, email, category, influence, interest, notes | — | category (`STAKEHOLDER_CATEGORIES`), influence/interest (`INFLUENCE_INTEREST_LEVELS`) |

`arrayFields` = `{ labels }` for task only (the sole array field currently in any `diffFields`).

**RAID status guard** is category-dependent: `valid(status, item) => sanitizeRaidItem`-style per-category status set for `item.category`. Implemented by reusing the existing per-category status lists in `types.ts`/`sanitize`, not a flat `ALL_RAID_STATUSES` membership (a Risk-only status on an Issue must reject).

---

## Wiring per panel

Each panel gets the ✨ affordance next to its existing per-row edit trigger + mounts the shared popover once (single active edit per panel).

- **RAID** (`raid-panel.tsx` → `raid-panel-rows.tsx`/`RaidTable`): thread `onAiEdit`/`aiEditEnabled` into `RaidTable` as props (mirrors the existing `openEdit` prop). Per-row ✨ `<button>` beside the edit button, row-**unique** aria-label `${inlineAiEdit} – ${item.title}`. **RAID is axe-scanned** — label + operability verified. No kanban (table only).
- **Change** (`change-panel.tsx`): ✨ at the row `openEdit(item)` button site; row-unique label `${inlineAiEdit} – ${item.title}`. Eye-verified (not in axe gate).
- **Milestone** (`milestones-panel.tsx`): ✨ at the row `setEditing(m)` trigger; label `${inlineAiEdit} – ${m.name}`. **Milestones is axe-scanned** — verified.
- **Stakeholder** (`stakeholders-panel.tsx`): ✨ at the row `openEdit(item)` button; label `${inlineAiEdit} – ${s.name}`. Eye-verified.
- Each panel calls `useEntityInlineAiEdit("<entity>", deps)` and drops `{popover}` at panel root. `deps.dispatcher` threads from task-manager (the SAME dispatcher chat + tasks already use), plus `settings`, `isPopout`, `lang`, `logActivity`.

### Dispatcher threading
The `ToolDispatcher` is instantiated once in `task-manager` and already threaded to `tasks-section` (SP1). SP2 threads it (or the glue) to the four panels via the existing `workspace-section` → panel prop chain (`WorkspaceSectionProps`). If the dispatcher is not already reachable by a panel, thread it the same way SP1 threaded it to tasks-section.

---

## Gating · security · error handling (parity with SP1, verbatim)

- Gate: `isAiEnabled(ai) && !isPopout && !!apiKey.trim()` + descriptor `gate` (`!jiraKey` is TASK-ONLY, lives in the task descriptor; the four new entities have no Jira link).
- Stale-response `reqIdRef` monotonic guard (slow call resolving after the active item changed is discarded, post-await AND in catch).
- Non-transactional partial-apply honesty: `applied` count; mid-sequence throw with `applied>0` → log + `inlineAiEditPartial` toast + close; `applied===0` → `inlineAiEditApplyFailed` error phase.
- Enum silent-drop: `describeEntityCalls` rejects out-of-enum values → `rejected: "bad-input"`, never a diff Apply won't make.
- Target-only update + own-entity delete; cross-entity create/delete allowed.
- a11y: popover autofocus via ref (not the `no-autofocus`-risky attr), dialog + input aria-labels (not placeholder-only), row-unique ✨ labels, stable `cancel` (`useCallback`).
- Activity: reuse the single `ai.inlineEdit` kind, logged with the entity's id + title (no new `ActivityKind`).
- i18n: reuse existing `inlineAiEdit*` keys; ADD `inlineAiEditEntityRaid`/`…Change`/`…Milestone`/`…Stakeholder` labels (the `entityLabel` shown in the popover header), EN + DE (node utf8 write for `i18n.de.ts` per the CRLF/umlaut rule; these strings are umlaut-free but use node per the rule). Positional placeholders unchanged.

---

## Testing

- **`describeEntityCalls`** (extend `plan.test.ts` + `plan.property.test.ts`): per entity — writable-field diff, enum-guard rejection (incl. RAID category-specific status), target-only update guard, cross-entity create + delete, own-entity delete-by-id, empty plan. Task cases stay green via the wrapper.
- **Descriptor drift guard** (`entity-descriptor.test.ts`): for each entity, assert `diffFields ⊆ ` the dispatcher's actual writable keys (import the dispatcher's per-tool write set, or a shared const it exposes) — catches a descriptor listing a field the dispatcher silently drops.
- **`useInlineEntityEdit`** (extend `use-inline-ai-edit.test.tsx` or a new `use-inline-entity-edit.test.tsx`): stale-response discard, partial-apply honesty, coerce (number + array), for at least task + one new entity (e.g. raid).
- **Popover** (`inline-ai-edit-popover.test.tsx`): renders `itemTitle` + `entityLabel`; existing task assertions adapted.
- **Gates:** `npx tsc --noEmit` (i18n EN/DE parity) · `npm run lint` (max-warnings=0) · `npm run test:run` (full green) · `npm run size:check` (RAID/milestone/change/stakeholder panels may grow — baseline any legit >800 with `--update`, log the reason) · `npm run dup:check` (≤2.4) · `npx playwright test e2e/a11y.spec.ts -g "RAID" -g "Milestones"` (labeled ✨ buttons).

---

## Out of scope

- Kanban ✨ (RAID has no board; tasks already done in SP1).
- ⌘K command palette; NL field-level edit; bulk NL edit.
- New AI tools / Workspace fields / backend write paths / new `ActivityKind`.
- Popouts (gated out).
