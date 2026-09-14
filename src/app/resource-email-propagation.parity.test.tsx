import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { TestProviders, type TestSeed } from "./test-providers";
import { resetMintState } from "./id-mint-session";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useResourceDirectory } from "./use-resource-directory";
import { useUndoStack } from "./undo/use-undo-stack";
import { useWorkspace } from "./workspace-context";
import { entityToken } from "./ai-entity-token";
import { runTool } from "./chat-tools";
import { t } from "./i18n";
import type { Resource, Task } from "./types";

const ada: Resource = { id: 7, firstName: "Ada", lastName: "L", email: "old@x.com", roleId: null, utilizationMode: "percent", utilization: {} };
const seed: TestSeed = {
  resources: [ada],
  tasks: [
    { id: 1, taskName: "Linked", assignee: "Ada L", assigneeEmail: "OLD@x.com ", resourceId: 7, dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do" } as Task,
    { id: 2, taskName: "Jira", assignee: "Ada L", assigneeEmail: "old@x.com", resourceId: 7, jiraKey: "LOP-1", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do" } as Task,
    { id: 3, taskName: "Other person", assignee: "Bob", assigneeEmail: "old@x.com", resourceId: 8, dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do" } as Task,
    { id: 4, taskName: "Override", assignee: "Ada L", assigneeEmail: "ada.private@x.com", resourceId: 7, dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do" } as Task,
  ],
  raid: [{ id: 1, category: "R", title: "Risk", ownerResourceId: 7, ownerEmail: "old@x.com", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-06-01", escalations: [{ at: "2026-05-20T09:30:00.000Z", toEmail: "old@x.com", toResourceId: 7 }] } as never],
  stakeholders: [{ id: 1, name: "Ada L", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "old@x.com", resourceId: 7 } as never],
  absences: [{ id: 1, assignee: "Ada L", assigneeEmail: "old@x.com", resourceId: 7, startDate: "2026-06-01", endDate: "2026-06-02", type: "vacation" } as never],
  shifts: [{ id: 1, assignee: "Ada L", assigneeEmail: "old@x.com", resourceId: 7, hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] } as never],
  project: { name: "P", contactPersons: [{ name: "Ada L", email: "old@x.com", synced: true, resourceId: 7 }, { name: "Shared", email: "old@x.com", synced: false }] } as never,
};

function snapshot(ws: ReturnType<typeof useWorkspace>) {
  const strip = (rows: readonly object[]) => rows.map((r) => {
    const copy = { ...r } as Record<string, unknown>;
    delete copy.localModifiedAt;
    return copy;
  });
  return {
    tasks: strip(ws.tasks), raid: strip(ws.raid), absences: strip(ws.absences), shifts: strip(ws.shifts),
    stakeholders: strip(ws.stakeholders), contactPersons: ws.project?.contactPersons,
  };
}

function renderHuman() {
  const showToastAction = vi.fn();
  const human = renderHook(() => {
    const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction });
    return {
      undo,
      directory: useResourceDirectory({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), captureComposite: undo.captureComposite, captureFieldEdit: undo.captureFieldEdit, logUpdate: vi.fn() }),
      ws: useWorkspace(),
    };
  }, { wrapper: ({ children }: { children: ReactNode }) => <TestProviders seed={seed}>{children}</TestProviders> });
  return { human, showToastAction };
}

function renderAi() {
  const showToastAction = vi.fn();
  const ai = renderHook(() => {
    const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction });
    return { undo, d: useChatDispatcher(makeDispatcherArgs({ undo })), ws: useWorkspace() };
  }, { wrapper: dispatcherWrapperWith(seed) });
  return { ai, showToastAction };
}

beforeEach(() => resetMintState());

describe("human and AI resource writers propagate identically (spec Part 7 parity)", () => {
  it("produces identical linked arrays, toast and undo for the same before/after resource", () => {
    const { human, showToastAction: humanToast } = renderHuman();
    const initial = snapshot(human.result.current.ws);
    act(() => { human.result.current.directory.handleEditResource(ada); });
    act(() => { human.result.current.directory.handleSaveResource({ ...ada, email: "new@x.com" }); });

    const { ai, showToastAction: aiToast } = renderAi();
    act(() => { ai.result.current.d.updateResource(7, { email: "new@x.com" }); });

    expect(snapshot(ai.result.current.ws)).toEqual(snapshot(human.result.current.ws));
    const tasks = ai.result.current.ws.tasks;
    expect(tasks.map((r) => [r.id, r.assigneeEmail])).toEqual([[1, "new@x.com"], [2, "old@x.com"], [3, "old@x.com"], [4, "ada.private@x.com"]]);
    expect(ai.result.current.ws.raid[0].ownerEmail).toBe("new@x.com");
    expect(ai.result.current.ws.raid[0].escalations?.[0].toEmail).toBe("old@x.com");
    expect(ai.result.current.ws.project?.contactPersons.map((c) => c.email)).toEqual(["new@x.com", "old@x.com"]);

    // task 1 · RAID owner · stakeholder · absence · shift · Ada's contact person
    const text = t("en-US", "undoToastResourceEmailPropagated", 6);
    expect(humanToast).toHaveBeenLastCalledWith("info", text, expect.anything());
    expect(aiToast).toHaveBeenLastCalledWith("info", text, expect.anything());
    expect(human.result.current.undo.stack).toHaveLength(1);
    expect(ai.result.current.undo.stack).toHaveLength(1);

    act(() => { human.result.current.undo.undo(); });
    act(() => { ai.result.current.undo.undo(); });
    expect(snapshot(human.result.current.ws)).toEqual(initial);
    expect(snapshot(ai.result.current.ws)).toEqual(initial);
    expect(ai.result.current.ws.resources[0].email).toBe("old@x.com");
    expect(human.result.current.ws.resources[0].email).toBe("old@x.com");
  });

  it("keeps the plain edit toast on the AI path when nothing propagates", () => {
    const { ai, showToastAction } = renderAi();
    act(() => { ai.result.current.d.updateResource(7, { title: "Lead" }); });
    expect(showToastAction).toHaveBeenLastCalledWith("info", t("en-US", "undoToastEdit", 1), expect.anything());
    expect(ai.result.current.ws.tasks[0].assigneeEmail).toBe("OLD@x.com ");
  });

  // ★★ Fix round 1 — the AI path and the register writers share ONE ref per
  //  slice. Every case below runs several tool calls inside ONE act, so no
  //  re-render (and no ref-refreshing effect) happens between them: that is a
  //  model turn, and only a shared, advanced ref can make the calls agree.
  it("(a) a same-turn update_raid_item holding a pre-propagation token is refused, and the propagated owner email survives", async () => {
    const { ai } = renderAi();
    await act(async () => {
      const d = ai.result.current.d;
      const staleToken = entityToken("raid", d.getRaidRow(1)!);
      d.updateResource(7, { email: "new@x.com" });
      await expect(runTool(d, "update_raid_item", { id: 1, expectedToken: staleToken, title: "Overwrite" }))
        .rejects.toThrow(/changed since you read it/);
      expect(d.getRaidRow(1)?.ownerEmail).toBe("new@x.com");
    });
    expect(ai.result.current.ws.raid[0].ownerEmail).toBe("new@x.com");
    expect(ai.result.current.ws.raid[0].title).toBe("Risk");
  });

  it("(b) a RAID row created earlier in the turn survives the propagation's ref advance (and a linked row is still retargeted)", async () => {
    // ★ Not the brief's literal (b): `ownerResourceId` is NOT model-writable
    //  (`dropUnacceptedRaidFields` refuses it), so `create_raid_item` can never
    //  make an FK-linked row, and by the FK-only ruling such a row is not reached.
    //  What a stale second ref WOULD break in that turn is the created row
    //  itself: advancing the shared ref from a pre-create copy would drop it.
    const { ai, showToastAction } = renderAi();
    let createdId = 0;
    await act(async () => {
      const d = ai.result.current.d;
      const created = await runTool(d, "create_raid_item", { title: "Created this turn", owner: "Ada L", ownerEmail: "old@x.com" }) as { id: number };
      createdId = created.id;
      d.updateResource(7, { email: "new@x.com" });
      expect(d.getRaidRow(createdId)?.title).toBe("Created this turn");
      expect(d.listRaid().map((r) => r.id)).toEqual([1, createdId]);
    });
    const raid = ai.result.current.ws.raid;
    expect(raid.map((r) => [r.id, r.ownerEmail])).toEqual([[1, "new@x.com"], [createdId, "old@x.com"]]);
    expect(showToastAction).toHaveBeenLastCalledWith("info", t("en-US", "undoToastResourceEmailPropagated", 6), expect.anything());
  });

  it("(c) undoing the resource edit keeps an AI RAID edit made earlier in the same turn", async () => {
    const { ai } = renderAi();
    await act(async () => {
      const d = ai.result.current.d;
      const token = entityToken("raid", d.getRaidRow(1)!);
      await runTool(d, "update_raid_item", { id: 1, expectedToken: token, title: "Renamed this turn" });
      d.updateResource(7, { email: "new@x.com" });
    });
    expect(ai.result.current.ws.raid[0]).toMatchObject({ title: "Renamed this turn", ownerEmail: "new@x.com" });
    act(() => { ai.result.current.undo.undo(); });
    expect(ai.result.current.ws.resources[0].email).toBe("old@x.com");
    expect(ai.result.current.ws.raid[0]).toMatchObject({ title: "Renamed this turn", ownerEmail: "old@x.com" });
  });

  it("invalidates an outstanding update token on every touched TokenEntity row", () => {
    const { ai } = renderAi();
    const before = {
      task: entityToken("task", ai.result.current.ws.tasks[0]),
      untouched: entityToken("task", ai.result.current.ws.tasks[2]),
      raid: entityToken("raid", ai.result.current.ws.raid[0]),
      stakeholder: entityToken("stakeholder", ai.result.current.ws.stakeholders[0]),
      absence: entityToken("absence", ai.result.current.ws.absences[0]),
    };
    act(() => { ai.result.current.d.updateResource(7, { email: "new@x.com" }); });
    expect(entityToken("task", ai.result.current.ws.tasks[0])).not.toBe(before.task);
    expect(entityToken("task", ai.result.current.ws.tasks[2])).toBe(before.untouched);
    expect(entityToken("raid", ai.result.current.ws.raid[0])).not.toBe(before.raid);
    expect(entityToken("stakeholder", ai.result.current.ws.stakeholders[0])).not.toBe(before.stakeholder);
    expect(entityToken("absence", ai.result.current.ws.absences[0])).not.toBe(before.absence);
  });
});
