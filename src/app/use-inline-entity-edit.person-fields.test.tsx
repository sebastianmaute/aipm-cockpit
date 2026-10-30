import { describe, it, expect, vi, afterEach } from "vitest";
// AI people protection, Task 6 (R4): an inline "Ask Claude" edit never sets, changes or clears a person under
// protection — the person change is dropped from the diff BEFORE it is shown, and a person record (a
// stakeholder, resource or absence row) is refused before the model is called. The open project's setting
// comes from `useOpenProjectPeopleProtected`, mocked here with one stable getter, as the real one is.
const people = vi.hoisted(() => {
  const state = { on: false };
  return { state, get: () => state.on };
});
vi.mock("./ai-privacy-context", async () => ({
  ...(await import("../test/ai-privacy-unprotected")),
  useOpenProjectPeopleProtected: () => people.get,
}));
import { renderHook, act } from "@testing-library/react";
import { newConsent } from "./ai-consent";
import * as call from "./inline-ai-edit-call";
import { useInlineEntityEdit, type InlineEntityEditDeps } from "./use-inline-entity-edit";
import { t } from "./i18n";

afterEach(() => {
  people.state.on = false;
  vi.restoreAllMocks();
});

const task = { id: 42, taskName: "Fix login", assignee: "Ann", status: "To Do", dueDate: "2026-08-12", priority: "Medium" };
const stakeholder = { id: 3, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: {} };
const ws = { tasks: [task], raid: [], milestones: [], changes: [], stakeholders: [stakeholder], resources: [] } as unknown as InlineEntityEditDeps["ws"];

function mkDeps(entity: InlineEntityEditDeps["entity"]): InlineEntityEditDeps {
  return {
    entity,
    dispatcher: { getSnapshot: () => ({ today: "2026-07-03", language: "en-US" }) } as unknown as InlineEntityEditDeps["dispatcher"],
    ai: { enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", groundInGuides: false } as unknown as InlineEntityEditDeps["ai"],
    apiKey: "sk-ant-xxxxxxxxxxxxxxxx",
    isPopout: false, lang: "en-US",
    showToast: vi.fn(), ws, guides: [],
  };
}

function modelProposes(input: Record<string, unknown>, text = "") {
  return vi.spyOn(call, "callInlineEdit").mockResolvedValue({
    blocks: [{ type: "tool_use", id: "b1", name: "update_task", input }],
    text, usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
}

async function submitOnTask(peopleProtected: boolean, input: Record<string, unknown>, text = "") {
  people.state.on = peopleProtected;
  modelProposes(input, text);
  const { result } = renderHook(() => useInlineEntityEdit(mkDeps("task")));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("reassign and raise it"); });
  return result;
}

describe("inline edit of a task under people protection", () => {
  it("drops the assignee change from the diff before it is shown, and keeps the rest", async () => {
    const result = await submitOnTask(true, { id: 42, assignee: "Marco", priority: "High" });
    expect(result.current.phase).toBe("preview");
    const fields = result.current.plan!.updates.map((u) => u.field);
    expect(fields).toContain("priority");
    expect(fields).not.toContain("assignee");
  });

  it("a proposal that only changes the assignee shows why nothing is left, not the model's promise", async () => {
    const result = await submitOnTask(true, { id: 42, assignee: "" }, "I'll unassign it.");
    expect(result.current.phase).toBe("clarify");
    expect(result.current.clarifyText).toBe(t("en-US", "inlineAiEditPeopleWithheld"));
  });

  // The positive control: allowed, the same proposal previews the assignee change.
  it("protection off: the assignee change is previewed", async () => {
    const result = await submitOnTask(false, { id: 42, assignee: "Marco", priority: "High" });
    expect(result.current.plan!.updates.map((u) => u.field)).toEqual(expect.arrayContaining(["assignee", "priority"]));
  });
});

describe("inline edit of a person record under people protection", () => {
  it("refuses a stakeholder row before calling the model", async () => {
    people.state.on = true;
    const spy = modelProposes({});
    const { result } = renderHook(() => useInlineEntityEdit(mkDeps("stakeholder")));
    act(() => result.current.openFor(stakeholder));
    await act(async () => { await result.current.submit("make Sam the owner"); });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("error");
    expect(result.current.errorText).toBe(t("en-US", "inlineAiEditPeopleRecord"));
  });

  it("protection off: the stakeholder row is sent to the model (positive control)", async () => {
    const spy = modelProposes({});
    const { result } = renderHook(() => useInlineEntityEdit(mkDeps("stakeholder")));
    act(() => result.current.openFor(stakeholder));
    await act(async () => { await result.current.submit("make Sam the owner"); });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
