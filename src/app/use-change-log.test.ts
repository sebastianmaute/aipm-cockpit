import { test, expect, vi } from "vitest";
import type React from "react";
import { renderHook, act } from "@testing-library/react";
import { useChangeLog } from "./use-change-log";
import type { ChangeItem } from "./types";

vi.mock("./workspace-context", () => {
  let state: readonly ChangeItem[] = [];
  const setChanges = (u: React.SetStateAction<readonly ChangeItem[]>) => {
    state = typeof u === "function" ? (u as (p: readonly ChangeItem[]) => readonly ChangeItem[])(state) : u;
  };
  return {
    useWorkspace: () => ({ changes: state, setChanges }),
    __seed: (rows: readonly ChangeItem[]) => { state = rows; },
    __read: () => state,
  };
});

/** The mocked store is a module-level closure, not React state — seed it, mount
 *  the hook, then read the array back through this accessor. */
async function store() {
  return (await import("./workspace-context")) as unknown as {
    __seed: (r: readonly ChangeItem[]) => void;
    __read: () => readonly ChangeItem[];
  };
}

test("editing one field pushes a captureFieldEdit for that field", async () => {
  const mod = (await import("./workspace-context")) as unknown as { __seed: (r: readonly ChangeItem[]) => void };
  const existing = { id: 1, title: "C", description: "old" } as ChangeItem;
  mod.__seed([existing]);
  const captureFieldEdit = vi.fn();
  const { result } = renderHook(() => useChangeLog({ today: "2026-01-01", captureFieldEdit }));
  act(() => result.current.handleSaveChange({ ...existing, description: "new" }, false));
  expect(captureFieldEdit).toHaveBeenCalledTimes(1);
  expect(captureFieldEdit.mock.calls[0][0]).toMatchObject({
    kind: "change.updated", id: 1, before: { description: "old" }, after: { description: "new" },
  });
});

test("suppressFieldUndo skips the per-field capture (bulk edit path)", async () => {
  const mod = (await import("./workspace-context")) as unknown as { __seed: (r: readonly ChangeItem[]) => void };
  const existing = { id: 1, title: "C", description: "old" } as ChangeItem;
  mod.__seed([existing]);
  const captureFieldEdit = vi.fn();
  const { result } = renderHook(() => useChangeLog({ today: "2026-01-01", captureFieldEdit }));
  act(() =>
    result.current.handleSaveChange({ ...existing, description: "new" }, false, { suppressFieldUndo: true }),
  );
  expect(captureFieldEdit).not.toHaveBeenCalled();
});

test("inline status change routes through applyChangeStatus and fills decisionDate", async () => {
  const mod = await store();
  // The note log is seeded ON the stored row: it is WRITE-THROUGH (the notes
  // window commits straight to the workspace array) and no status change ever
  // carries one, so it is here purely to be preserved. `updated` is built by
  // SPREADING `previous`; rebuilding it from a field list instead would destroy
  // the log — the defect class this register already shipped twice.
  const noteLog = [{ id: 1, timestamp: "2026-08-02T09:00:00.000Z", html: "<p>keep me</p>", text: "keep me" }];
  mod.__seed([
    { id: 1, title: "Scope cut", status: "Proposed", raisedDate: "2026-08-01", noteLog,
      description: "", type: "Scope", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] },
  ]);
  const { result } = renderHook(() => useChangeLog({ today: "2026-08-17" }));
  act(() => result.current.handleChangeStatusChange(1, "Approved"));
  const row = mod.__read()[0];
  expect(row.status).toBe("Approved");
  expect(row.decisionDate).toBe("2026-08-17");
  expect(row.noteLog).toEqual(noteLog);
});

test("clears decisionDate when an inline status change returns the item to pending", async () => {
  const mod = await store();
  mod.__seed([
    { id: 1, title: "Scope cut", status: "Approved", decisionDate: "2026-08-10", raisedDate: "2026-08-01",
      description: "", type: "Scope", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] },
  ]);
  const { result } = renderHook(() => useChangeLog({ today: "2026-08-17" }));
  act(() => result.current.handleChangeStatusChange(1, "Under Review"));
  expect(mod.__read()[0].decisionDate).toBeUndefined();
});

test("inline status change captures the status/decisionDate pair as ONE undo entry", async () => {
  const mod = await store();
  mod.__seed([
    { id: 1, title: "Scope cut", status: "Proposed", raisedDate: "2026-08-01",
      description: "", type: "Scope", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] },
  ]);
  const captureFieldEdit = vi.fn();
  const logActivityChanges = vi.fn();
  const { result } = renderHook(() => useChangeLog({ today: "2026-08-17", captureFieldEdit, logActivityChanges }));
  act(() => result.current.handleChangeStatusChange(1, "Approved"));
  // CHANGE_UNDO_GROUPS pairs status with decisionDate, so the two fields ride
  // one capture — undoing the inline change must restore BOTH.
  expect(captureFieldEdit).toHaveBeenCalledTimes(1);
  expect(captureFieldEdit.mock.calls[0][0]).toMatchObject({
    kind: "change.updated", id: 1,
    before: { status: "Proposed" },
    after: { status: "Approved", decisionDate: "2026-08-17" },
  });
  expect(logActivityChanges).toHaveBeenCalledTimes(1);
});

/** A stored row carrying a note the editor's draft never saw. The collision is
 *  SEEDED on purpose: a save against an untouched log passes whichever way the
 *  handler decides, so a realistic fixture cannot tell a correct implementation
 *  from a reverted one. */
function storedWithNote(): ChangeItem {
  return {
    id: 1, title: "Scope cut", status: "Proposed", type: "Scope", description: "",
    raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
    noteLog: [{ id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>added mid-edit</p>", text: "added mid-edit" }],
  };
}

test("keeps a note added while the editor was open (write-through, not the draft snapshot)", async () => {
  const mod = await store();
  const stored = storedWithNote();
  mod.__seed([stored]);
  const { result } = renderHook(() => useChangeLog({ today: "2026-08-17" }));
  // The modal snapshotted its draft BEFORE the note existed, so it carries none.
  act(() => result.current.handleSaveChange({ ...stored, title: "Scope cut v2", noteLog: undefined }, false));
  expect(mod.__read()[0].noteLog).toHaveLength(1);
  expect(mod.__read()[0].title).toBe("Scope cut v2");
});

test("does not put a stale note log into the undo capture", async () => {
  const mod = await store();
  const stored = storedWithNote();
  mod.__seed([stored]);
  const captureFieldEdit = vi.fn();
  const { result } = renderHook(() => useChangeLog({ today: "2026-08-17", captureFieldEdit }));
  act(() => result.current.handleSaveChange({ ...stored, title: "Scope cut v2", noteLog: undefined }, false));
  // captureFieldChanges forwards {before, after} PATCHES (one per changed field
  // group), never the whole row — so the observable is that no patch names
  // noteLog at all. Restoring the log inside setChanges instead of on withStamp
  // still yields the right array but leaves prev/next disagreeing here, so the
  // stale value becomes undoable/redoable state. This is the ONLY assertion
  // that separates the two fix sites.
  expect(captureFieldEdit).toHaveBeenCalled();
  const withNoteLog = captureFieldEdit.mock.calls.filter((call) => {
    const c = call[0] as { before: Record<string, unknown>; after: Record<string, unknown> };
    return "noteLog" in c.before || "noteLog" in c.after;
  });
  expect(withNoteLog).toEqual([]);
  expect(captureFieldEdit.mock.calls[0][0]).toMatchObject({
    before: { title: "Scope cut" }, after: { title: "Scope cut v2" },
  });
});

test("inline status change on a missing id is a no-op", async () => {
  const mod = await store();
  mod.__seed([
    { id: 1, title: "Scope cut", status: "Proposed", raisedDate: "2026-08-01",
      description: "", type: "Scope", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] },
  ]);
  const captureFieldEdit = vi.fn();
  const { result } = renderHook(() => useChangeLog({ today: "2026-08-17", captureFieldEdit }));
  act(() => result.current.handleChangeStatusChange(99, "Approved"));
  expect(mod.__read()[0].status).toBe("Proposed");
  expect(captureFieldEdit).not.toHaveBeenCalled();
});
