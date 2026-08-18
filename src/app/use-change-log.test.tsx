import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { applyChangeStatus } from "./change-log";
import { useChangeLog } from "./use-change-log";
import { useUndoStack } from "./undo/use-undo-stack";
import type { ChangeItem } from "./types";
import type { Lang } from "./i18n";
import type { ActivityKind } from "./activity-log";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

// Mounts a REAL useUndoStack beside the feature hook (rather than a mocked
// capture/captureFieldRows) so a bulk-edit undo actually reverts through the
// live setter — needed to prove a concurrent write survives it, not merely
// that the right args were passed. Mirrors use-resource-planner.undo.test.tsx.
function renderChangeLogWithRealUndo() {
  const logActivity = vi.fn();
  const showToast = vi.fn();
  const { result } = renderHook(
    () => {
      const undoApi = useUndoStack({
        lang: "en-US" as Lang,
        logActivity,
        showToast,
        showToastAction: vi.fn(),
      });
      const changeLog = useChangeLog({
        today: "2026-06-09",
        logActivity,
        showToast,
        captureFieldRows: undoApi.captureFieldRows,
      });
      const workspace = useWorkspace();
      return { changeLog, workspace, undo: undoApi.undo };
    },
    { wrapper: Wrapper },
  );
  return { result };
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

  it("captures the deleted change for undo before removing it", () => {
    const capture = vi.fn();
    const { result } = renderHook(
      () => useChangeLog({ today: "2026-06-09", capture }),
      { wrapper: Wrapper },
    );
    act(() => result.current.handleSaveChange(ci({ id: 5, title: "To delete" })));
    act(() => result.current.handleDeleteChange(5, "To delete"));
    expect(capture).toHaveBeenCalledTimes(1);
    const opts = capture.mock.calls[0][0] as { kind: string; removed: { id: number }[] };
    expect(opts.kind).toBe("change.deleted");
    expect(opts.removed.map((c) => c.id)).toEqual([5]);
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

  it("re-mints a known-create whose open-time id was taken since — no clobber (id-mint race)", () => {
    const { result } = renderHook(() => useChangeLog({ today: "2026-06-09" }), { wrapper: Wrapper });
    // A concurrent writer committed id 1 after this modal opened at id 1.
    act(() => result.current.handleSaveChange(ci({ id: 1, title: "Existing" })));
    // The modal now saves as a KNOWN create (isNew=true).
    act(() => result.current.handleSaveChange(ci({ id: 1, title: "Fresh" }), true));
    expect(result.current.changes).toHaveLength(2);
    expect(result.current.changes.find((c) => c.title === "Existing")).toBeTruthy();
    const fresh = result.current.changes.find((c) => c.title === "Fresh");
    expect(fresh).toBeTruthy();
    expect(fresh?.id).not.toBe(1);
  });

  it("surfaces a toast and drops the edit when the row was concurrently deleted (no silent no-op)", () => {
    const showToast = vi.fn();
    const { result } = renderHook(
      () => useChangeLog({ today: "2026-06-09", lang: "en-US", showToast }),
      { wrapper: Wrapper },
    );
    // Editing (isNew=false) a row that is NOT in the list — deleted by a concurrent writer.
    act(() => result.current.handleSaveChange(ci({ id: 9, title: "Ghost" }), false));
    expect(result.current.changes).toHaveLength(0);
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
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

  // ★★ open-followups §50, changes half. ChangeItem gained a note log in
  //   0.245.0, putting the changes register inside the whole-row bulk-edit
  //   clobber the RAID register already had. captureBulkUndo now takes field
  //   patches and routes through captureFieldRows, which merges only the
  //   captured keys back onto the LIVE row on undo.
  //   ★★★ The note is seeded AFTER the bulk apply, not before — seeding it
  //   first would pass against the unfixed whole-row capture too (§48 trap).
  it("undoing a changes bulk edit keeps a note added since the apply", () => {
    const { result } = renderChangeLogWithRealUndo();
    const item1 = ci({ id: 1, title: "Change one", impact: "Low" });
    const item2 = ci({ id: 2, title: "Change two", impact: "Low" });
    act(() => { result.current.workspace.setChanges([item1, item2]); });

    act(() => {
      result.current.changeLog.captureBulkUndo([
        { id: 1, before: { impact: "Low" }, after: { impact: "High" } },
        { id: 2, before: { impact: "Low" }, after: { impact: "High" } },
      ]);
      result.current.changeLog.handleSaveChange({ ...item1, impact: "High" }, undefined, { suppressFieldUndo: true });
      result.current.changeLog.handleSaveChange({ ...item2, impact: "High" }, undefined, { suppressFieldUndo: true });
    });

    // A note lands through the write-through notes window AFTER the bulk apply.
    act(() => {
      result.current.workspace.setChanges((prev) =>
        prev.map((c) =>
          c.id === 1
            ? {
                ...c,
                noteLog: [
                  ...(c.noteLog ?? []),
                  { id: 1, timestamp: "2026-06-10T00:00:00.000Z", html: "<p>added after the bulk edit</p>", text: "added after the bulk edit" },
                ],
              }
            : c,
        ),
      );
    });

    act(() => { result.current.undo(); });

    const changeById = (id: number) => result.current.workspace.changes.find((c) => c.id === id)!;
    expect(changeById(1).impact).toBe("Low");
    expect(changeById(1).noteLog?.map((n) => n.text)).toEqual(["added after the bulk edit"]);
    expect(changeById(2).impact).toBe("Low");
  });
});
