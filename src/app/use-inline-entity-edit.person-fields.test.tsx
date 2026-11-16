import { describe, it, expect, vi, afterEach } from "vitest";
// AI people protection: an inline "Ask Claude" edit never sets, changes or clears a person under
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
import { loadI18n, t } from "./i18n";

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
    dispatcher: { getSnapshot: () => ({ today: "2026-07-03", language: "en-US" }), isResourcesHidden: () => false, isStakeholdersHidden: () => false } as unknown as InlineEntityEditDeps["dispatcher"],
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

// The STORED row after Apply, through the real `runTool` into a dispatcher that keeps
// what it is given.
describe("applying an inline task edit under people protection", () => {
  async function applyOnTask(peopleProtected: boolean) {
    people.state.on = peopleProtected;
    let stored: Record<string, unknown> = { ...task };
    const dispatcher = {
      getSnapshot: () => ({ today: "2026-07-03", language: "en-US" }),
      isPeopleProtected: () => peopleProtected, isResourcesHidden: () => false, isStakeholdersHidden: () => false,
      getTask: (id: number) => (id === task.id ? stored : null),
      updateTask: (id: number, patch: Record<string, unknown>) => (id === task.id ? (stored = { ...stored, ...patch }) : null),
    } as unknown as InlineEntityEditDeps["dispatcher"];
    modelProposes({ id: 42, assignee: "Marco", priority: "High" });
    const { result } = renderHook(() => useInlineEntityEdit({ ...mkDeps("task"), dispatcher }));
    act(() => result.current.openFor(task));
    await act(async () => { await result.current.submit("reassign and raise it"); });
    await act(async () => { await result.current.apply(); });
    return stored;
  }

  it("stores the other change and no person change", async () => {
    const stored = await applyOnTask(true);
    expect(stored.priority).toBe("High");
    expect(stored.assignee).toBe("Ann");
  });

  it("protection off: the reassignment is stored (positive control)", async () => {
    const stored = await applyOnTask(false);
    expect(stored).toMatchObject({ priority: "High", assignee: "Marco" });
  });
});

describe("inline edit passes the protection state to the call", () => {
  async function submitAndGetArgs(peopleProtected: boolean) {
    people.state.on = peopleProtected;
    const spy = modelProposes({ id: 42, priority: "High" });
    const { result } = renderHook(() => useInlineEntityEdit(mkDeps("task")));
    act(() => result.current.openFor(task));
    await act(async () => { await result.current.submit("raise it"); });
    return spy.mock.calls[0][0];
  }

  // The mocked getter answers "on"; the organisation-forced path, through the real provider, is pinned in
  // `ai-people-gates.test.tsx` ("forced protection passes peopleProtected: true even when the project allows people").
  it("protection on passes peopleProtected: true to callInlineEdit", async () => {
    expect((await submitAndGetArgs(true)).peopleProtected).toBe(true);
  });

  it("submit passes peopleProtected to callInlineEdit", async () => {
    expect((await submitAndGetArgs(false)).peopleProtected).toBe(false);
  });
});

// §810 — a hidden function withdraws the tools it owns, and the inline editor stops an edit of such a record
// before the paid call, by the predicate the executor refuses with (`toolWithheldBy`), naming the right switch.
describe("inline edit of a person record with a hidden function (§810)", () => {
  const resource = { id: 7, firstName: "Ann", lastName: "Lee", title: "Dev", department: "IT" };
  const hiddenWs = { ...ws, resources: [resource] } as unknown as InlineEntityEditDeps["ws"];
  function hiddenDeps(entity: InlineEntityEditDeps["entity"], hidden: { resources?: boolean; stakeholders?: boolean }): InlineEntityEditDeps {
    return {
      ...mkDeps(entity),
      ws: hiddenWs,
      dispatcher: {
        getSnapshot: () => ({ today: "2026-07-03", language: "en-US" }),
        isResourcesHidden: () => hidden.resources === true,
        isStakeholdersHidden: () => hidden.stakeholders === true,
      } as unknown as InlineEntityEditDeps["dispatcher"],
    };
  }
  async function submitOn(entity: InlineEntityEditDeps["entity"], row: Record<string, unknown>, hidden: { resources?: boolean; stakeholders?: boolean }) {
    const spy = modelProposes({});
    const { result } = renderHook(() => useInlineEntityEdit(hiddenDeps(entity, hidden)));
    act(() => result.current.openFor(row as never));
    await act(async () => { await result.current.submit("change it"); });
    return { result, spy };
  }

  it("Stakeholders hidden: a stakeholder edit is stopped before the model is called, naming Stakeholders", async () => {
    const { result, spy } = await submitOn("stakeholder", stakeholder, { stakeholders: true });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("error");
    expect(result.current.errorText).toBe(t("en-US", "inlineAiEditStakeholdersHidden"));
  });

  it("Resources hidden alone does not stop a stakeholder edit, and the call says Stakeholders is shown", async () => {
    const { spy } = await submitOn("stakeholder", stakeholder, { resources: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ resourcesHidden: true, stakeholdersHidden: false });
  });

  it("Resources hidden: a resource edit is stopped before the model is called, naming Resources", async () => {
    const { result, spy } = await submitOn("resource", resource, { resources: true });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.errorText).toBe(t("en-US", "inlineAiEditResourcesHidden"));
  });

  it("CONTROL: both functions shown, a resource edit reaches the model", async () => {
    const { spy } = await submitOn("resource", resource, {});
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the German messages are their own strings", async () => {
    await loadI18n("de");
    expect(t("de", "inlineAiEditStakeholdersHidden")).toMatch(/Stakeholder/);
    expect(t("de", "inlineAiEditResourcesHidden")).toMatch(/Ressourcen/);
    expect(t("de", "inlineAiEditResourcesHidden")).not.toBe(t("en-US", "inlineAiEditResourcesHidden"));
  });
});
