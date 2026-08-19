// src/app/use-resource-planner.undo.test.tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import type { RaidItem, Resource } from "./types";
import type { Lang } from "./i18n";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { FiltersProvider } from "./filters-context";
import { useUndoStack } from "./undo/use-undo-stack";
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
    captureFieldRows: vi.fn(),
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

// Mounts a REAL useUndoStack beside the planner (rather than a mocked
// captureFieldEdit/captureFieldRows) so a bulk-edit undo actually reverts
// through the live setter — needed to prove a concurrent write survives it,
// not merely that the right args were passed.
// ★★★ BOTH `capture` AND `captureFieldRows` are wired, and the FIRST one is
//   what makes the bulk-edit test below discriminate for the RIGHT reason.
//   `captureRaidBulkUndo` only reaches `captureFieldRows`; wiring that one
//   alone means a regression to the old WHOLE-ROW capture would find
//   `capture` undefined, capture NOTHING, and make `undo()` a silent no-op —
//   the test would go red on the "the bulk edit was reverted" assertion (a
//   misleading diagnosis) and go green again the moment someone wired
//   `capture` up. With both live, the regression captures whole rows and
//   CLOBBERS the concurrent write, which is what the test is named for.
function renderPlannerWithRealUndo(overrides?: Partial<UseResourcePlannerArgs>) {
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
      const planner = useResourcePlanner(
        makeArgs({ logActivity, showToast, capture: undoApi.capture, captureFieldRows: undoApi.captureFieldRows, ...overrides }),
      );
      const workspace = useWorkspace();
      return { planner, workspace, undo: undoApi.undo };
    },
    {
      wrapper: ({ children }) => (
        <FiltersProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </FiltersProvider>
      ),
    },
  );
  return { result };
}

describe("useResourcePlanner — per-field edit undo", () => {
  beforeEach(() => {
    __resetMintStateForTests();
  });

  // ★★ open-followups §50, RAID half. The bulk-edit capture used to snapshot
  //   WHOLE rows, so undoing a bulk severity change also reverted a note added
  //   through the notes window after the bulk apply. captureRaidBulkUndo now
  //   takes field patches and routes through captureFieldRows, which merges
  //   only the captured keys back onto the LIVE row on undo.
  //   ★★★ The note is seeded AFTER the bulk apply, not before — seeding it
  //   first would pass against the unfixed whole-row capture too (the same
  //   §48 trap already paid for once in this file).
  //   ★★★ ANTI-VACUITY: the noteLog assertion ALONE cannot fail. `noteLog` is
  //   on `WRITE_THROUGH_FIELDS` (undo/use-undo-stack.ts), so even a whole-row
  //   restore preserves it — that is Part A, the backstop, and it holds with
  //   the field-patch capture (Part B) reverted. `owner` is an ordinary
  //   `RaidItem` field on NEITHER backstop list, so a whole-row restore
  //   reverts it to the pre-apply snapshot ("Alice") while the field-patch
  //   capture merges back only `severity` and leaves it at "Priya". It is the
  //   assertion that actually distinguishes Part B from Part A.
  it("undoing a RAID bulk edit keeps a note (and any other concurrent field write) added since the apply", () => {
    const { result } = renderPlannerWithRealUndo();
    const item1: RaidItem = {
      id: 1, category: "R", title: "Budget risk", description: "May overspend",
      severity: "Low", status: "Open", owner: "Alice", ownerEmail: "alice@test.com",
      mitigation: undefined, linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [],
      raisedDate: "2026-05-20", targetDate: undefined,
      localModifiedAt: "2026-05-20T00:00:00.000Z",
    };
    const item2: RaidItem = {
      id: 2, category: "R", title: "Vendor risk", description: "May slip",
      severity: "Low", status: "Open", owner: "Bob", ownerEmail: "bob@test.com",
      mitigation: undefined, linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [],
      raisedDate: "2026-05-20", targetDate: undefined,
      localModifiedAt: "2026-05-20T00:00:00.000Z",
    };
    act(() => { result.current.workspace.setRaid([item1, item2]); });

    act(() => {
      result.current.planner.captureRaidBulkUndo([
        { id: 1, before: { severity: "Low" }, after: { severity: "High" } },
        { id: 2, before: { severity: "Low" }, after: { severity: "High" } },
      ]);
      result.current.planner.handleSaveRaidItem({ ...item1, severity: "High" }, undefined, { suppressFieldUndo: true });
      result.current.planner.handleSaveRaidItem({ ...item2, severity: "High" }, undefined, { suppressFieldUndo: true });
    });

    // Two concurrent writes land on row 1 AFTER the bulk apply — a note through
    // the write-through notes window, and a plain field edit (owner reassigned)
    // that has no backstop at all. Neither is something the bulk edit's undo
    // wrote, so neither should be reverted by it.
    act(() => {
      result.current.workspace.setRaid((prev) =>
        prev.map((r) =>
          r.id === 1
            ? {
                ...r,
                owner: "Priya",
                noteLog: [
                  ...(r.noteLog ?? []),
                  { id: 1, timestamp: "2026-05-21T00:00:00.000Z", html: "<p>added after the bulk edit</p>", text: "added after the bulk edit" },
                ],
              }
            : r,
        ),
      );
    });

    act(() => { result.current.undo(); });

    const raidById = (id: number) => result.current.workspace.raid.find((r) => r.id === id)!;
    expect(raidById(1).severity).toBe("Low");
    expect(raidById(1).noteLog?.map((n) => n.text)).toEqual(["added after the bulk edit"]);
    expect(raidById(1).owner).toBe("Priya");
    expect(raidById(2).severity).toBe("Low");
  });

  // ★★★ open-followups §48, the UNDO half. `RAID_UNDO_GROUPS` is `[]`, so
  //   `captureFieldChanges` diffs fields individually — a stale `noteLog` on the
  //   save payload is therefore not merely saved, it is RECORDED as a field edit
  //   and becomes undoable/redoable state.
  //   ★ The fix is SINGLE-SITE — on the `withStamp` build (`use-resource-planner.ts`).
  //   An earlier draft had a second merge inside `setRaid`; it was removed, so
  //   reverting the one site now fails the save-path test too, not only this one.
  //   ★ This test still earns its place: it pins a DISTINCT property — that no
  //   spurious `noteLog` undo entry is recorded — which a future setter-only merge
  //   would silently break while the save-path test stayed green.
  it("handleSaveRaidItem never records a stale noteLog as an undoable field edit", () => {
    const captureFieldEdit = vi.fn();
    const { result } = renderPlanner({ captureFieldEdit });
    const note = (id: number, text: string) => ({
      id, timestamp: `2026-05-2${id}T00:00:00.000Z`, html: `<p>${text}</p>`, text,
    });
    const item: RaidItem = {
      id: 1, category: "R", title: "Budget risk", description: "May overspend",
      severity: "High", status: "Open", owner: "Alice", ownerEmail: "alice@test.com",
      mitigation: undefined, linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [],
      raisedDate: "2026-05-20", targetDate: undefined,
      localModifiedAt: "2026-05-20T00:00:00.000Z",
      noteLog: [note(1, "first")],
    };
    act(() => { result.current.workspace.setRaid([item]); });
    const staleDraft: RaidItem = { ...item };
    // A note lands through the write-through window while the editor is open.
    act(() => {
      result.current.workspace.setRaid((prev) =>
        prev.map((r) => (r.id === 1 ? { ...r, noteLog: [...(r.noteLog ?? []), note(2, "added while open")] } : r)),
      );
    });
    captureFieldEdit.mockClear();
    act(() => {
      result.current.planner.handleSaveRaidItem({ ...staleDraft, title: "Budget risk (revised)" });
    });
    // ★ `changedFieldGroups` emits ONE call PER changed key, so asserting on
    //   calls[0] alone is vacuous — that one is `title`, and a captured
    //   `noteLog` would be a LATER call. Assert over every call.
    const captured = captureFieldEdit.mock.calls.flatMap(
      (c) => Object.keys((c[0] as { before: object }).before),
    );
    expect(captured).toEqual(["title"]);
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
