import { describe, expect, it } from "vitest";
import {
  ACTIVITY_AUDIT_CLASSIFICATION,
  activityAuditFileName,
  buildActivityAudit,
  type ActivityAuditSource,
} from "./activity-audit";
import type { ActivityEntry } from "./activity-log";
import { activityMessage } from "./activity-message";

// open-followups §510 — the internal activity-log download. Owner ruling 2026-10-04: include the
// field changes, mark the file internal, cover the whole Turso portfolio when there is one.

const NOW = new Date("2026-10-04T09:30:00.000Z");

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: "dev-1-1",
  timestamp: "2026-10-03T08:00:00.000Z",
  kind: "task.updated",
  args: [7, "Kickoff"],
  actor: "user",
  changes: [{ field: "status", from: "To Do", to: "Done" }],
  ...over,
});

const source = (over: Partial<ActivityAuditSource> = {}): ActivityAuditSource => ({
  id: "p1", name: "Apollo", archived: false, log: [entry()], ...over,
});

describe("buildActivityAudit", () => {
  it("marks the whole file internal, with when, what build and which scope", () => {
    const audit = buildActivityAudit("portfolio", [source()], NOW, "1.15.0");
    expect(audit.classification).toBe(ACTIVITY_AUDIT_CLASSIFICATION);
    expect(audit.classification).toMatch(/^internal/);
    expect(audit.exportedAt).toBe("2026-10-04T09:30:00.000Z");
    expect(audit.appVersion).toBe("1.15.0");
    expect(audit.scope).toBe("portfolio");
  });

  it("carries every entry field, the old and new values included, plus a readable message", () => {
    const [project] = buildActivityAudit("current", [source()], NOW, "1.15.0").projects;
    expect(project).toMatchObject({ id: "p1", name: "Apollo", archived: false });
    expect(project.entries).toEqual([{
      id: "dev-1-1",
      timestamp: "2026-10-03T08:00:00.000Z",
      kind: "task.updated",
      args: [7, "Kickoff"],
      actor: "user",
      message: activityMessage("en-US", "task.updated", [7, "Kickoff"]),
      changes: [{ field: "status", from: "To Do", to: "Done" }],
    }]);
  });

  it("keeps an absent actor absent — an entry from before actors were recorded has an unknown one", () => {
    const [project] = buildActivityAudit("current", [source({ log: [entry({ actor: undefined, changes: undefined })] })], NOW, "1.15.0").projects;
    expect(project.entries[0]).not.toHaveProperty("actor");
    expect(project.entries[0]).not.toHaveProperty("changes");
  });

  it("flags an archived project and lists a project with no entries, so the file says what it covered", () => {
    const audit = buildActivityAudit("portfolio", [source({ id: "p2", name: "Zeus", archived: true, log: [] }), source()], NOW, "1.15.0");
    expect(audit.projects.map((p) => [p.id, p.archived, p.entries.length])).toEqual([["p1", false, 1], ["p2", true, 0]]);
  });

  it("orders projects by name, and each project's entries oldest first", () => {
    const log = [entry({ id: "b", timestamp: "2026-10-03T10:00:00.000Z" }), entry({ id: "a", timestamp: "2026-10-02T10:00:00.000Z" })];
    const audit = buildActivityAudit("portfolio", [source({ id: "z", name: "Zeus", log }), source({ id: "a", name: "Apollo", log: [] })], NOW, "1.15.0");
    expect(audit.projects.map((p) => p.name)).toEqual(["Apollo", "Zeus"]);
    expect(audit.projects[1].entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("does not modify the logs it was given", () => {
    const log = [entry({ id: "b", timestamp: "2026-10-03T10:00:00.000Z" }), entry({ id: "a", timestamp: "2026-10-02T10:00:00.000Z" })];
    buildActivityAudit("current", [source({ log })], NOW, "1.15.0");
    expect(log.map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("buildActivityAudit — unreadable and short logs", () => {
  it("carries the stored-log flags, so an empty list can be told from no activity", () => {
    const audit = buildActivityAudit("portfolio", [
      source({ id: "p1", name: "A", log: [], logUnreadable: true }),
      source({ id: "p2", name: "B", entriesDropped: 2 }),
      source({ id: "p3", name: "C" }),
    ], NOW, "1.15.0");
    expect(audit.projects[0]).toMatchObject({ id: "p1", logUnreadable: true, entries: [] });
    expect(audit.projects[1]).toMatchObject({ id: "p2", entriesDropped: 2 });
    expect(audit.projects[2]).not.toHaveProperty("logUnreadable");
    expect(audit.projects[2]).not.toHaveProperty("entriesDropped");
  });
});

describe("activityAuditFileName", () => {
  it("says internal in the name and carries the day", () => {
    expect(activityAuditFileName(NOW)).toBe("aipm-cockpit-INTERNAL-activity-audit-2026-10-04.json");
  });
});
