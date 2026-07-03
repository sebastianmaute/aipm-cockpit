import { it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as call from "./inline-ai-edit-call";
import * as tools from "./chat-tools";
import { useInlineAiEdit, type InlineAiEditDeps } from "./use-inline-ai-edit";
import { type Task } from "./types";

afterEach(() => vi.restoreAllMocks());

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
