import { describe, expect, it } from "vitest";
import { groupByStatus, groupByStatusAndPerson, laneResourceIds, UNASSIGNED_LANE } from "./task-kanban";
import { TASK_STATUSES, type Resource, type Task } from "./types";

const t = (id: number, status: Task["status"]): Task =>
  ({ id, taskName: "T" + id, assignee: "", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "Medium", blockers: "", description: "", status }) as Task;

describe("groupByStatus", () => {
  it("returns a bucket for every status, empty ones included", () => {
    const g = groupByStatus([]);
    for (const s of TASK_STATUSES) expect(g[s]).toEqual([]);
  });
  it("partitions tasks into their status bucket, order preserved", () => {
    const g = groupByStatus([t(1, "To Do"), t(2, "Done"), t(3, "To Do")]);
    expect(g["To Do"].map((x) => x.id)).toEqual([1, 3]);
    expect(g["Done"].map((x) => x.id)).toEqual([2]);
    expect(g["In Progress"]).toEqual([]);
  });
});

const task = (over: Partial<Task>): Task => ({
  id: 1, taskName: "T", assignee: "", assigneeEmail: "",
  dueDate: "2026-03-01", lastUpdateDate: "2026-02-01",
  priority: "Medium", status: "To Do", blockers: "", description: "",
  ...over,
});

const resources = new Map<number, Resource>([
  [1, { id: 1, firstName: "Anna", lastName: "Jordan" } as Resource],
  [2, { id: 2, firstName: "Bo", lastName: "Klein" } as Resource],
]);

describe("groupByStatusAndPerson", () => {
  it("lanes sort by display name with Unassigned last", () => {
    const out = groupByStatusAndPerson(
      [task({ id: 1, resourceId: 2 }), task({ id: 2 }), task({ id: 3, resourceId: 1 })],
      resources,
      [],
    );
    expect(out.lanes.map((l) => l.label)).toEqual(["Anna Jordan", "Bo Klein", ""]);
    expect(out.lanes.at(-1)!.key).toBe(UNASSIGNED_LANE);
  });

  it("a linked lane uses the resource's LIVE name, not the cached assignee string", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1, assignee: "Old Name" })], resources, []);
    expect(out.lanes[0].label).toBe("Anna Jordan");
  });

  it("a free-string assignee gets its own lane keyed by the string", () => {
    const out = groupByStatusAndPerson([task({ assignee: "Contractor X" })], resources, []);
    expect(out.lanes[0].key).toBe("name:contractor x");
    expect(out.lanes[0].resourceId).toBeNull();
  });

  it("extra lane ids appear even with no tasks", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1 })], resources, [2]);
    expect(out.lanes.map((l) => l.label)).toEqual(["Anna Jordan", "Bo Klein", ""]);
    expect(out.cells["res:2"]["To Do"]).toEqual([]);
  });

  it("an extra lane id already present is not duplicated", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1 })], resources, [1]);
    expect(out.lanes.filter((l) => l.key === "res:1")).toHaveLength(1);
  });

  it("every lane has a bucket for every status", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1, status: "Done" })], resources, []);
    expect(Object.keys(out.cells["res:1"]).sort()).toEqual([...TASK_STATUSES].sort());
  });

  it("an extra lane id that does not resolve to a live resource is ignored", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1 })], resources, [999]);
    expect(out.lanes.some((l) => l.key === "res:999")).toBe(false);
    expect(out.cells["res:999"]).toBeUndefined();
  });

  it("a task with a dangling resourceId falls back to its assignee string", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 99, assignee: "Ghost" })], resources, []);
    expect(out.lanes[0].key).toBe("name:ghost");
    expect(out.lanes[0].resourceId).toBeNull();
  });

  it("a task with a dangling resourceId and no assignee string lands in Unassigned", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 99 })], resources, []);
    expect(out.cells[UNASSIGNED_LANE]["To Do"].map((x) => x.id)).toEqual([1]);
  });
});

describe("laneResourceIds", () => {
  it("includes a resource that owns a task", () => {
    expect(laneResourceIds([task({ resourceId: 1 })], resources, [])).toEqual([1]);
  });

  it("includes an extra lane id with no owning task", () => {
    expect(laneResourceIds([], resources, [2])).toEqual([2]);
  });

  it("dedupes a resource that is both a task owner and an extra lane id", () => {
    expect(laneResourceIds([task({ resourceId: 1 })], resources, [1])).toEqual([1]);
  });

  it("a task with no resourceId contributes nothing", () => {
    expect(laneResourceIds([task({ resourceId: undefined })], resources, [])).toEqual([]);
  });

  // ★★ THIS IS THE ONLY TEST COVERING THE NAME HALF OF THIS FUNCTION. Every
  // other fixture here leaves `assignee` at its "" default, so the whole
  // name-resolution branch could be reverted to the original FK-only loop with
  // the entire suite still green. Without it, a person who owns a lane only via
  // a free-string assignee is still offered by the add-lane picker
  // (`tasks-section.tsx` -> `task-swimlane-toolbar`), promising a second lane
  // for someone who already has one — the exact duplication the caller relies
  // on this function to prevent.
  it("includes a resource named only by a task's free-string assignee", () => {
    expect(laneResourceIds([task({ assignee: "Anna Jordan" })], resources, [])).toEqual([1]);
  });

  it("still contributes nothing for a name no resource answers to", () => {
    expect(laneResourceIds([task({ assignee: "Ext Contractor" })], resources, [])).toEqual([]);
  });

  // Mirrors groupByStatusAndPerson's own dangling-FK handling: an id that does
  // not resolve in the directory must not surface as a lane, whether it comes
  // from a task's stale resourceId or a stale extra lane id.
  it("drops a task-owned id and an extra lane id that do not resolve in the directory", () => {
    expect(laneResourceIds([task({ resourceId: 999 })], resources, [998])).toEqual([]);
  });
});

// ★★★ REGRESSION (duplicate person lanes): a project whose tasks carry the
// assignee STRING for some rows and the resource FK for others rendered the
// SAME human as two lanes side by side — `res:<id>` and `name:<string>` — with
// identical labels, so the board read as if one person existed twice. Only the
// FK lane's cards showed a populated assignee select; the string lane's showed
// "Unassigned" while the card text still printed the name.
describe("groupByStatusAndPerson — name/FK lane unification", () => {
  it("attributes a free-string assignee to the lane of the resource it names", () => {
    const out = groupByStatusAndPerson(
      [task({ id: 1, resourceId: 1 }), task({ id: 2, assignee: "Anna Jordan" })],
      resources,
      [],
    );
    const named = out.lanes.filter((l) => l.label === "Anna Jordan");
    expect(named).toHaveLength(1);
    expect(named[0].key).toBe("res:1");
    expect(out.cells["res:1"]["To Do"].map((x) => x.id)).toEqual([1, 2]);
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    const out = groupByStatusAndPerson([task({ id: 1, assignee: "  anna   Jordan " })], resources, []);
    expect(out.lanes.filter((l) => l.label === "Anna Jordan")).toHaveLength(1);
    expect(out.cells["res:1"]["To Do"].map((x) => x.id)).toEqual([1]);
  });

  it("keeps a name lane when the string matches no directory resource", () => {
    const out = groupByStatusAndPerson([task({ id: 1, assignee: "Ext Contractor" })], resources, []);
    expect(out.lanes.map((l) => l.key)).toContain("name:ext contractor");
  });

  it("keeps a name lane when the string is ambiguous across two resources", () => {
    // Two people share a display name: picking either one would silently
    // attribute work to the wrong person, so the string keeps its own lane.
    const twins = new Map<number, Resource>([
      [1, { id: 1, firstName: "Anna", lastName: "Jordan" } as Resource],
      [2, { id: 2, firstName: "Anna", lastName: "Jordan" } as Resource],
    ]);
    const out = groupByStatusAndPerson([task({ id: 1, assignee: "Anna Jordan" })], twins, []);
    expect(out.lanes.map((l) => l.key)).toContain("name:anna Jordan");
  });

  it("a dangling FK falls back to its assignee string and still unifies", () => {
    // resourceId 99 does not resolve; the cached name does. The task belongs
    // with the person it names, not in a lane of its own.
    const out = groupByStatusAndPerson(
      [task({ id: 1, resourceId: 99, assignee: "Bo Klein" }), task({ id: 2, resourceId: 2 })],
      resources,
      [],
    );
    expect(out.lanes.filter((l) => l.label === "Bo Klein")).toHaveLength(1);
    expect(out.cells["res:2"]["To Do"].map((x) => x.id)).toEqual([1, 2]);
  });
});

// A partial/legacy row with NO `assignee` field at all. Typed `string`, absent
// in practice — and once `laneResourceIds` started resolving names it ran over
// every task, so an unguarded `.trim()` here crashed the entire Open Points
// view on mount rather than mislaying one card.
describe("tasks with no assignee field", () => {
  const partial = { id: 7, status: "To Do" } as unknown as Task;

  it("groups without throwing and lands in the Unassigned lane", () => {
    const out = groupByStatusAndPerson([partial], resources, []);
    expect(out.cells[UNASSIGNED_LANE]["To Do"].map((x) => x.id)).toEqual([7]);
  });

  it("laneResourceIds tolerates it", () => {
    expect(laneResourceIds([partial], resources, [])).toEqual([]);
  });
});

// ★★★ A name-matched EXTERNAL lane is a live drop target, and a task dropped
// into it gets an FK that `isExternalTask` classifies as external — so with
// "Hide externals" on the card silently vanishes. `task-external.ts` states the
// invariant this protects: classification is link-only because "a name
// collision would HIDE REAL WORK". `tasks-section.tsx` already filters
// extraLaneIds for this; task-derived lanes are only guarded here.
describe("externals are never name-matched into a linked lane", () => {
  const withExternal = new Map<number, Resource>([
    [1, { id: 1, firstName: "Anna", lastName: "Jordan" } as Resource],
    [5, { id: 5, firstName: "Ext", lastName: "Contractor", isExternal: true } as Resource],
  ]);

  it("keeps a string-only task naming an external in an UNLINKED name lane", () => {
    const out = groupByStatusAndPerson([task({ id: 1, assignee: "Ext Contractor" })], withExternal, []);
    const lane = out.lanes.find((l) => l.label === "Ext Contractor");
    expect(lane?.key).toBe("name:ext contractor");
    // resourceId null is the load-bearing half: it is what stops the drop
    // handler writing an external FK onto whatever is dragged here.
    expect(lane?.resourceId).toBeNull();
  });

  it("still name-matches a non-external with the same shape of data", () => {
    // Control: proves the test above fails because of isExternal, not because
    // name matching stopped working altogether.
    const out = groupByStatusAndPerson([task({ id: 1, assignee: "Anna Jordan" })], withExternal, []);
    expect(out.lanes.find((l) => l.label === "Anna Jordan")?.key).toBe("res:1");
  });

  it("does not offer a name-matched external to the add-lane picker", () => {
    expect(laneResourceIds([task({ assignee: "Ext Contractor" })], withExternal, [])).toEqual([]);
  });
});

// Same duplicate-lane symptom as the FK/name split, for a person the directory
// does NOT know: two spellings of one free-text name forked two lanes whose
// headers looked identical.
describe("unknown-person lanes are keyed on the normalised name", () => {
  it("merges whitespace/case variants of the same free-text assignee", () => {
    const out = groupByStatusAndPerson(
      [task({ id: 1, assignee: "Ext  Contractor" }), task({ id: 2, assignee: "ext contractor" })],
      resources,
      [],
    );
    const lanes = out.lanes.filter((l) => l.key.startsWith("name:"));
    expect(lanes).toHaveLength(1);
    // The label keeps the FIRST spelling seen — the drop handler writes it back
    // as the task's assignee, so it must stay human-readable.
    expect(lanes[0].label).toBe("Ext  Contractor");
    expect(out.cells[lanes[0].key]["To Do"].map((x) => x.id)).toEqual([1, 2]);
  });
});
