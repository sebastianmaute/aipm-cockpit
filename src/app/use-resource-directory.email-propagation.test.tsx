import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useResourceDirectory } from "./use-resource-directory";
import { useUndoStack } from "./undo/use-undo-stack";
import { t } from "./i18n";
import type { RaidItem, Resource, Task } from "./types";

const wrapper = ({ children }: { children: ReactNode }) => (
  <FiltersProvider><WorkspaceProvider>{children}</WorkspaceProvider></FiltersProvider>
);

const ada: Resource = { id: 7, firstName: "Ada", lastName: "L", email: "old@x.com", roleId: null, utilizationMode: "percent", utilization: {} };
const linkedTask = { id: 1, taskName: "T", assignee: "Ada L", assigneeEmail: "old@x.com", resourceId: 7, dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do" } as Task;
const otherTask = { ...linkedTask, id: 2, assigneeEmail: "own@x.com" } as Task;
const linkedRaid = { id: 1, category: "R", title: "Risk", ownerResourceId: 7, ownerEmail: "old@x.com", escalations: [{ at: "2026-05-20T09:30:00.000Z", toEmail: "old@x.com", toResourceId: 7 }] } as unknown as RaidItem;

function renderDirectory() {
  const showToastAction = vi.fn();
  const logUpdate = vi.fn();
  const { result } = renderHook(() => {
    const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction });
    const directory = useResourceDirectory({
      lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(),
      captureComposite: undo.captureComposite, captureFieldEdit: undo.captureFieldEdit, logUpdate,
    });
    return { undo, directory, ws: useWorkspace() };
  }, { wrapper });
  act(() => {
    result.current.ws.setResources([ada]);
    result.current.ws.setTasks([linkedTask, otherTask]);
    result.current.ws.setRaid([linkedRaid]);
    result.current.ws.setProject({ name: "P", contactPersons: [{ name: "Ada L", email: "old@x.com", synced: true, resourceId: 7 }] } as never);
  });
  return { result, showToastAction, logUpdate };
}

describe("handleSaveResource propagates a corrected email (spec Part 7)", () => {
  it("updates linked copies as ONE undo entry, names the count, and logs one resource.updated", () => {
    const { result, showToastAction, logUpdate } = renderDirectory();
    act(() => { result.current.directory.handleEditResource(ada); });
    act(() => { result.current.directory.handleSaveResource({ ...ada, email: "new@x.com" }); });
    expect(result.current.ws.resources[0].email).toBe("new@x.com");
    expect(result.current.ws.tasks.map((r) => r.assigneeEmail)).toEqual(["new@x.com", "own@x.com"]);
    expect(result.current.ws.raid[0].ownerEmail).toBe("new@x.com");
    expect(result.current.ws.raid[0].escalations?.[0].toEmail).toBe("old@x.com");
    expect(result.current.ws.project?.contactPersons[0].email).toBe("new@x.com");
    expect(result.current.undo.stack).toHaveLength(1);
    expect(showToastAction).toHaveBeenCalledTimes(1);
    expect(showToastAction).toHaveBeenLastCalledWith("info", t("en-US", "undoToastResourceEmailPropagated", 3), expect.anything());
    expect(logUpdate).toHaveBeenCalledTimes(1);
    expect(logUpdate).toHaveBeenCalledWith("resource.updated", expect.anything(), expect.anything(), 7, "Ada L");

    act(() => { result.current.undo.undo(); });
    expect(result.current.ws.resources[0].email).toBe("old@x.com");
    expect(result.current.ws.tasks.map((r) => r.assigneeEmail)).toEqual(["old@x.com", "own@x.com"]);
    expect(result.current.ws.raid[0].ownerEmail).toBe("old@x.com");
    expect(result.current.ws.project?.contactPersons[0].email).toBe("old@x.com");
    expect(result.current.undo.stack).toHaveLength(0);

    act(() => { result.current.undo.redo(); });
    expect(result.current.ws.resources[0].email).toBe("new@x.com");
    expect(result.current.ws.tasks[0].assigneeEmail).toBe("new@x.com");
    expect(result.current.ws.raid[0].ownerEmail).toBe("new@x.com");
    expect(result.current.ws.project?.contactPersons[0].email).toBe("new@x.com");
  });

  it("keeps the plain edit toast and the per-field capture when nothing propagates", () => {
    const { result, showToastAction } = renderDirectory();
    act(() => { result.current.directory.handleEditResource(ada); });
    act(() => { result.current.directory.handleSaveResource({ ...ada, title: "Lead" }); });
    expect(showToastAction).toHaveBeenLastCalledWith("info", t("en-US", "undoToastEdit", 1), expect.anything());
    expect(result.current.ws.tasks[0].assigneeEmail).toBe("old@x.com");
  });
});
