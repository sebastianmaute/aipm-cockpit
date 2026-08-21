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
import type { ActivityEntry } from "./activity-log";
import type { DocumentAsset } from "./document-asset";

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
import { IDB_RAID_STORE, IDB_TASKS_STORE, idbGet, idbSet } from "./idb";
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

  it("round-trips activityLog through IndexedDB", async () => {
    const log: ActivityEntry[] = [
      { id: "dev1-s1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created", args: ["T-1"] },
    ];
    const backend = new BrowserBackend();
    await backend.save({ ...emptyWorkspace(), activityLog: log });

    const loaded = await new BrowserBackend().load();
    expect(loaded.activityLog).toEqual(log);
  });

  it("deletes the stored activityLog when it is cleared, so it cannot reload stale", async () => {
    const log: ActivityEntry[] = [
      { id: "dev1-s1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created", args: ["T-1"] },
    ];
    const backend = new BrowserBackend();
    await backend.save({ ...emptyWorkspace(), activityLog: log });
    await backend.save({ ...emptyWorkspace(), activityLog: [] });

    const loaded = await new BrowserBackend().load();
    expect(loaded.activityLog).toBeUndefined();
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

  // Nested so it inherits the outer beforeEach's fresh-IDB-per-test reset.
  describe("documentAssets over IndexedDB", () => {
    const asset: DocumentAsset = {
      id: "a1", name: "chart.png", mime: "image/png", size: 1024,
      width: 800, height: 600, hash: "abc123", createdAt: "2026-08-21T10:00:00.000Z",
    };

    it("round-trips documentAssets through save and load", async () => {
      const backend = new BrowserBackend();
      await backend.save({ ...emptyWorkspace(), documentAssets: [asset] });
      const back = await backend.load();
      expect(back.documentAssets?.[0]).toEqual(asset);
    });

    it("leaves the key undefined when there are no assets", async () => {
      const backend = new BrowserBackend();
      await backend.save(emptyWorkspace());
      expect((await backend.load()).documentAssets).toBeUndefined();
    });

    it("drops garbage rows on load rather than failing", async () => {
      await idbSet("documentAssets", [asset, { name: "no id" }]);
      expect((await new BrowserBackend().load()).documentAssets).toHaveLength(1);
    });

    // Proven gap in this slice: every emit/assign guard in the six write
    // paths is `x && x.length`, and no prior test passed an EXPLICIT empty
    // array — only undefined (emptyWorkspace() never sets documentAssets)
    // or a non-empty list. A mutant dropping `.length` (bare truthiness of
    // the array — `[]` is truthy in JS) passed every test on the other
    // five paths until this shape was added there too. Seed a NON-empty
    // save first so the test is meaningful: it fails against a backend
    // that simply never writes the key, or against one that leaves a
    // stale value in place.
    //
    // ★ Assert the RAW kv value via idbGet, NOT backend.load(): the load
    // path's own "assets.length ? assets : undefined" collapse (a few
    // lines up in browser-backend.ts) normalizes an empty array IN
    // STORAGE back to `undefined` on every read regardless of whether the
    // key was actually deleted or merely re-saved as `[]` — so a
    // load()-only assertion here is structurally unable to distinguish
    // the mutant from correct code (verified: it still passed with
    // `.length` dropped from the save guard). Reading the stored value
    // directly is the only observable that catches the stale-key bug.
    it("deletes the stored key (not merely re-saves []) so raw storage cannot hold stale data", async () => {
      const backend = new BrowserBackend();
      await backend.save({ ...emptyWorkspace(), documentAssets: [asset] });
      await backend.save({ ...emptyWorkspace(), documentAssets: [] });

      expect(await idbGet("documentAssets")).toBeUndefined();
    });
  });
});
