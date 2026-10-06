// Pins useResourceQuickCreate (use-resource-quick-create.ts, §491): creating a
// resource from outside the Resources view. The picker's one-step create mints,
// commits and logs; the task editor's add-to-address-book opens the resource
// modal seeded from the typed name, and only a save that follows it writes the
// new person back into the task form. The setters, the logger and the resource
// directory's handlers are mocks; the name split, the email rule and the id
// minting are the real ones.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Resource } from "./types";
import type { TaskFormDraft } from "./task-form-context";
import { __resetMintStateForTests } from "./id-mint-session";
import { useResourceQuickCreate, type ResourceQuickCreateDeps } from "./use-resource-quick-create";

function person(id: number, over: Partial<Resource> = {}): Resource {
  return { id, firstName: `F${id}`, lastName: `L${id}`, roleId: null, utilizationMode: "percent", utilization: {}, ...over };
}

function makeDeps(over: Partial<ResourceQuickCreateDeps> = {}): ResourceQuickCreateDeps {
  return {
    resources: [person(1), person(5)],
    setResources: vi.fn(),
    logActivity: vi.fn(),
    handleOpenAddResource: vi.fn(),
    handleSaveResource: vi.fn(),
    handleCloseResourceModal: vi.fn(),
    setForm: vi.fn(),
    ...over,
  };
}

/** Runs the one functional `setResources` call over `start`. */
function committed(deps: ResourceQuickCreateDeps, start: readonly Resource[]): readonly Resource[] {
  const calls = vi.mocked(deps.setResources).mock.calls;
  expect(calls).toHaveLength(1);
  const [arg] = calls[0];
  return typeof arg === "function" ? arg(start) : arg;
}

/** Runs the one functional `setForm` call over `start`. */
function formAfter(deps: ResourceQuickCreateDeps, start: TaskFormDraft): TaskFormDraft {
  const calls = vi.mocked(deps.setForm).mock.calls;
  expect(calls).toHaveLength(1);
  const [arg] = calls[0];
  return typeof arg === "function" ? arg(start) : arg;
}

const FORM = { assignee: "typed", assigneeEmail: "typed@x.io", taskName: "Keep me" } as unknown as TaskFormDraft;

beforeEach(() => {
  __resetMintStateForTests();
});

describe("useResourceQuickCreate — the picker's one-step create", () => {
  it("splits the name, mints above the list, keeps a valid email, stamps the row, logs the full name and returns the id", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useResourceQuickCreate(deps));
    let id = 0;
    act(() => {
      id = result.current.handleCreateResource("  Ada   Lovelace ", "ada@example.com");
    });

    expect(id).toBe(6);
    const list = committed(deps, deps.resources);
    expect(list.slice(0, 2)).toEqual(deps.resources);
    expect(list).toHaveLength(3);
    const row = list[2];
    expect(row).toMatchObject({
      id: 6, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com",
      roleId: null, utilizationMode: "percent", utilization: {},
    });
    expect(typeof row.localModifiedAt).toBe("string");
    expect(Number.isNaN(Date.parse(row.localModifiedAt ?? ""))).toBe(false);
    expect(deps.logActivity).toHaveBeenCalledTimes(1);
    expect(deps.logActivity).toHaveBeenCalledWith("resource.created", 6, "Ada Lovelace");
  });

  it("drops an email the write rule refuses, and logs a single name without a trailing space", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useResourceQuickCreate(deps));
    act(() => {
      result.current.handleCreateResource("Plato", "not an email");
    });
    const row = committed(deps, deps.resources)[2];
    expect(row).toMatchObject({ firstName: "Plato", lastName: "" });
    expect(row.email).toBeUndefined();
    expect(deps.logActivity).toHaveBeenCalledWith("resource.created", 6, "Plato");
  });

  it("mints from the latest resource list after a rerender", () => {
    const deps = makeDeps();
    const { result, rerender } = renderHook((d: ResourceQuickCreateDeps) => useResourceQuickCreate(d), { initialProps: deps });
    rerender({ ...deps, resources: [person(1), person(9)] });
    let id = 0;
    act(() => {
      id = result.current.handleCreateResource("Late Comer", "");
    });
    expect(id).toBe(10);
  });
});

describe("useResourceQuickCreate — add the assignee to the address book", () => {
  it("opens the resource modal seeded from the typed name and a trimmed email", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useResourceQuickCreate(deps));
    act(() => result.current.handleAddAssigneeToAddressBook("Grace Brewster Hopper", "  grace@example.com "));
    expect(deps.handleOpenAddResource).toHaveBeenCalledWith({ firstName: "Grace", lastName: "Brewster Hopper", email: "grace@example.com" });
  });

  it("seeds no email when none was typed", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useResourceQuickCreate(deps));
    act(() => result.current.handleAddAssigneeToAddressBook("Grace Hopper", "   "));
    expect(deps.handleOpenAddResource).toHaveBeenCalledWith({ firstName: "Grace", lastName: "Hopper", email: undefined });
  });

  it("on the save that follows, saves the resource and writes it into the task form as the assignee — once", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useResourceQuickCreate(deps));
    act(() => result.current.handleAddAssigneeToAddressBook("Grace Hopper", ""));
    const saved = person(6, { firstName: "Grace", lastName: "Hopper", email: "grace@example.com" });
    act(() => result.current.handleSaveResourceFromAnywhere(saved));

    expect(deps.handleSaveResource).toHaveBeenCalledWith(saved);
    expect(formAfter(deps, FORM)).toEqual({ ...FORM, assignee: "Grace Hopper", assigneeEmail: "grace@example.com" });

    // The pending fill is spent: a second save from anywhere leaves the form alone.
    act(() => result.current.handleSaveResourceFromAnywhere(person(7)));
    expect(deps.handleSaveResource).toHaveBeenCalledTimes(2);
    expect(deps.setForm).toHaveBeenCalledTimes(1);
  });

  it("writes an empty assignee email when the saved resource has none", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useResourceQuickCreate(deps));
    act(() => result.current.handleAddAssigneeToAddressBook("Plato", ""));
    act(() => result.current.handleSaveResourceFromAnywhere(person(6, { firstName: "Plato", lastName: "" })));
    expect(formAfter(deps, FORM)).toMatchObject({ assignee: "Plato", assigneeEmail: "" });
  });

  it("a save not started from the task editor leaves the form alone", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useResourceQuickCreate(deps));
    act(() => result.current.handleSaveResourceFromAnywhere(person(6)));
    expect(deps.handleSaveResource).toHaveBeenCalledWith(person(6));
    expect(deps.setForm).not.toHaveBeenCalled();
  });

  it("closing the modal cancels the pending fill", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useResourceQuickCreate(deps));
    act(() => result.current.handleAddAssigneeToAddressBook("Grace Hopper", ""));
    act(() => result.current.handleCloseResourceFromAnywhere());
    expect(deps.handleCloseResourceModal).toHaveBeenCalledTimes(1);

    act(() => result.current.handleSaveResourceFromAnywhere(person(6)));
    expect(deps.setForm).not.toHaveBeenCalled();
  });
});

describe("useResourceQuickCreate — identity", () => {
  it("keeps the handlers stable across a rerender with the same deps", () => {
    const deps = makeDeps();
    const { result, rerender } = renderHook((d: ResourceQuickCreateDeps) => useResourceQuickCreate(d), { initialProps: deps });
    const first = result.current;
    rerender({ ...deps });
    expect(result.current.handleCreateResource).toBe(first.handleCreateResource);
    expect(result.current.handleAddAssigneeToAddressBook).toBe(first.handleAddAssigneeToAddressBook);
    expect(result.current.handleSaveResourceFromAnywhere).toBe(first.handleSaveResourceFromAnywhere);
    expect(result.current.handleCloseResourceFromAnywhere).toBe(first.handleCloseResourceFromAnywhere);
  });
});
