// BrowserBackend save/load semantics around the parallel IDB writes:
//   - if ANY store write rejects, NO baseline may advance — the next save
//     must re-emit every record that was dirty (all-or-nothing), and
//   - a full save → fresh-load round-trip still works with parallel IO.
// Uses fake-indexeddb for a real IDB implementation under jsdom; the idb
// module is partially mocked so individual stores can be forced to reject
// and so the per-store deltas each save emits can be observed.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { Milestone, RaidItem, Task } from "./types";

const ctl = vi.hoisted(() => ({
  failStore: null as string | null,
  calls: [] as { store: string; putIds: number[]; deleteIds: number[] }[],
}));

vi.mock("./idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./idb")>();
  return {
    ...actual,
    idbBulkUpdate: async (
      store: string,
      puts: readonly { id: number }[],
      deleteIds: readonly number[],
    ) => {
      ctl.calls.push({
        store,
        putIds: puts.map((p) => p.id),
        deleteIds: [...deleteIds],
      });
      if (ctl.failStore === store) {
        throw new Error(`forced failure: ${store}`);
      }
      return actual.idbBulkUpdate(store, puts, deleteIds);
    },
  };
});

import { BrowserBackend } from "./browser-backend";
import type { FeatureModuleId } from "./feature-modules";
import { IDB_RAID_STORE, IDB_TASKS_STORE } from "./idb";
import { emptyWorkspace } from "./workspace";

const task = {
  id: 1,
  taskName: "Build the thing",
  assignee: "Ada",
  priority: "Medium",
  startDate: "2026-01-01",
  dueDate: "2026-01-05",
} as unknown as Task;

const raidItem = {
  id: 7,
  category: "Risk",
  title: "Scope creep",
  status: "Open",
} as unknown as RaidItem;

const milestone: Milestone = {
  id: 2,
  name: "Go live",
  date: "2026-12-01",
  linkedTaskIds: [1],
};

describe("BrowserBackend parallel IDB save/load", () => {
  beforeEach(() => {
    // Fresh in-memory IDB per test so saves don't leak across cases.
    globalThis.indexedDB = new IDBFactory();
    ctl.failStore = null;
    ctl.calls = [];
  });

  it("advances NO baseline when one store write rejects (retry re-emits everything dirty)", async () => {
    const backend = new BrowserBackend();
    const ws = { ...emptyWorkspace(), tasks: [task], raid: [raidItem] };

    // First save: the raid store write is forced to reject. The whole save
    // must reject and no baseline may advance — not even for stores whose
    // own write succeeded.
    ctl.failStore = IDB_RAID_STORE;
    await expect(backend.save(ws)).rejects.toThrow(/forced failure/);

    // Retry without the fault: every dirty record must be re-emitted. If a
    // baseline had (incorrectly) advanced for tasks, the task put would be
    // diffed away here and the record could be lost on a later failure path.
    ctl.failStore = null;
    ctl.calls = [];
    await backend.save(ws);

    const taskCall = ctl.calls.find((c) => c.store === IDB_TASKS_STORE);
    const raidCall = ctl.calls.find((c) => c.store === IDB_RAID_STORE);
    expect(taskCall?.putIds).toEqual([1]);
    expect(raidCall?.putIds).toEqual([7]);
  });

  it("save → fresh load round-trips record stores and KV blobs", async () => {
    const ws = {
      ...emptyWorkspace(),
      tasks: [task],
      raid: [raidItem],
      milestones: [milestone],
    };
    await new BrowserBackend().save(ws);

    const loaded = await new BrowserBackend().load();
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]).toMatchObject({ id: 1, taskName: "Build the thing" });
    expect(loaded.raid).toHaveLength(1);
    expect(loaded.raid[0]).toMatchObject({ id: 7, title: "Scope creep" });
    expect(loaded.milestones).toHaveLength(1);
    expect(loaded.milestones?.[0]).toMatchObject({ id: 2, name: "Go live" });
  });

  it("save → fresh load round-trips calendar events", async () => {
    const ws = {
      ...emptyWorkspace(),
      calendarEvents: [{
        id: 3, title: "Standup", startDate: "2026-01-05", startTime: "09:00", durationMinutes: 15,
      }],
    };
    await new BrowserBackend().save(ws);

    const loaded = await new BrowserBackend().load();
    expect(loaded.calendarEvents).toHaveLength(1);
    expect(loaded.calendarEvents?.[0]).toMatchObject({ id: 3, title: "Standup" });
  });

  it("save → fresh load round-trips fieldVisibility and features", async () => {
    const ws = {
      ...emptyWorkspace(),
      fieldVisibility: { task: { fields: ["taskName"] } },
      features: ["raid"] as FeatureModuleId[],
    };
    await new BrowserBackend().save(ws);

    const loaded = await new BrowserBackend().load();
    expect(loaded.fieldVisibility).toEqual({ task: { fields: ["taskName"] } });
    expect(loaded.features).toEqual(["raid"]);
  });

  it("persists features: [] (Simple mode) rather than expanding to all modules", async () => {
    const ws = { ...emptyWorkspace(), features: [] };
    await new BrowserBackend().save(ws);

    const loaded = await new BrowserBackend().load();
    expect(loaded.features).toEqual([]);
  });

  it("loads absent fieldVisibility / features as undefined (no override)", async () => {
    const ws = { ...emptyWorkspace(), tasks: [task] };
    await new BrowserBackend().save(ws);

    const loaded = await new BrowserBackend().load();
    expect(loaded.fieldVisibility).toBeUndefined();
    expect(loaded.features).toBeUndefined();
  });

  it("clears a previously-saved fieldVisibility when re-saved empty", async () => {
    const backend = new BrowserBackend();
    await backend.save({
      ...emptyWorkspace(),
      fieldVisibility: { task: { fields: ["taskName"] } },
    });
    await backend.save({ ...emptyWorkspace(), fieldVisibility: {} });

    const loaded = await new BrowserBackend().load();
    expect(loaded.fieldVisibility).toBeUndefined();
  });

  it("second save of an unchanged workspace emits empty deltas (baselines advanced)", async () => {
    const backend = new BrowserBackend();
    const ws = { ...emptyWorkspace(), tasks: [task], raid: [raidItem] };
    await backend.save(ws);

    ctl.calls = [];
    await backend.save(ws);
    for (const call of ctl.calls) {
      expect(call.putIds).toEqual([]);
      expect(call.deleteIds).toEqual([]);
    }
  });
});
