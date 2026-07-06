import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { applyChangeStatus, useChangeLog } from "./use-change-log";
import type { ChangeItem } from "./types";
import type { ActivityKind } from "./activity-log";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

function ci(over: Partial<ChangeItem> = {}): ChangeItem {
  return { id: 1, title: "t", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], ...over };
}

describe("applyChangeStatus", () => {
  it("auto-fills decisionDate when leaving the pending set", () => {
    const next = applyChangeStatus(ci({ status: "Proposed" }), "Approved", "2026-06-09");
    expect(next.status).toBe("Approved");
    expect(next.decisionDate).toBe("2026-06-09");
  });
  it("keeps an existing decisionDate rather than overwriting", () => {
    const next = applyChangeStatus(ci({ status: "Approved", decisionDate: "2026-06-05" }), "Implemented", "2026-06-09");
    expect(next.decisionDate).toBe("2026-06-05");
  });
  it("clears decisionDate when returning to a pending status", () => {
    const next = applyChangeStatus(ci({ status: "Approved", decisionDate: "2026-06-05" }), "Under Review", "2026-06-09");
    expect(next.decisionDate).toBeUndefined();
  });
});

describe("useChangeLog — logActivity", () => {
  it("logs change.created when saving a new item", () => {
    const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
    const { result } = renderHook(
      () => useChangeLog({ today: "2026-06-09", logActivity }),
      { wrapper: Wrapper },
    );

    act(() => result.current.handleSaveChange(ci({ id: 7, title: "New feature" })));

    expect(logActivity).toHaveBeenCalledOnce();
    expect(logActivity).toHaveBeenCalledWith("change.created", 7, "New feature");
  });

  it("logs change.updated when saving an existing item", () => {
    const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
    const { result } = renderHook(
      () => useChangeLog({ today: "2026-06-09", logActivity }),
      { wrapper: Wrapper },
    );

    // First save creates it
    act(() => result.current.handleSaveChange(ci({ id: 3, title: "Existing" })));
    logActivity.mockClear();

    // Second save with same id updates it
    act(() => result.current.handleSaveChange(ci({ id: 3, title: "Renamed" })));

    expect(logActivity).toHaveBeenCalledOnce();
    expect(logActivity).toHaveBeenCalledWith("change.updated", 3, "Renamed");
  });

  it("logs change.deleted when deleting an item", () => {
    const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
    const { result } = renderHook(
      () => useChangeLog({ today: "2026-06-09", logActivity }),
      { wrapper: Wrapper },
    );

    act(() => result.current.handleSaveChange(ci({ id: 5, title: "To delete" })));
    logActivity.mockClear();

    act(() => result.current.handleDeleteChange(5, "To delete"));

    expect(logActivity).toHaveBeenCalledOnce();
    expect(logActivity).toHaveBeenCalledWith("change.deleted", 5, "To delete");
  });

  it("logs change.updated WITH a per-field diff when logActivityChanges is wired (#22)", () => {
    const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
    const logActivityChanges =
      vi.fn<(kind: ActivityKind, changes: readonly { field: string; from: string; to: string }[], ...args: (string | number)[]) => void>();
    const { result } = renderHook(
      () => useChangeLog({ today: "2026-06-09", logActivity, logActivityChanges }),
      { wrapper: Wrapper },
    );

    act(() => result.current.handleSaveChange(ci({ id: 3, title: "Existing", status: "Proposed" })));
    logActivity.mockClear();
    logActivityChanges.mockClear();

    act(() => result.current.handleSaveChange(ci({ id: 3, title: "Renamed", status: "Approved" })));

    // Update routes through the diff logger, NOT the plain one.
    expect(logActivity).not.toHaveBeenCalled();
    expect(logActivityChanges).toHaveBeenCalledOnce();
    const [kind, changes, id, title] = logActivityChanges.mock.calls[0];
    expect(kind).toBe("change.updated");
    expect(id).toBe(3);
    expect(title).toBe("Renamed");
    const fields = changes.map((c) => c.field).sort();
    expect(fields).toContain("title");
    expect(fields).toContain("status");
    const titleChange = changes.find((c) => c.field === "title");
    expect(titleChange).toEqual({ field: "title", from: "Existing", to: "Renamed" });
  });

  it("persists every one of N back-to-back saves in a single tick (bulk edit)", () => {
    const { result } = renderHook(() => useChangeLog({ today: "2026-06-09" }), { wrapper: Wrapper });
    act(() => result.current.handleSaveChange(ci({ id: 1, title: "A" })));
    act(() => result.current.handleSaveChange(ci({ id: 2, title: "B" })));
    // Two updates dispatched in ONE tick (as a bulk apply does) — both must
    // compose; a stale-closure setter would let the last write clobber the first.
    act(() => {
      result.current.handleSaveChange(ci({ id: 1, title: "A2" }));
      result.current.handleSaveChange(ci({ id: 2, title: "B2" }));
    });
    const titles = result.current.changes
      .filter((c) => c.id === 1 || c.id === 2)
      .sort((a, b) => a.id - b.id)
      .map((c) => c.title);
    expect(titles).toEqual(["A2", "B2"]);
  });
});
