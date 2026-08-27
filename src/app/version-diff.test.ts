import { describe, it, expect } from "vitest";
import { COLLECTION_SPECS, diffWorkspaces, summarizeDiff } from "./version-diff";
import { ws, arraysFixture, taskRec, resourceRec, roleRec, disciplineRec, gradeRec,
  absenceRec, shiftRec } from "../test/workspace-records";
import type { Workspace } from "./workspace";

const task = (id: number, over: Record<string, unknown> = {}) => ({ id, title: `T${id}`, ...over } as never);

describe("diffWorkspaces", () => {
  it("detects an added record", () => {
    const c = diffWorkspaces(ws({ tasks: [] }), ws({ tasks: [task(1)] }));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ collection: "tasks", recordId: 1, type: "added" });
  });
  it("detects a removed record", () => {
    const c = diffWorkspaces(ws({ tasks: [task(1)] }), ws({ tasks: [] }));
    expect(c[0]).toMatchObject({ collection: "tasks", recordId: 1, type: "removed" });
  });
  it("detects a modified record with field before/after", () => {
    const c = diffWorkspaces(ws({ tasks: [task(1, { title: "Old", pct: 10 })] }), ws({ tasks: [task(1, { title: "New", pct: 10 })] }));
    expect(c).toHaveLength(1);
    expect(c[0].type).toBe("modified");
    expect(c[0].fields.find((x) => x.field === "title")).toMatchObject({ before: "Old", after: "New" });
    expect(c[0].fields.find((x) => x.field === "pct")).toBeUndefined();
  });
  it("ignores localModifiedAt churn", () => {
    const c = diffWorkspaces(ws({ tasks: [task(1, { localModifiedAt: "a" })] }), ws({ tasks: [task(1, { localModifiedAt: "b" })] }));
    expect(c).toHaveLength(0);
  });
  it("diffs a singleton (project meta) as field changes", () => {
    const c = diffWorkspaces(ws({ project: { name: "A" } as never }), ws({ project: { name: "B" } as never }));
    expect(c[0]).toMatchObject({ collection: "project", type: "modified" });
    expect(c[0].fields[0]).toMatchObject({ field: "name", before: "A", after: "B" });
  });
  it("treats undefined collections as empty", () => {
    const c = diffWorkspaces(ws({ milestones: undefined }), ws({ milestones: [{ id: 5, name: "M" } as never] }));
    expect(c[0]).toMatchObject({ collection: "milestones", recordId: 5, type: "added" });
  });
  it("diffs a string-id collection without coercing the id", () => {
    const item = (id: string, name: string) => ({ id, name } as never);
    const c = diffWorkspaces(
      ws({ knowledgeItems: [item("drive!a1", "Old")] }),
      ws({ knowledgeItems: [item("drive!a1", "New")] }),
    );
    expect(c).toHaveLength(1);
    expect(c[0].recordId).toBe("drive!a1");
  });
  it("diffs the remaining captured slices", () => {
    const ins = (id: number, severity: string) => ({ id, key: "milestoneSlip", severity } as never);
    const ev = (id: number, title: string) => ({ id, title } as never);
    const c = diffWorkspaces(
      ws({ insights: [ins(1, "low")], calendarEvents: [ev(1, "Old")] }),
      ws({ insights: [ins(1, "high")], calendarEvents: [ev(1, "New")] }),
    );
    // The label comes from each row nameField: insights key, events title.
    expect(c.map((x) => [x.collection, x.recordLabel]).sort()).toEqual([
      ["calendarEvents", "New"],
      ["insights", "milestoneSlip"],
    ]);
  });
});

// ★★ TWO READINGS OF ONE FACT. `applyRestore` gates on the SPEC's `restorable`;
// `VersionDiffView` and `selectableSelection` gate on the CHANGE's. They agree
// only while every producer copies the flag — `diffList` always did, and
// `diffSingleton` did NOT. A singleton declaring it would then have been skipped
// by the restore while the UI offered a checkbox and a "Restore this" button for
// it: the silent no-op the flag exists to remove.
describe("restorable propagation", () => {
  // ★★ NO SINGLETON DECLARES THE FLAG TODAY, so this is unreachable through the
  // real registry and there is nothing honest to assert against it — which is
  // exactly why the omission shipped unseen. The spec is appended to the live
  // registry and removed in `finally`: vitest runs a file's tests serially, so
  // nothing else can observe it, and the `finally` holds even if an assertion
  // throws. Do NOT convert this to a stub of `diffSingleton` — a stub would
  // stop tracking the registry the day a real singleton takes the flag.
  it("carries restorable: false from a singleton spec onto its change", () => {
    COLLECTION_SPECS.push({
      key: "status", label: "Synthetic non-restorable singleton",
      kind: "singleton", restorable: false,
    });
    try {
      const c = diffWorkspaces(
        ws({ status: { note: "Old" } as never }),
        ws({ status: { note: "New" } as never }),
      );
      const synthetic = c.find((x) => x.collectionLabel === "Synthetic non-restorable singleton");
      expect(synthetic?.restorable).toBe(false);
      // ...and the flag is COPIED, not stamped on every singleton: the real
      // `status` spec declares nothing, so its change must omit it. Without
      // this, `restorable: false as const` unconditional passes above.
      expect(c.find((x) => x.collectionLabel === "Project status")?.restorable).toBeUndefined();
    } finally {
      COLLECTION_SPECS.pop();
    }
  });
});

// ★★★ A ROW THE RESTORE WILL REFUSE TO ACT ON MUST NEVER BE OFFERED, and this
// is where that is enforced. `applyRestore` skipping a slice is INVISIBLE to the
// UI: the row still renders a checkbox and a "Restore this" button,
// `selectableSelection` includes it, the empty-selection toast does not fire,
// and `restore()` returns true and logs "Restored N change(s)" for a restore
// that changed nothing. Suppressing the row is the only version of this that
// cannot lie — a capture that cannot speak about a slice has no opinion to show.
describe("diffWorkspaces and a capture that cannot speak for a slice", () => {
  const withKnowledge = () =>
    ws({ knowledgeItems: [{ id: "k1", name: "Runbook" } as never] });

  it("emits no rows for the six blind slices when the older side is unstamped", () => {
    const c = diffWorkspaces(ws({}), withKnowledge());
    expect(c.filter((x) => x.collection === "knowledgeItems")).toHaveLength(0);
  });

  it("emits them when the older side is stamped — an empty slice is then a real claim", () => {
    const c = diffWorkspaces(ws({}), withKnowledge(), { olderSpeaksForEmptySlices: true });
    expect(c.filter((x) => x.collection === "knowledgeItems")).toHaveLength(1);
    expect(c.find((x) => x.collection === "knowledgeItems")?.type).toBe("added");
  });

  // ★★ THE SUPPRESSION IS SCOPED TO AN ABSENT KEY, NOT TO THE SLICE. A capture
  // that DOES carry the key still diffs fully in blind mode — otherwise the six
  // would be permanently invisible to every restore of an older capture, which
  // is a far bigger loss than the over-promise this guard removes.
  it("still diffs a blind slice whose key the capture DOES carry", () => {
    const c = diffWorkspaces(
      ws({ knowledgeItems: [{ id: "k1", name: "Old" } as never] }),
      ws({ knowledgeItems: [{ id: "k1", name: "New" } as never] }),
    );
    expect(c.filter((x) => x.collection === "knowledgeItems")).toHaveLength(1);
    expect(c.find((x) => x.collection === "knowledgeItems")?.type).toBe("modified");
  });

  // ★★ And never to a slice outside the six: `tasks` is absent from `ws({})`'s
  // overrides only in the sense of being `[]`, but an always-emitted additive
  // key like `project` must keep diffing on an unstamped capture.
  it("does not suppress an always-emitted additive slice", () => {
    const c = diffWorkspaces(ws({}), ws({ project: { name: "Apollo" } as never }));
    expect(c.filter((x) => x.collection === "project")).toHaveLength(1);
  });
});

describe("summarizeDiff", () => {
  it("groups counts by collection label", () => {
    const c = diffWorkspaces(
      ws({ tasks: [task(1, { title: "a" })], raid: [] }),
      ws({ tasks: [task(1, { title: "b" }), task(2)], raid: [{ id: 9 } as never] }),
    );
    expect(summarizeDiff(c)).toMatch(/Tasks \(2\)/);
    expect(summarizeDiff(c)).toMatch(/RAID \(1\)/);
  });
  it("returns empty string for no changes", () => { expect(summarizeDiff([])).toBe(""); });
});

describe("record labels", () => {
  // ★★★ FIVE OF THE SIXTEEN nameFields NAMED A FIELD NO RECORD CARRIES, and
  // `recordLabel` falls back to `#id`, so every task, resource, role, absence
  // and shift change in the version diff was labelled by id. tsc could not see
  // it: `key` is `keyof Workspace` but `nameField` is a bare string. Measured
  // against sample-workspace-small.json — 0/14 tasks carried `title`, 0/5
  // resources and 0/6 roles carried `name`, 0/5 absences carried `reason`,
  // 0/4 shifts carried `label`.
  const labelFor = (older: Partial<Workspace>, newer: Partial<Workspace>, collection: string) =>
    diffWorkspaces(ws(older), ws(newer)).find((c) => c.collection === collection)?.recordLabel;

  it("labels a task by taskName", () => {
    expect(labelFor(
      { tasks: [taskRec(1, "Old")] },
      { tasks: [taskRec(1, "New")] },
      "tasks",
    )).toBe("Task New");
  });

  it("labels a resource by its composed display name", () => {
    expect(labelFor(
      { resources: [resourceRec(1, "Old")] },
      { resources: [resourceRec(1, "New")] },
      "resources",
    )).toBe("ResNew Example");
  });

  it("labels a role from the workspace's disciplines and grades", () => {
    const base = { disciplines: [disciplineRec(1, "Dev")], grades: [gradeRec(1, "Senior")] };
    expect(labelFor(
      { ...base, roles: [roleRec(1, "Old")] },
      { ...base, roles: [roleRec(1, "New")] },
      "roles",
    )).toBe("Discipline Dev Grade Senior");
  });

  it("labels absences and shifts by their note", () => {
    expect(labelFor({ absences: [absenceRec(1, "Old")] }, { absences: [absenceRec(1, "New")] }, "absences"))
      .toBe("Absence New");
    expect(labelFor({ shifts: [shiftRec(1, "Old")] }, { shifts: [shiftRec(1, "New")] }, "shifts"))
      .toBe("Shift New");
  });

  // ★★ A REMOVED record is gone from the NEWER workspace, so its label must be
  // resolved against the OLDER one. Renaming the discipline between the two
  // sides is what separates the branches: read the newer side and this returns
  // the new name for a record that no longer exists there.
  it("labels a removed role from the older workspace", () => {
    const older = { disciplines: [disciplineRec(1, "Dev")], grades: [gradeRec(1, "Senior")], roles: [roleRec(1, "Old")] };
    const newer = { disciplines: [disciplineRec(1, "Renamed")], grades: [gradeRec(1, "Senior")], roles: [] };
    const change = diffWorkspaces(ws(older), ws(newer)).find((c) => c.collection === "roles" && c.type === "removed");
    expect(change?.recordLabel).toBe("Discipline Dev Grade Senior");
  });

  // Pins the BRANCH the `num` sentinel's comment is about — an unresolvable
  // discipline/grade misses both lookups, `roleLabel` returns "n/a n/a", and
  // that is non-blank, so `recordLabel` takes it as a real name and the row does
  // NOT fall back to `#id`. That choice is what a user sees and nothing read it
  // before.
  // ★★ It does NOT pin the `-1` ITSELF, and reading it as though it did is the
  // trap: `disciplines`/`grades` are EMPTY here, so `find` misses whatever `num`
  // returns and the assertion holds for `0` or `NaN` just as well. The property
  // `-1` actually buys — a value no minted id can collide with — needs a fixture
  // carrying a record whose id equals the substitute, which this is not.
  it("labels a role with unresolvable ids as n/a rather than #id", () => {
    const older = { disciplines: [], grades: [], roles: [roleRec(1, "Old")] };
    const newer = { disciplines: [], grades: [], roles: [roleRec(1, "New")] };
    const change = diffWorkspaces(ws(older), ws(newer)).find((c) => c.collection === "roles");
    expect(change?.recordLabel).toBe("n/a n/a");
  });

  // `absences`/`shifts` are the only specs declaring BOTH a `nameOf` and a
  // `nameField`, so they are the only ones that exercise the fall-through — and
  // the reason they declare it is that `note` is optional while `assignee` is
  // required, which is what used to leave a note-less absence reading `#id`.
  it("names a note-less absence and shift by assignee, not #id", () => {
    const older = { absences: [absenceRec(1, "Old")], shifts: [shiftRec(1, "Old")] };
    const newer = {
      absences: [{ ...absenceRec(1, "New"), note: undefined }],
      shifts: [{ ...shiftRec(1, "New"), note: undefined }],
    };
    const labels = diffWorkspaces(ws(older), ws(newer)).map((c) => `${c.collection}:${c.recordLabel}`);
    expect(labels).toEqual(["absences:Ann", "shifts:Ann"]);
  });

  // ★★★ BUG-CLASS GUARD. Any spec declaring a name source that its records do
  // not carry lands here — the fallback to `#id` is the only symptom, and
  // nothing else in the suite reads it.
  it("never falls back to #id for a fully-populated record", () => {
    const named = new Set(COLLECTION_SPECS.filter((s) => s.nameField || s.nameOf).map((s) => s.key));
    const changes = diffWorkspaces(ws(arraysFixture("Old")), ws(arraysFixture("New")));
    const byId = changes.filter((c) => named.has(c.collection as keyof Workspace) && c.recordLabel === `#${c.recordId}`);
    expect(byId.map((c) => c.collection)).toEqual([]);
  });
});
