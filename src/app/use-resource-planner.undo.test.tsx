// src/app/use-resource-planner.undo.test.tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import type { RaidItem, Resource } from "./types";
import type { Lang } from "./i18n";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { FiltersProvider } from "./filters-context";
import {
  useResourcePlanner,
  type UseResourcePlannerArgs,
} from "./use-resource-planner";

function makeArgs(
  overrides?: Partial<UseResourcePlannerArgs>,
): UseResourcePlannerArgs {
  return {
    lang: "en-US" as Lang,
    today: "2026-06-20",
    logActivity: vi.fn(),
    showToast: vi.fn(),
    workdayHours: 8,
    holidaySet: new Set<string>(),
    ...overrides,
  };
}

function renderPlanner(overrides?: Partial<UseResourcePlannerArgs>) {
  const logActivity = vi.fn();
  const showToast = vi.fn();
  const args = makeArgs({ logActivity, showToast, ...overrides });
  const { result } = renderHook(
    () => ({
      planner: useResourcePlanner(args),
      workspace: useWorkspace(),
    }),
    {
      wrapper: ({ children }) => (
        <FiltersProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </FiltersProvider>
      ),
    },
  );
  return { result, logActivity, showToast };
}

describe("useResourcePlanner — per-field edit undo", () => {
  beforeEach(() => {
    __resetMintStateForTests();
  });

  it("handleSaveRaidItem captures a per-field undo entry when an existing RAID item is edited", () => {
    const captureFieldEdit = vi.fn();
    const { result } = renderPlanner({ captureFieldEdit });
    const item: RaidItem = {
      id: 1,
      category: "R",
      title: "Budget risk",
      description: "May overspend",
      severity: "High",
      status: "Open",
      owner: "Alice",
      ownerEmail: "alice@test.com",
      mitigation: undefined,
      linkedTaskIds: [],
      causedByRaidIds: [],
      stakeholderIds: [],
      raisedDate: "2026-05-20",
      targetDate: undefined,
      localModifiedAt: "2026-05-20T00:00:00.000Z",
    };
    act(() => { result.current.workspace.setRaid([item]); });
    captureFieldEdit.mockClear();
    act(() => {
      result.current.planner.handleSaveRaidItem({ ...item, title: "Budget risk (revised)" });
    });
    expect(captureFieldEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "raid.updated",
        id: 1,
        before: { title: "Budget risk" },
        after: { title: "Budget risk (revised)" },
      }),
    );
  });

  it("handleSaveResource captures a per-field undo entry when an existing resource is edited", () => {
    const captureFieldEdit = vi.fn();
    const { result } = renderPlanner({ captureFieldEdit });
    const resource: Resource = {
      id: 2,
      firstName: "Marc",
      lastName: "Jordan",
      roleId: null,
      utilizationMode: "percent",
      utilization: {},
    };
    act(() => { result.current.workspace.setResources([resource]); });
    captureFieldEdit.mockClear();
    act(() => {
      result.current.planner.handleSaveResource({ ...resource, title: "Lead" });
    });
    expect(captureFieldEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "resource.updated",
        id: 2,
        before: { title: undefined },
        after: { title: "Lead" },
      }),
    );
  });

  it("handleSaveRaidItem does NOT capture a field edit on create", () => {
    const captureFieldEdit = vi.fn();
    const { result } = renderPlanner({ captureFieldEdit });
    const item: RaidItem = {
      id: 1,
      category: "R",
      title: "Budget risk",
      description: "May overspend",
      severity: "High",
      status: "Open",
      owner: "Alice",
      ownerEmail: "alice@test.com",
      mitigation: undefined,
      linkedTaskIds: [],
      causedByRaidIds: [],
      stakeholderIds: [],
      raisedDate: "2026-05-20",
      targetDate: undefined,
      localModifiedAt: "2026-05-20T00:00:00.000Z",
    };
    act(() => { result.current.planner.handleSaveRaidItem(item); });
    expect(captureFieldEdit).not.toHaveBeenCalled();
  });
});
