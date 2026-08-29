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

  it("captures the deleted stakeholder for undo before removing it", () => {
    const capture = vi.fn();
    const { result } = renderHook(
      () => useStakeholders({ today: "2026-06-09", capture }),
      { wrapper: Wrapper },
    );
    act(() => result.current.handleSaveStakeholder(mk(7)));
    act(() => result.current.handleDeleteStakeholder(7, "S7"));
    expect(capture).toHaveBeenCalledTimes(1);
    const opts = capture.mock.calls[0][0] as { kind: string; removed: { id: number }[] };
    expect(opts.kind).toBe("stakeholder.deleted");
    expect(opts.removed.map((s) => s.id)).toEqual([7]);
  });

  it("routes stakeholder.updated through logActivityChanges with a diff (#22)", () => {
    const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
    const logActivityChanges =
      vi.fn<(kind: ActivityKind, changes: readonly { field: string; from: string; to: string }[], ...args: (string | number)[]) => void>();
    const { result } = renderHook(
      () => useStakeholders({ today: "2026-06-09", logActivity, logActivityChanges }),
      { wrapper: Wrapper },
    );

    act(() => result.current.handleSaveStakeholder(mk(5)));
    logActivity.mockClear();
    logActivityChanges.mockClear();

    act(() => result.current.handleSaveStakeholder({ ...mk(5), name: "Updated", influence: "High" }));

    expect(logActivity).not.toHaveBeenCalled();
    expect(logActivityChanges).toHaveBeenCalledOnce();
    const [kind, changes, id, name] = logActivityChanges.mock.calls[0];
    expect(kind).toBe("stakeholder.updated");
    expect(id).toBe(5);
    expect(name).toBe("Updated");
    expect(changes.find((c) => c.field === "influence")).toEqual({
      field: "influence",
      from: "Medium",
      to: "High",
    });
  });

  it("re-mints a known-create whose open-time id was taken since — no clobber (id-mint race)", () => {
    const { result } = renderHook(() => useStakeholders({ today: "2026-06-09" }), { wrapper: Wrapper });
    // A concurrent writer committed id 1 after this modal opened at id 1.
    act(() => result.current.handleSaveStakeholder(mk(1)));
    // The modal now saves as a KNOWN create (isNew=true).
    act(() => result.current.handleSaveStakeholder({ ...mk(1), name: "Fresh" }, true));
    // Both survive; the create got a fresh id instead of clobbering the row.
    expect(result.current.stakeholders).toHaveLength(2);
    expect(result.current.stakeholders.find((s) => s.name === "S1")).toBeTruthy();
    const fresh = result.current.stakeholders.find((s) => s.name === "Fresh");
    expect(fresh).toBeTruthy();
    expect(fresh?.id).not.toBe(1);
  });

  it("surfaces a toast and drops the edit when the row was concurrently deleted (no silent no-op)", () => {
    const showToast = vi.fn();
    const { result } = renderHook(
      () => useStakeholders({ today: "2026-06-09", lang: "en-US", showToast }),
      { wrapper: Wrapper },
    );
    // Editing (isNew=false) a row that is NOT in the list — deleted by a concurrent writer.
    act(() => result.current.handleSaveStakeholder({ ...mk(9), name: "Ghost" }, false));
    expect(result.current.stakeholders).toHaveLength(0);
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
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

describe("useStakeholders — delete arms the destructive-save bypass", () => {
  it("arms once for a stakeholder that exists", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderHook(
      () => useStakeholders({ today: "2026-06-09", allowDestructiveSave }),
      { wrapper: Wrapper },
    );
    act(() => result.current.handleSaveStakeholder(mk(1)));
    expect(result.current.stakeholders).toHaveLength(1);
    const victim = result.current.stakeholders[0]!;
    act(() => { result.current.handleDeleteStakeholder(victim.id, victim.name); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("does NOT arm for an id that does not exist", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderHook(
      () => useStakeholders({ today: "2026-06-09", allowDestructiveSave }),
      { wrapper: Wrapper },
    );
    act(() => result.current.handleSaveStakeholder(mk(1)));
    act(() => { result.current.handleDeleteStakeholder(999_999, "ghost"); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    // POSITIVE CONTROL
    const victim = result.current.stakeholders[0]!;
    act(() => { result.current.handleDeleteStakeholder(victim.id, victim.name); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("does not throw when no bypass is supplied", () => {
    const { result } = renderHook(() => useStakeholders({ today: "2026-06-09" }), { wrapper: Wrapper });
    act(() => result.current.handleSaveStakeholder(mk(1)));
    const victim = result.current.stakeholders[0]!;
    expect(() => {
      act(() => { result.current.handleDeleteStakeholder(victim.id, victim.name); });
    }).not.toThrow();
  });
});
