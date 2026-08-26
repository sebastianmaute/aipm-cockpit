import { describe, it, expect } from "vitest";
import { applyRestore, changeKey, type RestoreSelection } from "./version-restore";
import { diffWorkspaces } from "./version-diff";
import { workspaceToJson, type Workspace } from "./workspace";
import type { KnowledgeItem } from "./document-link";
import type { Insight, InsightSeverity } from "./insights/insight";
import type { ProjectDocument } from "./document-model";
import type { DocVersion } from "./document-versions";
import type { CalendarEvent } from "./calendar-event";

function ws(over: Partial<Workspace>): Workspace {
  return { tasks: [], raid: [], absences: [], shifts: [], resources: [], roles: [],
    disciplines: [], grades: [], plan: {} as never, budgets: [], milestones: [],
    changes: [], stakeholders: [], status: {} as never, ...over } as Workspace;
}
const task = (id: number, over: Record<string, unknown> = {}) => ({ id, title: `T${id}`, ...over } as never);

describe("applyRestore", () => {
  it("reverts a selected modified field, leaving unselected fields as-is", () => {
    const version = ws({ tasks: [task(1, { title: "Old", owner: "Ann" })] });
    const now = ws({ tasks: [task(1, { title: "New", owner: "Bob" })] });
    const changes = diffWorkspaces(version, now);
    const sel: RestoreSelection = { [changeKey("tasks", 1)]: ["title"] };
    const out = applyRestore(now, version, changes, sel);
    const t1 = out.tasks.find((t) => (t as { id: number }).id === 1) as Record<string, unknown>;
    expect(t1.title).toBe("Old");
    expect(t1.owner).toBe("Bob");
  });
  it("re-adds a record that was removed since the version", () => {
    const version = ws({ tasks: [task(1), task(2)] });
    const now = ws({ tasks: [task(1)] });
    const changes = diffWorkspaces(version, now);
    const sel: RestoreSelection = { [changeKey("tasks", 2)]: "all" };
    const out = applyRestore(now, version, changes, sel);
    expect(out.tasks.map((t) => (t as { id: number }).id).sort()).toEqual([1, 2]);
  });
  it("removes a record that was added since the version (opt-in)", () => {
    const version = ws({ tasks: [task(1)] });
    const now = ws({ tasks: [task(1), task(2)] });
    const changes = diffWorkspaces(version, now);
    const sel: RestoreSelection = { [changeKey("tasks", 2)]: "all" };
    const out = applyRestore(now, version, changes, sel);
    expect(out.tasks.map((t) => (t as { id: number }).id)).toEqual([1]);
  });
  it("leaves everything unchanged when nothing is selected", () => {
    const version = ws({ tasks: [task(1, { title: "Old" })] });
    const now = ws({ tasks: [task(1, { title: "New" })] });
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, {});
    expect((out.tasks[0] as unknown as { title: string }).title).toBe("New");
  });
  it("restores selected fields of a singleton (project)", () => {
    const version = ws({ project: { name: "A", code: "X" } as never });
    const now = ws({ project: { name: "B", code: "Y" } as never });
    const changes = diffWorkspaces(version, now);
    const sel: RestoreSelection = { [changeKey("project", null)]: ["name"] };
    const out = applyRestore(now, version, changes, sel);
    expect((out.project as { name: string; code: string }).name).toBe("A");
    expect((out.project as { name: string; code: string }).code).toBe("Y");
  });
  it("does not mutate the input workspaces", () => {
    const version = ws({ tasks: [task(1, { title: "Old" })] });
    const now = ws({ tasks: [task(1, { title: "New" })] });
    const changes = diffWorkspaces(version, now);
    applyRestore(now, version, changes, { [changeKey("tasks", 1)]: "all" });
    expect((now.tasks[0] as unknown as { title: string }).title).toBe("New");
  });
});

// ★★★ ARRAY-TYPED SLICES. `COLLECTION_SPECS` pairs a workspace key with a
// `kind`, and a "singleton" spec sends the key through `mergeFields`, whose
// `{ ...target }` turns an ARRAY into an object with numeric keys. Nothing in
// the type system pairs the two, so the mismatch is invisible until a restore
// runs. These pin the RESULT SHAPE, which is the only place it shows.
describe("applyRestore over array-typed slices", () => {
  // ★★★ The first cut of this file used `as never` on all five fixtures and
  //   thereby encoded FIVE wrong facts that tsc could not see: string ids for
  //   `ProjectDocument`/`DocVersion` (both are `number`), `capturedAt` for
  //   `savedAt`, a missing `title`/`source`/`op`, a `date` field `CalendarEvent`
  //   does not have, and an `InsightType`/`InsightStatus` pair ("overdueTask" /
  //   "open") that are not members of either union. Nothing failed, because
  //   neither slice is in `COLLECTION_SPECS` and only `Array.isArray` and
  //   `.length` are ever read — which is exactly the danger: `docs/open-followups.md`
  //   §241 proposes giving these slices `kind: "list"` rows, and on that day
  //   `diffList` would key on ids the app can never mint, against a fixture no
  //   code path can produce. A test that passes against an impossible shape makes
  //   a follow-up look already-covered. Keep the annotations; never re-add a cast.
  const kItem = (id: string, name: string): KnowledgeItem =>
    ({ id, name, url: `https://example.com/${id}`, kind: "file" });
  const insight = (id: number, severity: InsightSeverity): Insight =>
    ({
      id, key: `k${id}`, type: "overdueTrend", severity, data: {}, status: "active",
      firstSeenAt: "2026-01-01", lastSeenAt: "2026-01-02", occurrences: 1,
    });
  const doc = (id: number, title: string): ProjectDocument =>
    ({ id, title, blocks: [], createdAt: "2026-01-01", updatedAt: "2026-01-02" });
  const docVersion = (id: number, title: string): DocVersion =>
    ({ id, documentId: 1, title, blocks: [], savedAt: "2026-01-01", source: "user", op: "update" });
  const calEvent = (id: number, title: string): CalendarEvent =>
    ({ id, title, startDate: "2026-01-01", startTime: "09:00", durationMinutes: 60 });
  // The plain per-row "Restore" button in `history-panel` builds exactly this:
  // every change, no user input. So this is the real path, not a contrived pick.
  const selectAll = (changes: ReturnType<typeof diffWorkspaces>): RestoreSelection =>
    Object.fromEntries(changes.map((c) => [changeKey(c.collection, c.recordId), "all" as const]));

  it("keeps knowledgeItems and insights as ARRAYS through a full restore", () => {
    const version = ws({ knowledgeItems: [kItem("a", "Old")], insights: [insight(1, "low")] });
    const now = ws({ knowledgeItems: [kItem("a", "New")], insights: [insight(1, "high")] });
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, selectAll(changes));
    expect({
      knowledgeItems: Array.isArray(out.knowledgeItems),
      insights: Array.isArray(out.insights),
    }).toEqual({ knowledgeItems: true, insights: true });
  });

  // The step that turns corruption into DELETION: `workspaceToJson` gates each
  // additive slice on `.length`, which is `undefined` on an object — so the key
  // is omitted and every one of the six write paths drops the slice on the next
  // save, silently and permanently.
  it("still emits both slices when the restored workspace is re-serialized", () => {
    const version = ws({ knowledgeItems: [kItem("a", "Old")], insights: [insight(1, "low")] });
    const now = ws({ knowledgeItems: [kItem("a", "New")], insights: [insight(1, "high")] });
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, selectAll(changes));
    const keys = Object.keys(JSON.parse(workspaceToJson(out)) as Record<string, unknown>);
    expect({
      knowledgeItems: keys.includes("knowledgeItems"),
      insights: keys.includes("insights"),
    }).toEqual({ knowledgeItems: true, insights: true });
  });

  // The SIX slices `getVersionPayload` captures now split 4/2 at the restore
  // layer: `settingsOverrides` (an object singleton) plus the three
  // user-authored arrays revert, while `documents`/`documentVersions` are
  // diff-visible but carried from live — they own their own history.
  it("reverts settingsOverrides and the user-authored arrays", () => {
    const version = ws({
      settingsOverrides: { timezone: { timezone: "Europe/Berlin" } },
      knowledgeItems: [kItem("a", "Old")],
      insights: [insight(1, "low")],
    });
    const now = ws({
      settingsOverrides: { timezone: { timezone: "UTC" } },
      knowledgeItems: [kItem("a", "New")],
      insights: [insight(1, "high")],
    });
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, selectAll(changes));
    expect((out.settingsOverrides as { timezone: { timezone: string } }).timezone.timezone)
      .toBe("Europe/Berlin");
    expect((out.knowledgeItems as readonly { name: string }[])[0].name).toBe("Old");
    expect((out.insights as unknown as readonly { severity: string }[])[0].severity).toBe("low");
  });

  // A capture taken before `getVersionPayload` emitted all 24 slices carries
  // NONE of the six, so every live record reads as "added" against it.
  // Restoring it therefore REMOVES the three restorable arrays and leaves the
  // two document slices alone.
  it("removes the restorable arrays on a restore to a short pre-0.259.0 capture", () => {
    const version = ws({});
    const now = ws({
      knowledgeItems: [kItem("a", "Live")],
      insights: [insight(1, "high")],
      documents: [doc(1, "Live")],
      documentVersions: [docVersion(1, "Live")],
      calendarEvents: [calEvent(1, "Live")],
      settingsOverrides: { timezone: { timezone: "Europe/Berlin" } },
    });
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, selectAll(changes));
    expect({
      knowledgeItems: out.knowledgeItems?.length,
      insights: out.insights?.length,
      calendarEvents: out.calendarEvents?.length,
      documents: out.documents?.length,
      documentVersions: out.documentVersions?.length,
    }).toEqual({
      knowledgeItems: 0, insights: 0, calendarEvents: 0,
      documents: 1, documentVersions: 1,
    });
    expect(out.settingsOverrides).toEqual({});
  });

  // BUG-CLASS guard — not about these two names. Any `COLLECTION_SPECS` entry
  // whose declared `kind` disagrees with the slice's real type lands here, and
  // the failure diagnostic NAMES the slice.
  it("turns no array-typed slice of the workspace into an object", () => {
    const arrays = (n: string): Partial<Workspace> => ({
      knowledgeItems: [kItem("a", n)],
      insights: [insight(1, n === "Old" ? "low" : "high")],
      documents: [doc(1, n)],
      documentVersions: [docVersion(1, n)],
      calendarEvents: [calEvent(1, n)],
    });
    const version = ws(arrays("Old"));
    const now = ws(arrays("New"));
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, selectAll(changes)) as unknown as Record<string, unknown>;
    const before = now as unknown as Record<string, unknown>;
    const broken = Object.keys(before).filter((k) => Array.isArray(before[k]) && !Array.isArray(out[k]));
    expect(broken).toEqual([]);
  });

  it("skips a collection marked restorable: false, carrying it from live state", () => {
    // Proven against the REGISTRY, not a stub: `documents` carries
    // `restorable: false` because applyDocMutation owns document history.
    const version = ws({ documents: [doc(1, "Old")] });
    const now = ws({ documents: [doc(1, "New")] });
    const changes = diffWorkspaces(version, now);
    // It IS in the diff — that is what arms a capture for a documents-only session.
    expect(changes.map((c) => c.collection)).toContain("documents");
    expect(changes.find((c) => c.collection === "documents")?.restorable).toBe(false);
    // ...and selecting it anyway is a no-op, not a partial write.
    const out = applyRestore(now, version, changes, selectAll(changes));
    expect((out.documents as readonly { title: string }[])[0].title).toBe("New");
  });
});

describe("changeKey", () => {
  // Both cases below are silent WRONG-RECORD restores, not crashes: the key is
  // how a selection finds its change, so two records sharing a key means the
  // user reverts one and the other one moves.
  it("keeps two records distinct when a string id contains the separator", () => {
    // `${collection}:${id}` cannot tell these apart: "a:b" in collection "x"
    // and "b" in collection "x:a" both render "x:a:b".
    expect(changeKey("x", "a:b")).not.toBe(changeKey("x:a", "b"));
  });
  it("keeps a string id of \"_\" distinct from the singleton sentinel", () => {
    // `recordId ?? "_"` renders null as "_", so a record literally named "_"
    // collides with its own collection's singleton row.
    expect(changeKey("x", "_")).not.toBe(changeKey("x", null));
  });
  it("still round-trips a plain numeric id and a null", () => {
    expect(changeKey("tasks", 1)).toBe(changeKey("tasks", 1));
    expect(changeKey("tasks", 1)).not.toBe(changeKey("tasks", 2));
    expect(changeKey("project", null)).toBe(changeKey("project", null));
    // ★★ These two kill a `String(recordId ?? null)` mutant, which passes every
    // assertion above while restoring the very collision class this function
    // exists to remove: it collapses 1 with "1", and an id spelled "null" with
    // the singleton sentinel — the `"_"` bug, relocated.
    expect(changeKey("tasks", 1)).not.toBe(changeKey("tasks", "1"));
    expect(changeKey("x", "null")).not.toBe(changeKey("x", null));
  });
});
