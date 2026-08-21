# Inline "Ask Claude" per-item edit — SP1 (tasks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user edit a task with a natural-language instruction in a small inline popover — Claude proposes tool calls, the user previews the diff and confirms, and it applies via the existing AI CRUD tools — without opening the chat window.

**Architecture:** Plan-then-apply over the existing tools. One bounded `callClaude` (no agentic loop) returns `tool_use` blocks; a pure `describeToolCalls` turns them into a preview `EditPlan`; on confirm, each block runs through the existing `runTool(dispatcher, …)`. One `useInlineAiEdit` hook + one `InlineAiEditPopover` live in `tasks-section`; an `onAiEdit(task)` callback reaches table rows (via `RowContextValue`) and Kanban cards (via props). Gated on `isAiEnabled && !isPopout && !task.jiraKey`.

**Tech Stack:** React 19 + TS (forked Next.js 16), vitest + fast-check, existing `chat-api.ts` (`callClaude`/`buildSystemPrompt`), `chat-tools.ts` (`runTool`/`ToolDispatcher`), `settings-types.ts` (`isAiEnabled`/`aiKeyIfEnabled`).

---

## File structure

- **Create** `src/app/inline-ai-edit/plan.ts` — pure i18n-free: `EditPlan` types + `describeToolCalls(blocks, ctx)` + `buildGroundingSet`. One responsibility: translate model tool-use blocks → a human preview, grounding ids.
- **Create** `src/app/inline-ai-edit/plan.test.ts` and `plan.property.test.ts`.
- **Create** `src/app/inline-ai-edit-call.ts` — non-hook: `buildInlineEditSystem(...)` + `callInlineEdit(...)` (reuses `callClaude`). Security: never logs/echoes key or body.
- **Create** `src/app/inline-ai-edit-call.test.ts`.
- **Create** `src/app/use-inline-ai-edit.ts` — the state-machine hook.
- **Create** `src/app/use-inline-ai-edit.test.tsx`.
- **Create** `src/app/inline-ai-edit-popover.tsx` — presentational popover.
- **Create** `src/app/inline-ai-edit-popover.test.tsx`.
- **Modify** `src/app/activity-log.ts` — add `ai.inlineEdit` to `ActivityKind` + `ACTIVITY_KIND_TO_KEY`.
- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — new keys.
- **Modify** `src/app/task-row.tsx` — extend `RowContextValue` with `onAiEdit` + `aiEditEnabled`; render the ✨ trigger (hover icon + a menu/inline entry).
- **Modify** `src/app/task-kanban-board.tsx` — thread `onAiEdit`/`aiEditEnabled` to cards; render the ✨ card action.
- **Modify** `src/app/tasks-section.tsx` — instantiate `useInlineAiEdit`, provide `onAiEdit` to rows/cards, render the single `InlineAiEditPopover`.
- **Modify** `src/app/task-manager.tsx` — pass `dispatcher` + `logActivity` to `TasksSection`.
- **Modify** `vitest.config.ts` — add `use-inline-ai-edit.ts` to `coverage.exclude` if it is pure render glue (decide in Task 8).

---

## Task 1: Pure `EditPlan` engine (`inline-ai-edit/plan.ts`)

**Files:**
- Create: `src/app/inline-ai-edit/plan.ts`
- Test: `src/app/inline-ai-edit/plan.test.ts`, `src/app/inline-ai-edit/plan.property.test.ts`

Context: model tool-use blocks look like `{ type:"tool_use", id, name, input }` (`ContentBlock` in `chat-api.ts`). Tool names (from the reference): task `create_task|update_task|delete_task`; raid `create_raid_item|update_raid_item|delete_raid_item`; change/milestone/stakeholder use `create_change|update_change|delete_change` etc. (no `_item`). `Workspace` id lists live on `ws.tasks|raid|milestones|changes|stakeholders`. `Task` fields we diff: `taskName, assignee, dueDate, startDate, status, priority, notes, blockers, group, labels, resourceId`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/inline-ai-edit/plan.test.ts
import { describe, it, expect } from "vitest";
import { describeToolCalls, type ToolUseLike } from "./plan";
import { type Workspace } from "../workspace";

const task = { id: 42, taskName: "Fix login bug", assignee: "Anna", dueDate: "2026-08-12", status: "To Do", priority: "Medium" } as any;
const ws = { tasks: [task], raid: [], milestones: [], changes: [], stakeholders: [] } as unknown as Workspace;

function block(name: string, input: Record<string, unknown>): ToolUseLike {
  return { type: "tool_use", id: "b1", name, input };
}

describe("describeToolCalls", () => {
  it("diffs an update_task on the target task", () => {
    const plan = describeToolCalls([block("update_task", { id: 42, dueDate: "2026-08-15", status: "In Progress" })], { task, ws });
    expect(plan.updates).toEqual([
      { field: "dueDate", before: "2026-08-12", after: "2026-08-15" },
      { field: "status", before: "To Do", after: "In Progress" },
    ]);
    expect(plan.creates).toEqual([]);
    expect(plan.rejected).toEqual([]);
  });

  it("summarises a related create", () => {
    const plan = describeToolCalls([block("create_raid_item", { category: "Risk", title: "Payment timeout" })], { task, ws });
    expect(plan.creates).toEqual([{ entity: "raid", title: "Payment timeout", toolName: "create_raid_item", input: { category: "Risk", title: "Payment timeout" } }]);
  });

  it("rejects an update whose id is not the target task and not in the workspace", () => {
    const plan = describeToolCalls([block("update_task", { id: 999, status: "Done" })], { task, ws });
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([{ toolName: "update_task", reason: "unknown-id", detail: "999" }]);
  });

  it("returns an empty plan for no blocks", () => {
    expect(describeToolCalls([], { task, ws })).toEqual({ updates: [], creates: [], deletes: [], rejected: [] });
  });

  it("ignores read-only tool calls (list_tasks/get_task)", () => {
    const plan = describeToolCalls([block("list_tasks", {})], { task, ws });
    expect(plan).toEqual({ updates: [], creates: [], deletes: [], rejected: [] });
  });
});
```

- [ ] **Step 2: Run it, expect failure** — `npm run test:run -- inline-ai-edit/plan` → FAIL (module missing).

- [ ] **Step 3: Implement `plan.ts`**

```ts
// src/app/inline-ai-edit/plan.ts
//
// Pure, i18n-free. Translate model tool-use blocks into a previewable EditPlan
// for the inline "Ask Claude" task editor. No React, no i18n, no side effects.
import { type Task } from "../types";
import { type Workspace } from "../workspace";

export type ToolUseLike = { type: string; id?: string; name?: string; input?: unknown };

export interface FieldDiff { field: string; before: string; after: string }
export interface NewItem { entity: string; title: string; toolName: string; input: Record<string, unknown> }
export interface Deletion { entity: string; label: string; toolName: string; id: number }
export interface Rejected { toolName: string; reason: "unknown-id" | "bad-input" | "unsupported"; detail: string }
export interface EditPlan { updates: FieldDiff[]; creates: NewItem[]; deletes: Deletion[]; rejected: Rejected[] }

const TASK_DIFF_FIELDS: Array<keyof Task> = [
  "taskName", "assignee", "assigneeEmail", "dueDate", "startDate", "status",
  "priority", "notes", "blockers", "group", "labels", "resourceId",
];

// tool name -> the entity label used in the preview
const CREATE_TOOLS: Record<string, string> = {
  create_raid_item: "raid", create_change: "change",
  create_milestone: "milestone", create_stakeholder: "stakeholder", create_task: "task",
};
const DELETE_TOOLS: Record<string, { entity: string; wsKey: keyof Workspace }> = {
  delete_task: { entity: "task", wsKey: "tasks" },
  delete_raid_item: { entity: "raid", wsKey: "raid" },
  delete_change: { entity: "change", wsKey: "changes" },
  delete_milestone: { entity: "milestone", wsKey: "milestones" },
  delete_stakeholder: { entity: "stakeholder", wsKey: "stakeholders" },
};

function str(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
function titleOf(entity: string, input: Record<string, unknown>): string {
  return str(input.title ?? input.taskName ?? input.name ?? input.description ?? entity);
}

/** Build the plan. `ctx.task` is the row the popover was opened on; `ctx.ws` the
 *  live workspace (for id grounding + delete labels). Read-only tool calls and
 *  unknown tools are dropped; updates that don't target the current task (or a
 *  real workspace id) are rejected, never applied. */
export function describeToolCalls(
  blocks: readonly ToolUseLike[],
  ctx: { task: Task; ws: Workspace },
): EditPlan {
  const plan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [] };
  const taskIds = new Set(ctx.ws.tasks.map((t) => t.id));

  for (const b of blocks) {
    if (b.type !== "tool_use" || typeof b.name !== "string") continue;
    const name = b.name;
    const input = (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>;

    if (name === "update_task") {
      const id = Number(input.id);
      if (id !== ctx.task.id) {
        // An inline edit may only mutate the task it was opened on.
        plan.rejected.push({ toolName: name, reason: taskIds.has(id) ? "unsupported" : "unknown-id", detail: str(input.id) });
        continue;
      }
      for (const f of TASK_DIFF_FIELDS) {
        if (!(f in input)) continue;
        const before = str(ctx.task[f]);
        const after = str(input[f]);
        if (before !== after) plan.updates.push({ field: f, before, after });
      }
      continue;
    }

    if (name in CREATE_TOOLS) {
      const entity = CREATE_TOOLS[name];
      plan.creates.push({ entity, title: titleOf(entity, input), toolName: name, input });
      continue;
    }

    if (name in DELETE_TOOLS) {
      const { entity, wsKey } = DELETE_TOOLS[name];
      const id = Number(input.id);
      const rows = ctx.ws[wsKey] as ReadonlyArray<{ id: number; title?: string; taskName?: string; name?: string }>;
      const found = Array.isArray(rows) ? rows.find((r) => r.id === id) : undefined;
      if (!found) { plan.rejected.push({ toolName: name, reason: "unknown-id", detail: str(input.id) }); continue; }
      plan.deletes.push({ entity, label: str(found.title ?? found.taskName ?? found.name ?? id), toolName: name, id });
      continue;
    }
    // read-only tools (list_*/get_*/get_snapshot) and anything else: ignore.
  }
  return plan;
}

/** True when the plan would write nothing (used to disable Apply / show a note). */
export function isEmptyPlan(p: EditPlan): boolean {
  return p.updates.length === 0 && p.creates.length === 0 && p.deletes.length === 0;
}
```

- [ ] **Step 4: Run tests, expect pass** — `npm run test:run -- inline-ai-edit/plan` → PASS.

- [ ] **Step 5: Property test**

```ts
// src/app/inline-ai-edit/plan.property.test.ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { describeToolCalls, isEmptyPlan } from "./plan";
import { type Workspace } from "../workspace";

const task = { id: 1, taskName: "T", status: "To Do", priority: "Medium", dueDate: "2026-01-01" } as any;
const ws = { tasks: [task], raid: [], milestones: [], changes: [], stakeholders: [] } as unknown as Workspace;

describe("describeToolCalls (property)", () => {
  it("never throws and produces a coherent plan for arbitrary blocks", () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        type: fc.constant("tool_use"),
        name: fc.oneof(fc.constantFrom("update_task", "create_raid_item", "delete_task", "list_tasks", "bogus"), fc.string()),
        input: fc.object(),
      })),
      (blocks) => {
        const plan = describeToolCalls(blocks as any, { task, ws });
        // updates always reference real diffs; creates always carry a toolName.
        expect(plan.creates.every((c) => typeof c.toolName === "string")).toBe(true);
        expect(typeof isEmptyPlan(plan)).toBe("boolean");
      },
    ), { numRuns: 200 });
  });
});
```

- [ ] **Step 6: Run + commit**

```bash
npm run test:run -- inline-ai-edit/plan
git add src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/plan.property.test.ts
git commit -m "feat(inline-ai-edit): pure describeToolCalls EditPlan engine"
```

---

## Task 2: Activity kind + i18n keys

**Files:**
- Modify: `src/app/activity-log.ts` (`ActivityKind` union ~L12-51, `ACTIVITY_KIND_TO_KEY` ~L67)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the activity kind.** In `activity-log.ts`, add `| "ai.inlineEdit"` to the `ActivityKind` union, and an entry to `ACTIVITY_KIND_TO_KEY`: `"ai.inlineEdit": "activityAiInlineEdit"`.

- [ ] **Step 2: Add EN keys** (`i18n.ts`) via the Edit tool (ASCII-safe). Add near the other `ai*` keys:

```ts
  inlineAiEdit: "Ask Claude",
  inlineAiEditTitle: "Ask Claude to edit this task",
  inlineAiEditPlaceholder: "e.g. push due 3 days, set In Progress, assign Marco",
  inlineAiEditThinking: "Claude is working out the changes…",
  inlineAiEditPreview: "Claude will make these changes:",
  inlineAiEditCreate: "New {0}: {1}",
  inlineAiEditDelete: "Delete {0}: {1}",
  inlineAiEditApply: "Apply",
  inlineAiEditNoChanges: "No changes to apply.",
  inlineAiEditClarify: "Claude needs more detail:",
  inlineAiEditError: "Couldn’t reach Claude. Try again.",
  inlineAiEditApplied: "Updated “{0}”",
  activityAiInlineEdit: "AI inline edit",
```

- [ ] **Step 3: Add DE keys** (`i18n.de.ts`) via a node utf8 script (Edit corrupts umlauts/quotes; file is CRLF — match `\r\n`). Insert the identical key set with German values, e.g. `inlineAiEdit: "Claude fragen"`, `inlineAiEditThinking: "Claude ermittelt die Änderungen…"`, `inlineAiEditError: "Claude nicht erreichbar. Bitte erneut versuchen."`, `inlineAiEditApplied: "„{0}“ aktualisiert"`, `activityAiInlineEdit: "KI-Inline-Bearbeitung"`, etc. Use `\uXXXX` for every umlaut (`ä ö ü Ä Ö Ü ß`) and curly quotes.

- [ ] **Step 4: Verify parity + encoding**

```bash
npx tsc --noEmit && npm run test:run -- i18n-encoding
```
Expected: tsc 0 (enforces EN/DE key-set identity), i18n-encoding PASS (no ASCII umlaut subs).

- [ ] **Step 5: Commit**

```bash
git add src/app/activity-log.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(inline-ai-edit): ai.inlineEdit activity kind + i18n keys (EN/DE)"
```

---

## Task 3: Bounded Claude call (`inline-ai-edit-call.ts`)

**Files:**
- Create: `src/app/inline-ai-edit-call.ts`
- Test: `src/app/inline-ai-edit-call.test.ts`

Context: reuse `callClaude(apiKey, model, system, messages, signal)` from `chat-api.ts` — it already POSTs to `api.anthropic.com` with `TOOL_DEFS` and browser headers and returns `{ content: ContentBlock[]; stop_reason; usage }`. We build a scoped system prompt (standard chat prompt + one task-scoped block) and read the `tool_use`/`text` blocks from a SINGLE response (no loop).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/inline-ai-edit-call.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import * as chatApi from "./chat-api";
import { callInlineEdit } from "./inline-ai-edit-call";

afterEach(() => vi.restoreAllMocks());

const task = { id: 42, taskName: "Fix login bug", status: "To Do" } as any;
const snapshot = { today: "2026-07-03", language: "en-US" } as any;

it("returns tool_use blocks and text from a single callClaude response", async () => {
  vi.spyOn(chatApi, "callClaude").mockResolvedValue({
    content: [
      { type: "text", text: "Sure." },
      { type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } },
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 },
  } as any);
  const r = await callInlineEdit({
    apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", lang: "en-US",
    task, instruction: "mark done", snapshot, guides: [], groundInGuides: false,
  });
  expect(r.blocks.map((b) => b.name)).toEqual(["update_task"]);
  expect(r.text).toContain("Sure");
  expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
});

it("propagates the api key + model to callClaude and never returns them", async () => {
  const spy = vi.spyOn(chatApi, "callClaude").mockResolvedValue({ content: [], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } } as any);
  await callInlineEdit({ apiKey: "sk-ant-secret000000000000", model: "claude-y", lang: "en-US", task, instruction: "x", snapshot, guides: [], groundInGuides: false });
  expect(spy.mock.calls[0][0]).toBe("sk-ant-secret000000000000");
  expect(spy.mock.calls[0][1]).toBe("claude-y");
});
```

- [ ] **Step 2: Run, expect fail** — `npm run test:run -- inline-ai-edit-call` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/app/inline-ai-edit-call.ts
//
// Non-hook single-shot call for the inline task editor. Reuses callClaude (which
// already sends TOOL_DEFS + browser headers). NEVER logs/echoes the key or body;
// the caller reads only { blocks, text, usage }. No agentic loop — one request.
import { buildSystemPrompt, callClaude, type ApiUsage, type ContentBlock, type SystemBlock, type ToolUseBlock } from "./chat-api";
import { type Lang } from "./i18n";
import { type OperatingGuide } from "./operating-guide-types";
import { type Task } from "./types";
import { type ToolDispatcher } from "./chat-tools";

export interface InlineEditArgs {
  apiKey: string;
  model: string;
  lang: Lang;
  task: Task;
  instruction: string;
  snapshot: ReturnType<ToolDispatcher["getSnapshot"]>;
  guides: readonly OperatingGuide[];
  groundInGuides: boolean;
  signal?: AbortSignal;
}
export interface InlineEditResult { blocks: ToolUseBlock[]; text: string; usage: ApiUsage }

/** A task-scoped instruction block appended AFTER the cached chat prefix (it is
 *  volatile per-task, so it must not sit inside the cached prefix). */
function scopeBlock(task: Task): SystemBlock {
  const fields = JSON.stringify({
    id: task.id, taskName: task.taskName, assignee: task.assignee, dueDate: task.dueDate,
    startDate: task.startDate, status: task.status, priority: task.priority,
    notes: task.notes, blockers: task.blockers, group: task.group, labels: task.labels,
    resourceId: task.resourceId,
  });
  return {
    type: "text",
    text:
      `INLINE EDIT MODE. You are editing exactly ONE task (below). Use tool calls to ` +
      `make the user's requested change: update_task for this task's fields, and you may ` +
      `create related items (create_raid_item / create_change / create_milestone / ` +
      `create_stakeholder) when asked. Do NOT update or delete any other task. Do NOT ` +
      `chat or explain unless you cannot proceed without more detail. Target task:\n${fields}`,
  };
}

export async function callInlineEdit(args: InlineEditArgs): Promise<InlineEditResult> {
  const system: SystemBlock[] = [
    ...buildSystemPrompt(args.lang, args.snapshot, args.guides, args.groundInGuides),
    scopeBlock(args.task),
  ];
  const res = await callClaude(args.apiKey, args.model, system, [{ role: "user", content: args.instruction }], args.signal);
  const blocks = res.content.filter((b: ContentBlock): b is ToolUseBlock => b.type === "tool_use");
  const text = res.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join(" ").trim();
  return { blocks, text, usage: res.usage };
}
```

Note: confirm the `OperatingGuide` type import path (`operating-guide-types` or wherever `buildSystemPrompt`'s guide param type lives) — match `chat-panel.tsx`'s import. If `ToolUseBlock` is not exported from `chat-api.ts`, export it there (it is defined at L11).

- [ ] **Step 4: Run, expect pass** — `npm run test:run -- inline-ai-edit-call` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/inline-ai-edit-call.ts src/app/inline-ai-edit-call.test.ts
git commit -m "feat(inline-ai-edit): bounded single-shot callInlineEdit"
```

---

## Task 4: State-machine hook (`use-inline-ai-edit.ts`)

**Files:**
- Create: `src/app/use-inline-ai-edit.ts`
- Test: `src/app/use-inline-ai-edit.test.tsx`

Context: one hook instance in `tasks-section` manages the single active edit. It holds `activeTask`, the phase, the plan, and the assistant clarification text. `apply()` runs each planned block through `runTool(dispatcher, name, input)`. Deps passed in (all available in `tasks-section` scope): `dispatcher`, `ai` (`settings.ai`), `apiKey`, `isPopout`, `logActivity`, `showToast`, `ws`, `guides`, `recordUsage`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/use-inline-ai-edit.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as call from "./inline-ai-edit-call";
import { useInlineAiEdit } from "./use-inline-ai-edit";

afterEach(() => vi.restoreAllMocks());

const task = { id: 42, taskName: "Fix login bug", status: "To Do", dueDate: "2026-08-12" } as any;
const ws = { tasks: [task], raid: [], milestones: [], changes: [], stakeholders: [] } as any;

function mkDeps(over: Partial<any> = {}) {
  return {
    dispatcher: { getSnapshot: () => ({ today: "2026-07-03", language: "en-US" }), updateTask: vi.fn(), ...over.dispatcher },
    ai: { enabled: true, apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", groundInGuides: false },
    apiKey: "sk-ant-xxxxxxxxxxxxxxxx",
    isPopout: false, lang: "en-US" as const,
    logActivity: vi.fn(), showToast: vi.fn(), ws, guides: [], recordUsage: vi.fn(),
    ...over,
  };
}

it("goes thinking -> preview and builds a diff", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({
    blocks: [{ type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } }] as any,
    text: "", usage: { input_tokens: 1, output_tokens: 1 },
  });
  const deps = mkDeps();
  const { result } = renderHook(() => useInlineAiEdit(deps));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("mark done"); });
  expect(result.current.phase).toBe("preview");
  expect(result.current.plan?.updates).toEqual([{ field: "status", before: "To Do", after: "Done" }]);
});

it("apply routes each block through runTool and logs + toasts", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({
    blocks: [{ type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } }] as any,
    text: "", usage: { input_tokens: 1, output_tokens: 1 },
  });
  const updateTask = vi.fn().mockReturnValue({ id: 42 });
  const deps = mkDeps({ dispatcher: { getSnapshot: () => ({ today: "2026-07-03", language: "en-US" }), updateTask } });
  const { result } = renderHook(() => useInlineAiEdit(deps));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("mark done"); });
  await act(async () => { await result.current.apply(); });
  expect(updateTask).toHaveBeenCalledWith({ id: 42, status: "Done" });
  expect(deps.logActivity).toHaveBeenCalledWith("ai.inlineEdit", 42, "Fix login bug");
  expect(deps.showToast).toHaveBeenCalledWith("info", expect.stringContaining("Fix login bug"));
  expect(result.current.phase).toBe("idle"); // closes after apply
});

it("no tool_use -> clarify phase, apply is a no-op", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({ blocks: [], text: "Which task?", usage: { input_tokens: 1, output_tokens: 1 } });
  const { result } = renderHook(() => useInlineAiEdit(mkDeps()));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("do something"); });
  expect(result.current.phase).toBe("clarify");
  expect(result.current.clarifyText).toBe("Which task?");
});

it("gates: aiEditEnabled false when disabled / popout / jira-synced", () => {
  const { result: a } = renderHook(() => useInlineAiEdit(mkDeps({ ai: { enabled: false, apiKey: "" } })));
  expect(a.current.aiEditEnabled(task)).toBe(false);
  const { result: b } = renderHook(() => useInlineAiEdit(mkDeps({ isPopout: true })));
  expect(b.current.aiEditEnabled(task)).toBe(false);
  const { result: c } = renderHook(() => useInlineAiEdit(mkDeps()));
  expect(c.current.aiEditEnabled({ ...task, jiraKey: "OPS-1" } as any)).toBe(false);
  expect(c.current.aiEditEnabled(task)).toBe(true);
});
```

- [ ] **Step 2: Run, expect fail** — `npm run test:run -- use-inline-ai-edit` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/app/use-inline-ai-edit.ts
"use client";
import { useState } from "react";
import { type Lang, t } from "./i18n";
import { type Task } from "./types";
import { type Workspace } from "./workspace";
import { type ToolDispatcher, runTool } from "./chat-tools";
import { type AiConfig, isAiEnabled } from "./settings-types";
import { type OperatingGuide } from "./operating-guide-types";
import { type ActivityKind } from "./activity-log";
import { callInlineEdit } from "./inline-ai-edit-call";
import { describeToolCalls, isEmptyPlan, type EditPlan } from "./inline-ai-edit/plan";

export type InlinePhase = "idle" | "thinking" | "preview" | "clarify" | "applying" | "error";

export interface InlineAiEditDeps {
  dispatcher: ToolDispatcher;
  ai: AiConfig;
  apiKey: string;              // effective (possibly passphrase-unlocked) key
  isPopout: boolean;
  lang: Lang;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  ws: Workspace;
  guides: readonly OperatingGuide[];
  recordUsage?: (u: { input_tokens: number; output_tokens: number }) => void;
}

export interface InlineAiEditApi {
  activeTask: Task | null;
  phase: InlinePhase;
  plan: EditPlan | null;
  clarifyText: string;
  errorText: string;
  aiEditEnabled: (task: Task) => boolean;
  openFor: (task: Task) => void;
  submit: (instruction: string) => Promise<void>;
  apply: () => Promise<void>;
  cancel: () => void;
}

export function useInlineAiEdit(deps: InlineAiEditDeps): InlineAiEditApi {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [phase, setPhase] = useState<InlinePhase>("idle");
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [clarifyText, setClarifyText] = useState("");
  const [errorText, setErrorText] = useState("");

  const aiEditEnabled = (task: Task): boolean =>
    isAiEnabled(deps.ai) && !deps.isPopout && !task.jiraKey && !!deps.apiKey.trim();

  const openFor = (task: Task) => {
    if (!aiEditEnabled(task)) return;
    setActiveTask(task); setPhase("idle"); setPlan(null); setClarifyText(""); setErrorText("");
  };
  const cancel = () => { setActiveTask(null); setPhase("idle"); setPlan(null); setClarifyText(""); setErrorText(""); };

  const submit = async (instruction: string) => {
    if (!activeTask || !instruction.trim()) return;
    setPhase("thinking"); setErrorText(""); setClarifyText("");
    try {
      const { blocks, text, usage } = await callInlineEdit({
        apiKey: deps.apiKey, model: deps.ai.model, lang: deps.lang, task: activeTask,
        instruction, snapshot: deps.dispatcher.getSnapshot(), guides: deps.guides, groundInGuides: deps.ai.groundInGuides,
      });
      deps.recordUsage?.(usage);
      const next = describeToolCalls(blocks, { task: activeTask, ws: deps.ws });
      if (isEmptyPlan(next)) { setClarifyText(text || t(deps.lang, "inlineAiEditNoChanges")); setPhase("clarify"); return; }
      setPlan(next); setPhase("preview");
    } catch {
      // callInlineEdit throws status-digit-only errors — never surface details.
      setErrorText(t(deps.lang, "inlineAiEditError")); setPhase("error");
    }
  };

  const apply = async () => {
    if (!activeTask || !plan || isEmptyPlan(plan)) return;
    setPhase("applying");
    try {
      // Re-issue the model's tool calls, but only the ones the plan accepted.
      // update on the target task:
      if (plan.updates.length > 0) {
        const patch: Record<string, unknown> = { id: activeTask.id };
        for (const d of plan.updates) patch[d.field] = coerceField(d.field, d.after);
        await runTool(deps.dispatcher, "update_task", patch);
      }
      for (const c of plan.creates) await runTool(deps.dispatcher, c.toolName, c.input);
      for (const del of plan.deletes) await runTool(deps.dispatcher, del.toolName, { id: del.id });
      deps.logActivity?.("ai.inlineEdit", activeTask.id, activeTask.taskName);
      deps.showToast("info", t(deps.lang, "inlineAiEditApplied", activeTask.taskName));
      cancel();
    } catch {
      setErrorText(t(deps.lang, "inlineAiEditError")); setPhase("error");
    }
  };

  return { activeTask, phase, plan, clarifyText, errorText, aiEditEnabled, openFor, submit, apply, cancel };
}

// Diffs store stringified values; convert back for the update tool. Labels/arrays
// are re-split; the dispatcher's sanitizeTask does the authoritative validation.
function coerceField(field: string, value: string): unknown {
  if (field === "labels") return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (field === "resourceId") { const n = Number(value); return Number.isFinite(n) && value !== "" ? n : null; }
  return value;
}
```

Note: the `apply()` reconstructs `update_task` from the accepted diff (not the raw block) so a rejected multi-task edit can never slip through. `runTool` still routes through the dispatcher's `sanitizeTask`/`sanitizeX`. Confirm `runTool` accepts these tool names (it does per the reference).

- [ ] **Step 4: Run, expect pass** — `npm run test:run -- use-inline-ai-edit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-inline-ai-edit.ts src/app/use-inline-ai-edit.test.tsx
git commit -m "feat(inline-ai-edit): useInlineAiEdit state-machine hook"
```

---

## Task 5: Popover UI (`inline-ai-edit-popover.tsx`)

**Files:**
- Create: `src/app/inline-ai-edit-popover.tsx`
- Test: `src/app/inline-ai-edit-popover.test.tsx`

Presentational — takes the hook API + `lang` as props; no context. Palette-safe; input has an `aria-label` (not placeholder-only). Centered modal-style popover (works for both table + board).

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/inline-ai-edit-popover.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InlineAiEditPopover } from "./inline-ai-edit-popover";

const base = {
  lang: "en-US" as const,
  task: { id: 42, taskName: "Fix login bug" } as any,
  phase: "idle" as const, plan: null, clarifyText: "", errorText: "",
  onSubmit: vi.fn(), onApply: vi.fn(), onCancel: vi.fn(),
};

it("renders a labelled input and submits the instruction", () => {
  render(<InlineAiEditPopover {...base} />);
  const input = screen.getByLabelText(/ask claude to edit this task/i);
  fireEvent.change(input, { target: { value: "mark done" } });
  fireEvent.submit(input.closest("form")!);
  expect(base.onSubmit).toHaveBeenCalledWith("mark done");
});

it("shows the diff and an Apply button in preview", () => {
  render(<InlineAiEditPopover {...base} phase="preview" plan={{ updates: [{ field: "status", before: "To Do", after: "Done" }], creates: [], deletes: [], rejected: [] }} />);
  expect(screen.getByText(/status/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /apply/i }));
  expect(base.onApply).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement** — a `role="dialog"` centered popover with: header (`inlineAiEditTitle` + task name), a `<form>` with a labelled `<input>` + submit; when `phase==="thinking"` a spinner + `inlineAiEditThinking`; `phase==="preview"` the diff list (updates as `before → after`, creates as `inlineAiEditCreate`, deletes as `inlineAiEditDelete`) + Cancel/Apply; `phase==="clarify"` the `clarifyText`; `phase==="error"` `errorText` + retry. Use `INTERACTIVE`/`FOCUS_RING` atoms, `border-line`/`bg-surface`/AIPM tokens only, and the shared `Modal` or a plain absolutely-centered panel with `usePopoverDismiss` on Escape/outside. (Full JSX authored in this step — mirror `reschedule-popover.tsx` structure for the popover shell + `edit-modal-chrome` `ModalFieldError` for the error line.)

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git add src/app/inline-ai-edit-popover.tsx src/app/inline-ai-edit-popover.test.tsx
git commit -m "feat(inline-ai-edit): InlineAiEditPopover UI"
```

---

## Task 6: Wire into the task table (row trigger + tasks-section)

**Files:**
- Modify: `src/app/task-manager.tsx` (`<TasksSection>` render ~L?, pass `dispatcher` + `logActivity`)
- Modify: `src/app/tasks-section.tsx` (instantiate the hook; provide `onAiEdit`/`aiEditEnabled` to rows; render the popover)
- Modify: `src/app/task-row.tsx` (`RowContextValue` + row ✨ trigger)

- [ ] **Step 1:** In `task-manager.tsx`, add `dispatcher={dispatcher}` and `logActivity={logActivity}` props to `<TasksSection>` (both already exist in that scope — dispatcher L~1260, logActivity is the app logger). Extend `TasksSectionProps` accordingly (`dispatcher: ToolDispatcher`, `logActivity?: (kind: ActivityKind, ...a) => void`).

- [ ] **Step 2:** In `tasks-section.tsx`, instantiate the hook with the effective key. Compute `apiKey` the way `chat-panel` does (master-on ? apiKey||unlocked : "") — for SP1, `aiKeyIfEnabled(settings.ai)` is acceptable (passphrase-locked → empty → gated off); note this simplification.

```tsx
const showToast = useToastContext();
const ws = useWorkspace();               // confirm the hook/exports; else thread ws from task-manager
const { record: recordUsage } = useAiUsageContext();
const inlineEdit = useInlineAiEdit({
  dispatcher: props.dispatcher, ai: settings.ai, apiKey: aiKeyIfEnabled(settings.ai),
  isPopout: props.isPopout ?? false, lang, logActivity: props.logActivity,
  showToast, ws, guides: [], recordUsage,
});
```

- [ ] **Step 3:** Pass `onAiEdit: inlineEdit.openFor` and `aiEditEnabled: inlineEdit.aiEditEnabled` into the `RowContextProvider` value (extend `RowContextValue` in `task-row.tsx`). Render the single popover at the end of `tasks-section`'s JSX: `{inlineEdit.activeTask && <InlineAiEditPopover lang={lang} task={inlineEdit.activeTask} phase={inlineEdit.phase} plan={inlineEdit.plan} clarifyText={inlineEdit.clarifyText} errorText={inlineEdit.errorText} onSubmit={inlineEdit.submit} onApply={inlineEdit.apply} onCancel={inlineEdit.cancel} />}`.

- [ ] **Step 4:** In `task-row.tsx`, add the ✨ trigger — a hover-revealed icon button AND an entry in the row's existing actions cluster — gated on `ctx.aiEditEnabled(task)`, calling `ctx.onAiEdit(task)`. Row-unique accessible name: `aria-label={`${t(lang,"inlineAiEdit")} – ${task.taskName}`}` (en-dash, mirrors the status-select pattern at `task-status-select.tsx:22`). Hover reveal via `opacity-0 group-hover:opacity-100 focus:opacity-100` on the row's `group` container (verify the row `<tr>` has `group`; add if missing). Icon = a sanctioned inline SVG (sparkle), `aria-hidden`; palette tokens only.

- [ ] **Step 5:** Update `task-row.test.tsx` / `tasks-section.test.tsx` fixtures for the new required `dispatcher`/`RowContextValue` fields (provide a stub dispatcher + `onAiEdit: vi.fn()`, `aiEditEnabled: () => false` so existing rows render without the trigger). Run:

```bash
npx tsc --noEmit && npm run test:run -- task-row tasks-section
```

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager.tsx src/app/tasks-section.tsx src/app/task-row.tsx src/app/*.test.tsx
git commit -m "feat(inline-ai-edit): wire inline Ask-Claude into the task table"
```

---

## Task 7: Wire into the Kanban board

**Files:**
- Modify: `src/app/task-kanban-board.tsx`

Context: the board does NOT use `RowContextProvider` — it threads `onStatusChange`/`onEdit` as direct props. Add `onAiEdit?: (t: Task) => void` + `aiEditEnabled?: (t: Task) => boolean` to `TaskKanban` props and the card, passed from `tasks-section` alongside the existing `onStatusChange`/`onEdit`.

- [ ] **Step 1:** Add the props to `TaskKanban` + the card component; render the ✨ card action gated on `aiEditEnabled?.(task)`, calling `onAiEdit?.(task)`. Same row-unique aria-label. The card is `<article>` with `data-deeplink-row`; place the ✨ in the card's action area beside the status select.

- [ ] **Step 2:** In `tasks-section.tsx`, pass `onAiEdit={inlineEdit.openFor}` + `aiEditEnabled={inlineEdit.aiEditEnabled}` to `<TaskKanban>` (only one of table/board mounts, so the single popover instance serves both).

- [ ] **Step 3:** Test with a populated `raidByTask` card (board crash-path rule) + assert the ✨ action calls `onAiEdit`. Run:

```bash
npx tsc --noEmit && npm run test:run -- task-kanban
```

- [ ] **Step 4: Commit**

```bash
git add src/app/task-kanban-board.tsx src/app/tasks-section.tsx src/app/task-kanban-board.test.tsx
git commit -m "feat(inline-ai-edit): wire inline Ask-Claude into the Kanban board"
```

---

## Task 8: Full verification + coverage bookkeeping

- [ ] **Step 1:** If `use-inline-ai-edit.ts` reads as pure render glue and drops function coverage, add it to `vitest.config.ts` `coverage.exclude` (same class as the other `use*` UI hooks). Otherwise leave it (it has real tests).

- [ ] **Step 2:** Full gate:

```bash
npx tsc --noEmit
npm run lint
npm run test:run
npm run dup:check
npm run size:check
```
Expected: tsc 0, lint 0, all unit green, dup exit 0 @2.4 (if task-manager/tasks-section grew past baseline, `node scripts/check-file-sizes.mjs --update` with justification), size ok.

- [ ] **Step 3:** Axe — the Open Points (tasks) view is scanned; the new ✨ trigger renders in it:

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"
```
Expected: 3/3 (AIPM-light/dark + mockup). Eye-verify the Kanban card ✨ (board not axe-scanned).

- [ ] **Step 4:** Release highlight — bump `src/app/version.ts` (APP_VERSION + milestone), add a `CHANGELOG.md` entry, append the new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE). Commit.

- [ ] **Step 5:** Final commit + hand back for review/release.

```bash
git add -A && git commit -m "chore(inline-ai-edit): coverage exclude + release highlight"
```

---

## Notes / gotchas carried from the reference

- `callClaude` sends **all** `TOOL_DEFS` with **no** `tool_choice` — the model auto-selects; we only apply write blocks. Fine for a single-shot.
- Tool-name asymmetry: RAID is `create_raid_item`/`update_raid_item`/`delete_raid_item`; change/milestone/stakeholder drop `_item`.
- `runTool` throws on read-only dispatcher (popout) — we already gate the affordance off in popouts, so it never reaches apply there.
- The dispatcher's per-entity `sanitizeX` is the authoritative validator on apply; the plan's `coerceField` only re-hydrates arrays/ids for display→tool.
- Grounding view key for tasks is `"open-points"`, not `"tasks"` (if you later adopt `action-ai.buildGroundingIndex` instead of the inline `taskIds` set).
- `RowContextValue` (table) and the Kanban card prop path are SEPARATE — the trigger must be added to both.
