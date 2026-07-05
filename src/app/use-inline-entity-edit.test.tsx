import { it, expect, vi, afterEach, describe } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as call from "./inline-ai-edit-call";
import * as tools from "./chat-tools";
import { useInlineAiEdit, type InlineAiEditDeps } from "./use-inline-ai-edit";
import { useInlineEntityEdit, type InlineEntityEditDeps } from "./use-inline-entity-edit";
import { type Task } from "./types";

afterEach(() => vi.restoreAllMocks());

// --- Task path (SP1 API preserved via the thin wrapper) --------------------

const task = { id: 42, taskName: "Fix login bug", status: "To Do", dueDate: "2026-08-12" } as unknown as Task;
const ws = { tasks: [task], raid: [], milestones: [], changes: [], stakeholders: [] } as unknown as InlineAiEditDeps["ws"];

function mkDeps(over: Partial<InlineAiEditDeps> = {}): InlineAiEditDeps {
  return {
    dispatcher: { getSnapshot: () => ({ today: "2026-07-03", language: "en-US" }) } as unknown as InlineAiEditDeps["dispatcher"],
    ai: { enabled: true, apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", groundInGuides: false } as unknown as InlineAiEditDeps["ai"],
    apiKey: "sk-ant-xxxxxxxxxxxxxxxx",
    isPopout: false, lang: "en-US",
    logActivity: vi.fn(), showToast: vi.fn(), ws, guides: [], recordUsage: vi.fn(),
    ...over,
  };
}

it("goes thinking -> preview and builds a diff", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({
    blocks: [{ type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } }],
    text: "", usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
  const { result } = renderHook(() => useInlineAiEdit(mkDeps()));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("mark done"); });
  expect(result.current.phase).toBe("preview");
  expect(result.current.plan?.updates).toEqual([{ field: "status", before: "To Do", after: "Done" }]);
});

it("apply routes each block through runTool and logs + toasts, then closes", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({
    blocks: [{ type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } }],
    text: "", usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
  const runToolSpy = vi.spyOn(tools, "runTool").mockResolvedValue({ id: 42 });
  const deps = mkDeps();
  const { result } = renderHook(() => useInlineAiEdit(deps));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("mark done"); });
  await act(async () => { await result.current.apply(); });
  expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_task", { id: 42, status: "Done" });
  expect(deps.logActivity).toHaveBeenCalledWith("ai.inlineEdit", 42, "Fix login bug");
  expect(deps.showToast).toHaveBeenCalledWith("info", expect.stringContaining("Fix login bug"));
  expect(result.current.phase).toBe("idle");
});

it("no tool_use -> clarify phase", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({ blocks: [], text: "Which task?", usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
  const { result } = renderHook(() => useInlineAiEdit(mkDeps()));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("do something"); });
  expect(result.current.phase).toBe("clarify");
  expect(result.current.clarifyText).toBe("Which task?");
});

it("error path: callInlineEdit throws -> error phase", async () => {
  vi.spyOn(call, "callInlineEdit").mockRejectedValue(new Error("500"));
  const { result } = renderHook(() => useInlineAiEdit(mkDeps()));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("x"); });
  expect(result.current.phase).toBe("error");
});

it("gates: aiEditEnabled false when disabled / popout / jira-synced", () => {
  const { result: a } = renderHook(() => useInlineAiEdit(mkDeps({ ai: { enabled: false, apiKey: "" } as unknown as InlineAiEditDeps["ai"], apiKey: "" })));
  expect(a.current.aiEditEnabled(task)).toBe(false);
  const { result: b } = renderHook(() => useInlineAiEdit(mkDeps({ isPopout: true })));
  expect(b.current.aiEditEnabled(task)).toBe(false);
  const { result: c } = renderHook(() => useInlineAiEdit(mkDeps()));
  expect(c.current.aiEditEnabled({ ...task, jiraKey: "OPS-1" } as unknown as Task)).toBe(false);
  expect(c.current.aiEditEnabled(task)).toBe(true);
});

it("partial apply: a later op fails after the update committed -> partial toast + close, not error", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({
    blocks: [
      { type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } },
      { type: "tool_use", id: "b2", name: "create_raid_item", input: { category: "Risk", title: "R" } },
    ],
    text: "", usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
  const runToolSpy = vi.spyOn(tools, "runTool")
    .mockResolvedValueOnce({ id: 42 })
    .mockRejectedValueOnce(new Error("bad"));
  const deps = mkDeps();
  const { result } = renderHook(() => useInlineAiEdit(deps));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("x"); });
  await act(async () => { await result.current.apply(); });
  expect(runToolSpy).toHaveBeenCalledTimes(2);
  expect(deps.showToast).toHaveBeenCalledWith("error", expect.any(String)); // partial notice
  expect(deps.logActivity).toHaveBeenCalledWith("ai.inlineEdit", 42, "Fix login bug");
  expect(result.current.phase).toBe("idle"); // closed, not stranded in error
});

it("discards a stale response when the active task changed mid-flight", async () => {
  let resolveCall!: (v: Awaited<ReturnType<typeof call.callInlineEdit>>) => void;
  vi.spyOn(call, "callInlineEdit").mockImplementation(
    () => new Promise((r) => { resolveCall = r; }),
  );
  const taskB = { id: 43, taskName: "Other", status: "To Do" } as unknown as Task;
  const wsAB = { tasks: [task, taskB], raid: [], milestones: [], changes: [], stakeholders: [] } as unknown as InlineAiEditDeps["ws"];
  const { result } = renderHook(() => useInlineAiEdit(mkDeps({ ws: wsAB })));
  act(() => result.current.openFor(task));
  let submitPromise!: Promise<void>;
  act(() => { submitPromise = result.current.submit("mark done"); });
  act(() => result.current.openFor(taskB)); // switch while A's call is in-flight
  await act(async () => {
    resolveCall({
      blocks: [{ type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } }],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    await submitPromise;
  });
  // A's response must NOT land on B: no preview, plan stays null, active task is B.
  expect(result.current.activeTask?.id).toBe(43);
  expect(result.current.plan).toBeNull();
  expect(result.current.phase).not.toBe("preview");
});

// --- Generic entity path (raid) --------------------------------------------

describe("useInlineEntityEdit — raid", () => {
  const raidItem = { id: 7, category: "R", title: "Old", status: "Open" };
  const raidWs = { tasks: [], raid: [raidItem], milestones: [], changes: [], stakeholders: [] } as unknown as InlineEntityEditDeps["ws"];

  function mkEntityDeps(over: Partial<InlineEntityEditDeps> = {}): InlineEntityEditDeps {
    return {
      entity: "raid",
      dispatcher: { getSnapshot: () => ({ today: "2026-07-03", language: "en-US" }) } as unknown as InlineEntityEditDeps["dispatcher"],
      ai: { enabled: true, apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", groundInGuides: false } as unknown as InlineEntityEditDeps["ai"],
      apiKey: "sk-ant-xxxxxxxxxxxxxxxx",
      isPopout: false, lang: "en-US",
      logActivity: vi.fn(), showToast: vi.fn(), ws: raidWs, guides: [], recordUsage: vi.fn(),
      ...over,
    };
  }

  it("enables edits without a task-only jira gate", () => {
    const { result } = renderHook(() => useInlineEntityEdit(mkEntityDeps()));
    // A jiraKey field is irrelevant for non-task entities → still enabled.
    expect(result.current.aiEditEnabled({ ...raidItem, jiraKey: "OPS-1" })).toBe(true);
  });

  it("submit -> preview and apply routes through update_raid_item", async () => {
    vi.spyOn(call, "callInlineEdit").mockResolvedValue({
      blocks: [{ type: "tool_use", id: "b1", name: "update_raid_item", input: { id: 7, title: "New" } }],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    const runToolSpy = vi.spyOn(tools, "runTool").mockResolvedValue({ id: 7 });
    const deps = mkEntityDeps();
    const { result } = renderHook(() => useInlineEntityEdit(deps));
    act(() => result.current.openFor(raidItem));
    await act(async () => { await result.current.submit("rename it"); });
    expect(result.current.phase).toBe("preview");
    expect(result.current.plan?.updates).toEqual([{ field: "title", before: "Old", after: "New" }]);
    await act(async () => { await result.current.apply(); });
    expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_raid_item", { id: 7, title: "New" });
    expect(deps.logActivity).toHaveBeenCalledWith("ai.inlineEdit", 7, "Old");
    expect(result.current.phase).toBe("idle");
  });

  it("auto-closes a left-open edit when the pane goes inactive (active -> false)", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useInlineEntityEdit(mkEntityDeps({ active })),
      { initialProps: { active: true } },
    );
    act(() => result.current.openFor(raidItem));
    expect(result.current.activeItem?.id).toBe(7);
    // Pane switches away via a non-mouse route → active becomes false → the
    // render-time reconcile closes the stale edit so it can't reappear on return.
    rerender({ active: false });
    expect(result.current.activeItem).toBeNull();
    expect(result.current.phase).toBe("idle");
  });
});
