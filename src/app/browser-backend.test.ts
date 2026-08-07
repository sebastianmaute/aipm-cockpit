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
import type { ChangeItem, Milestone, RaidItem, Task } from "./types";

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

  // The IDB read casts changes and milestones VERBATIM (unlike jsonToWorkspace,
  // which runs their entity sanitizers first), so this backend's load boundary is
  // the ONLY normalisation those two ever get — and RAID `mitigation` was
  // normalised on neither path before this.
  it("upgrades legacy plain rich fields on load (raid mitigation, change + milestone text)", async () => {
    const ws = {
      ...emptyWorkspace(),
      raid: [{ ...raidItem, mitigation: "escalate <b>now</b>" } as unknown as RaidItem],
      changes: [{
        id: 4,
        title: "C",
        status: "Proposed",
        raisedDate: "2026-01-01",
        impactDescription: "cost <b>up</b>",
        resolutionNotes: "approved <b>fully</b>",
      } as unknown as ChangeItem],
      milestones: [{ ...milestone, description: "gate <b>2</b>" }],
    };
    await new BrowserBackend().save(ws);

    const loaded = await new BrowserBackend().load();
    expect(loaded.raid[0].mitigation).toBe("<p>escalate &lt;b&gt;now&lt;/b&gt;</p>");
    expect(loaded.changes?.[0].impactDescription).toBe("<p>cost &lt;b&gt;up&lt;/b&gt;</p>");
    expect(loaded.changes?.[0].resolutionNotes).toBe("<p>approved &lt;b&gt;fully&lt;/b&gt;</p>");
    expect(loaded.milestones?.[0].description).toBe("<p>gate &lt;b&gt;2&lt;/b&gt;</p>");
  });

  it("strips live markup from already-rich stored rich fields on load", async () => {
    const ws = {
      ...emptyWorkspace(),
      raid: [{ ...raidItem, mitigation: "<p>ok</p><script>alert(1)</script>" } as unknown as RaidItem],
      milestones: [{ ...milestone, description: "<p>gate</p><img src=x onerror=alert(1)>" }],
    };
    await new BrowserBackend().save(ws);

    const loaded = await new BrowserBackend().load();
    expect(loaded.raid[0].mitigation).toContain("ok");
    expect(loaded.raid[0].mitigation).not.toContain("<script");
    expect(loaded.milestones?.[0].description).toContain("gate");
    expect(loaded.milestones?.[0].description).not.toContain("onerror");
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

  it("save → fresh load round-trips documentVersions", async () => {
    const version = {
      id: 1,
      documentId: 4,
      title: "Prior",
      blocks: [{ type: "heading" as const, level: 2 as const, text: "Old" }],
      savedAt: "2026-08-02T08:00:00.000Z",
      source: "user" as const,
      // ★ "restored" is the op worth pinning here: it is the marker
      // `deletedDocumentVersions` reads to tell "still deleted" from "already
      // restored", so an IDB round-trip that lost it would resurrect a phantom
      // deleted document on this backend alone. ("rename" would also survive
      // `sanitizeDocumentVersions`' normalise-to-"update" fallback, so this is
      // a change of WHICH op is pinned, not a fix — the sibling delete-on-absent
      // test below keeps "rename" because it never asserts the op at all.)
      op: "restored" as const,
    };
    await new BrowserBackend().save({ ...emptyWorkspace(), documentVersions: [version] });

    const loaded = await new BrowserBackend().load();
    expect(loaded.documentVersions).toEqual([version]);
  });

  it("clears stored documentVersions when re-saved with none", async () => {
    const backend = new BrowserBackend();
    await backend.save({
      ...emptyWorkspace(),
      documentVersions: [{
        id: 1,
        documentId: 4,
        title: "x",
        blocks: [],
        savedAt: "2026-08-02T08:00:00.000Z",
        source: "user",
        op: "rename",
      }],
    });
    await backend.save({ ...emptyWorkspace(), documentVersions: [] });

    const loaded = await new BrowserBackend().load();
    expect(loaded.documentVersions).toBeUndefined();
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
