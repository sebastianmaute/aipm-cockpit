import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { useStakeholders } from "./use-stakeholders";
import type { Stakeholder } from "./types";
import type { ActivityKind } from "./activity-log";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const mk = (id: number): Stakeholder => ({
  id,
  name: `S${id}`,
  category: "Internal",
  influence: "Medium",
  interest: "Medium",
  raci: {},
});

describe("useStakeholders", () => {
  it("adds, updates, and deletes", () => {
    const { result } = renderHook(
      () => useStakeholders({ today: "2026-06-04" }),
      { wrapper: Wrapper },
    );

    act(() => result.current.handleSaveStakeholder(mk(1)));
    expect(result.current.stakeholders).toHaveLength(1);
    expect(result.current.stakeholders[0].localModifiedAt).toBeTruthy();

    act(() => result.current.handleSaveStakeholder({ ...mk(1), name: "Renamed" }));
    expect(result.current.stakeholders).toHaveLength(1);
    expect(result.current.stakeholders[0].name).toBe("Renamed");

    act(() => result.current.handleDeleteStakeholder(1, "Renamed"));
    expect(result.current.stakeholders).toHaveLength(0);
  });
});

describe("useStakeholders — logActivity", () => {
  it("logs stakeholder.created when saving a new item", () => {
    const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
    const { result } = renderHook(
      () => useStakeholders({ today: "2026-06-09", logActivity }),
      { wrapper: Wrapper },
    );

    act(() => result.current.handleSaveStakeholder(mk(3)));

    expect(logActivity).toHaveBeenCalledOnce();
    expect(logActivity).toHaveBeenCalledWith("stakeholder.created", 3, "S3");
  });

  it("logs stakeholder.updated when saving an existing item", () => {
    const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
    const { result } = renderHook(
      () => useStakeholders({ today: "2026-06-09", logActivity }),
      { wrapper: Wrapper },
    );

    act(() => result.current.handleSaveStakeholder(mk(5)));
    logActivity.mockClear();

    act(() => result.current.handleSaveStakeholder({ ...mk(5), name: "Updated" }));

    expect(logActivity).toHaveBeenCalledOnce();
    expect(logActivity).toHaveBeenCalledWith("stakeholder.updated", 5, "Updated");
  });

  it("logs stakeholder.deleted when deleting an item", () => {
    const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
    const { result } = renderHook(
      () => useStakeholders({ today: "2026-06-09", logActivity }),
      { wrapper: Wrapper },
    );

    act(() => result.current.handleSaveStakeholder(mk(7)));
    logActivity.mockClear();

    act(() => result.current.handleDeleteStakeholder(7, "S7"));

    expect(logActivity).toHaveBeenCalledOnce();
    expect(logActivity).toHaveBeenCalledWith("stakeholder.deleted", 7, "S7");
  });

  it("persists every one of N back-to-back saves in a single tick (bulk edit)", () => {
    const { result } = renderHook(() => useStakeholders({ today: "2026-06-09" }), { wrapper: Wrapper });
    act(() => result.current.handleSaveStakeholder(mk(1)));
    act(() => result.current.handleSaveStakeholder(mk(2)));
    // Two updates in ONE tick (a bulk apply) — both must compose, not clobber.
    act(() => {
      result.current.handleSaveStakeholder({ ...mk(1), influence: "High" });
      result.current.handleSaveStakeholder({ ...mk(2), influence: "Low" });
    });
    expect(result.current.stakeholders.find((s) => s.id === 1)?.influence).toBe("High");
    expect(result.current.stakeholders.find((s) => s.id === 2)?.influence).toBe("Low");
  });
});
