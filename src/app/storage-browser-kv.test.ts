// BrowserBackend (IndexedDB) round-trip for the KV-blob entities that the
// record-diff stores don't cover: project status, milestones, and changes.
// Uses fake-indexeddb to provide a real IDB implementation under jsdom.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createBackend, emptyWorkspace } from "./storage";
import type { ChangeItem, Milestone, ProjectStatus } from "./types";

const change: ChangeItem = {
  id: 1, title: "Widen scope", description: "add module", type: "Scope", status: "Approved",
  impact: "High", impactDescription: "2 sprints", scheduleImpactDays: 10, costImpact: 5000,
  requestedBy: "Ann", raisedDate: "2026-06-01", decisionBy: "Bob", decisionDate: "2026-06-09",
  resolutionNotes: "ok", linkedTaskIds: [3, 4], linkedRaidIds: [7], localModifiedAt: "2026-06-09T10:00:00.000Z",
};
const milestone: Milestone = {
  id: 2, name: "Go live", date: "2026-12-01", linkedTaskIds: [5],
};
const status: ProjectStatus = { ragOverride: "R", narrative: "x" };

describe("BrowserBackend KV persistence", () => {
  beforeEach(() => {
    // Fresh in-memory IDB per test so saves don't leak across cases.
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("round-trips changes, milestones, and status across a fresh load", async () => {
    const ws = { ...emptyWorkspace(), changes: [change], milestones: [milestone], status };

    await createBackend({ kind: "browser" }).save(ws);

    const loaded = await createBackend({ kind: "browser" }).load();
    expect(loaded.changes).toHaveLength(1);
    expect(loaded.changes?.[0]).toMatchObject({ id: 1, title: "Widen scope", linkedRaidIds: [7] });
    expect(loaded.milestones).toHaveLength(1);
    expect(loaded.milestones?.[0]).toMatchObject({ id: 2, name: "Go live" });
    expect(loaded.status).toMatchObject({ ragOverride: "R", narrative: "x" });
  });
});
