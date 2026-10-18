import { describe, it, expect } from "vitest";
import { emptyWorkspace, isWorkspaceEmpty, nonEmptyCollectionCount, workspaceRecordCount, isMassDeletion, type Workspace } from "./workspace";

describe("isWorkspaceEmpty", () => {
  it("is true for a blank workspace (default plan doesn't count)", () => {
    expect(isWorkspaceEmpty(emptyWorkspace())).toBe(true);
  });

  it("is false when ANY user collection has a record", () => {
    const ws = emptyWorkspace();
    expect(isWorkspaceEmpty({ ...ws, tasks: [{ id: 1 } as never] })).toBe(false);
    expect(isWorkspaceEmpty({ ...ws, resources: [{ id: 1 } as never] })).toBe(false);
    expect(isWorkspaceEmpty({ ...ws, milestones: [{ id: 1 } as never] })).toBe(false);
    expect(isWorkspaceEmpty({ ...ws, stakeholders: [{ id: 1 } as never] })).toBe(false);
  });

  it("tolerates missing arrays (partial object)", () => {
    expect(isWorkspaceEmpty({} as unknown as Workspace)).toBe(true);
  });
});

describe("nonEmptyCollectionCount", () => {
  it("counts collections that hold records", () => {
    expect(nonEmptyCollectionCount(emptyWorkspace())).toBe(0);
    const ws = emptyWorkspace();
    expect(nonEmptyCollectionCount({ ...ws, tasks: [{ id: 1 } as never] })).toBe(1);
    expect(nonEmptyCollectionCount({ ...ws, tasks: [{ id: 1 } as never], resources: [{ id: 2 } as never] })).toBe(2);
  });
});

describe("workspaceRecordCount", () => {
  it("sums records across collections", () => {
    expect(workspaceRecordCount(emptyWorkspace())).toBe(0);
    const ws = emptyWorkspace();
    expect(workspaceRecordCount({ ...ws, tasks: [{ id: 1 }, { id: 2 }] as never, milestones: [{ id: 3 }] as never })).toBe(3);
  });
});

describe("isMassDeletion", () => {
  it("flags losing almost everything in one step (full or near-total)", () => {
    expect(isMassDeletion(100, 0)).toBe(true);   // lost all
    expect(isMassDeletion(50, 2)).toBe(true);    // removed 48, 2 <= 5
  });
  it("does NOT flag normal edits or moderate deletes", () => {
    expect(isMassDeletion(50, 49)).toBe(false);  // removed 1
    expect(isMassDeletion(50, 40)).toBe(false);  // lost 20%
    expect(isMassDeletion(3, 0)).toBe(false);    // removed 3 < floor 5 (small project)
    expect(isMassDeletion(10, 20)).toBe(false);  // grew
  });

  it("can never flag a single-row delete, whatever the workspace size (open-followups §323)", () => {
    for (let prev = 1; prev <= 2000; prev++) expect(isMassDeletion(prev, prev - 1), `prev=${prev}`).toBe(false);
  });
});

describe("the save-time counters cover user-authored content", () => {
  const ws = emptyWorkspace();

  const counted: ReadonlyArray<readonly [string, Partial<Workspace>]> = [
    ["documents", { documents: [{ id: "d1" }] as never }],
    ["knowledgeItems", { knowledgeItems: [{ id: "k1" }] as never }],
    ["documentAssets", { documentAssets: [{ id: "a1" }] as never }],
  ];

  it.each(counted)("%s counts toward both save-time guards", (_name, slice) => {
    expect(nonEmptyCollectionCount({ ...ws, ...slice })).toBe(1);
    expect(workspaceRecordCount({ ...ws, ...slice })).toBe(1);
  });

  it("a documents-only project losing every document is a full wipe, not a no-op", () => {
    const before = { ...ws, documents: [{ id: "d1" }, { id: "d2" }] as never, tasks: [{ id: 1 }] as never };
    const after = { ...ws, tasks: [{ id: 1 }] as never };
    expect(nonEmptyCollectionCount(before)).toBe(2);
    expect(nonEmptyCollectionCount(after)).toBe(1);
    expect(workspaceRecordCount(before) - workspaceRecordCount(after)).toBe(2);
  });
});

describe("the save-time counters deliberately exclude auto-grown slices", () => {
  const ws = emptyWorkspace();

  it("activityLog is excluded, or the L3 full-wipe guard could never fire again", () => {
    // ★★★ THIS IS NOT STYLE. nonEmptyCollectionCount reaching 0 is L3's whole
    //     trigger, and the log is auto-appended by ordinary use — so counting
    //     it means a project that has ever been used can never reach 0, and the
    //     full-wipe guard is dead for good. The identical inversion is already
    //     documented on isWorkspaceEmpty, which warns against "completing" the
    //     documents precedent by adding it.
    const logged = { ...ws, activityLog: [{ id: "e1" }, { id: "e2" }] as never };
    expect(nonEmptyCollectionCount(logged)).toBe(0);
    expect(workspaceRecordCount(logged)).toBe(0);
  });

  it("budgetHistory is excluded — the same inversion as activityLog", () => {
    // Written by ordinary budget edits as a side record. Asserted as "adding it
    // changes NOTHING" against a base that already counts (positive control),
    // and against the empty workspace for isWorkspaceEmpty.
    const history = [{ id: "b1" }, { id: "b2" }, { id: "b3" }] as never;
    const base = { ...ws, tasks: [{ id: 1 }] as never };
    expect(nonEmptyCollectionCount(base)).toBe(1);
    expect(workspaceRecordCount(base)).toBe(1);
    expect(nonEmptyCollectionCount({ ...base, budgetHistory: history })).toBe(1);
    expect(workspaceRecordCount({ ...base, budgetHistory: history })).toBe(1);
    expect(nonEmptyCollectionCount({ ...ws, budgetHistory: history })).toBe(0);
    expect(workspaceRecordCount({ ...ws, budgetHistory: history })).toBe(0);
    expect(isWorkspaceEmpty({ ...ws, budgetHistory: history })).toBe(true);
  });

  it("baselineHistory is excluded — the same inversion as budgetHistory (§476)", () => {
    // Appended by a confirmed currency switch and never emptied by use. Same
    // shape as above: adding it changes NOTHING against a counting base.
    const history = [{ from: "2026-01-05", at: "2026-01-05T08:00:00.000Z", currency: "GBP" }] as never;
    const base = { ...ws, tasks: [{ id: 1 }] as never };
    expect(nonEmptyCollectionCount(base)).toBe(1);
    expect(workspaceRecordCount(base)).toBe(1);
    expect(nonEmptyCollectionCount({ ...base, baselineHistory: history })).toBe(1);
    expect(workspaceRecordCount({ ...base, baselineHistory: history })).toBe(1);
    expect(nonEmptyCollectionCount({ ...ws, baselineHistory: history })).toBe(0);
    expect(workspaceRecordCount({ ...ws, baselineHistory: history })).toBe(0);
    expect(isWorkspaceEmpty({ ...ws, baselineHistory: history })).toBe(true);
  });

  it("forecastHistory is excluded — the same inversion as budgetHistory (§502)", () => {
    // Recorded once per day the simulation is on and never emptied by use. Adding it changes
    // NOTHING against a counting base, exactly as baselineHistory above.
    const history = [{ date: "2026-10-01", p50: "2026-11-02", p80: null, p95: null, chanceOnTime: 0.5 }] as never;
    const base = { ...ws, tasks: [{ id: 1 }] as never };
    expect(nonEmptyCollectionCount(base)).toBe(1);
    expect(workspaceRecordCount(base)).toBe(1);
    expect(nonEmptyCollectionCount({ ...base, forecastHistory: history })).toBe(1);
    expect(workspaceRecordCount({ ...base, forecastHistory: history })).toBe(1);
    expect(nonEmptyCollectionCount({ ...ws, forecastHistory: history })).toBe(0);
    expect(workspaceRecordCount({ ...ws, forecastHistory: history })).toBe(0);
    expect(isWorkspaceEmpty({ ...ws, forecastHistory: history })).toBe(true);
  });

  it("forecastScenarios is excluded — scenario inputs are not project records (§502)", () => {
    // At most four short lists of what-if inputs. Adding them changes NOTHING against a counting
    // base, and a project holding only scenarios still reads as empty — both directions, as above.
    const scenarios = [{ id: 1, name: "Two more people", changes: [] }] as never;
    const base = { ...ws, tasks: [{ id: 1 }] as never };
    expect(nonEmptyCollectionCount(base)).toBe(1);
    expect(workspaceRecordCount(base)).toBe(1);
    expect(nonEmptyCollectionCount({ ...base, forecastScenarios: scenarios })).toBe(1);
    expect(workspaceRecordCount({ ...base, forecastScenarios: scenarios })).toBe(1);
    expect(nonEmptyCollectionCount({ ...ws, forecastScenarios: scenarios })).toBe(0);
    expect(workspaceRecordCount({ ...ws, forecastScenarios: scenarios })).toBe(0);
    expect(isWorkspaceEmpty({ ...ws, forecastScenarios: scenarios })).toBe(true);
  });

  it("documentVersions is excluded, so a retention prune is not a mass deletion", () => {
    const versioned = { ...ws, documentVersions: Array.from({ length: 50 }, (_, i) => ({ id: `v${i}` })) as never };
    expect(nonEmptyCollectionCount(versioned)).toBe(0);
    expect(workspaceRecordCount(versioned)).toBe(0);
  });

  it("insights is excluded — derived by detection, regenerable", () => {
    const detected = { ...ws, insights: [{ key: "i1" }] as never };
    expect(nonEmptyCollectionCount(detected)).toBe(0);
    expect(workspaceRecordCount(detected)).toBe(0);
  });

  it("features is excluded — config, not records", () => {
    const configured = { ...ws, features: ["tasks"] as never };
    expect(nonEmptyCollectionCount(configured)).toBe(0);
    expect(workspaceRecordCount(configured)).toBe(0);
  });
});
