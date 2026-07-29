import { describe, expect, it } from "vitest";
import {
  SEARCH_MAX_PER_TYPE,
  SEARCH_MAX_RESULTS,
  buildSearchIndex,
  searchIndex,
  searchWorkspace,
  type SearchableWorkspace,
} from "./global-search";
import type {
  BudgetBucket,
  ChangeItem,
  Milestone,
  RaidItem,
  Resource,
  Stakeholder,
  Task,
} from "./types";

// --- factories -------------------------------------------------------------

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Task",
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-01-01",
    lastUpdateDate: "2026-01-01",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    description: "",
    ...over,
  };
}

function makeRaid(over: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 1,
    category: "R",
    title: "Risk",
    status: "Open",
    linkedTaskIds: [],
    raisedDate: "2026-01-01",
    causedByRaidIds: [],
    stakeholderIds: [],
    ...over,
  };
}

function makeChange(over: Partial<ChangeItem> = {}): ChangeItem {
  return {
    id: 1,
    title: "Change",
    description: "",
    type: "Scope",
    status: "Proposed",
    raisedDate: "2026-01-01",
    linkedTaskIds: [],
    linkedRaidIds: [],
    stakeholderIds: [],
    ...over,
  };
}

function makeMilestone(over: Partial<Milestone> = {}): Milestone {
  return {
    id: 1,
    name: "Milestone",
    date: "2026-01-01",
    linkedTaskIds: [],
    ...over,
  };
}

function makeStakeholder(over: Partial<Stakeholder> = {}): Stakeholder {
  return {
    id: 1,
    name: "Stakeholder",
    category: "Internal",
    influence: "Medium",
    interest: "Medium",
    raci: {},
    ...over,
  };
}

function makeBudget(over: Partial<BudgetBucket> = {}): BudgetBucket {
  return {
    id: 1,
    name: "Budget",
    type: "tm",
    currency: "EUR",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "open",
    allocations: [],
    ...over,
  };
}

function makeResource(over: Partial<Resource> = {}): Resource {
  return {
    id: 1,
    firstName: "First",
    lastName: "Last",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    ...over,
  };
}

function ws(over: Partial<SearchableWorkspace> = {}): SearchableWorkspace {
  return {
    tasks: [],
    raid: [],
    changes: [],
    milestones: [],
    stakeholders: [],
    budgets: [],
    resources: [],
    ...over,
  };
}

// --- tests -----------------------------------------------------------------

describe("searchWorkspace", () => {
  it("ranks a title match before a body-only match (title > body)", () => {
    const titleHit = makeTask({ id: 1, taskName: "Alpha gizmo" });
    const bodyHit = makeTask({ id: 2, taskName: "Beta", description: "has gizmo inside" });
    // iteration order puts the body hit first to prove ranking, not order, wins.
    const results = searchWorkspace(ws({ tasks: [bodyHit, titleHit] }), "gizmo");

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(1); // title hit
    expect(results[1].id).toBe(2); // body hit
  });

  it("matches RAID via owner body field", () => {
    const r = makeRaid({ id: 5, title: "Unrelated", owner: "Zara Owner" });
    const results = searchWorkspace(ws({ raid: [r] }), "zara");
    expect(results.map((x) => x.id)).toContain(5);
    expect(results[0].type).toBe("raid");
  });

  it("matches change via requestedBy body field", () => {
    const c = makeChange({ id: 6, title: "Unrelated", requestedBy: "Quentin" });
    const results = searchWorkspace(ws({ changes: [c] }), "quentin");
    expect(results.map((x) => x.id)).toContain(6);
    expect(results[0].type).toBe("change");
  });

  it("matches stakeholder via organization body field", () => {
    const s = makeStakeholder({ id: 7, name: "Unrelated", organization: "Acme Corp" });
    const results = searchWorkspace(ws({ stakeholders: [s] }), "acme");
    expect(results.map((x) => x.id)).toContain(7);
    expect(results[0].type).toBe("stakeholder");
  });

  it("matches milestone via description body field", () => {
    const m = makeMilestone({ id: 8, name: "Unrelated", description: "Phase gate review" });
    const results = searchWorkspace(ws({ milestones: [m] }), "phase gate");
    expect(results.map((x) => x.id)).toContain(8);
    expect(results[0].type).toBe("milestone");
  });

  it("matches task via labels body field (array joined)", () => {
    const t = makeTask({ id: 9, taskName: "Unrelated", labels: ["frontend", "urgent"] });
    const results = searchWorkspace(ws({ tasks: [t] }), "urgent");
    expect(results.map((x) => x.id)).toContain(9);
    expect(results[0].type).toBe("task");
  });

  it("matches budget via poNumber body field (#16)", () => {
    const b = makeBudget({ id: 12, name: "Unrelated", poNumber: "PO-4711" });
    const results = searchWorkspace(ws({ budgets: [b] }), "4711");
    expect(results.map((x) => x.id)).toContain(12);
    expect(results[0].type).toBe("budget");
  });

  it("matches resource via composed name and email (#16)", () => {
    const r = makeResource({ id: 13, firstName: "Ada", lastName: "Lovelace", email: "ada@x.io" });
    const byName = searchWorkspace(ws({ resources: [r] }), "lovelace");
    expect(byName.map((x) => x.id)).toContain(13);
    expect(byName[0].type).toBe("resource");
    expect(byName[0].title).toBe("Ada Lovelace");
    const byEmail = searchWorkspace(ws({ resources: [r] }), "ada@x.io");
    expect(byEmail.map((x) => x.id)).toContain(13);
  });

  it("puts an id-exact match first ahead of a text match", () => {
    const idHit = makeTask({ id: 7, taskName: "Nothing here" });
    const textHit = makeTask({ id: 100, taskName: "version 7 release" });
    const results = searchWorkspace(ws({ tasks: [textHit, idHit] }), "7");

    expect(results[0].id).toBe(7); // id-exact wins
    expect(results.map((x) => x.id)).toContain(100);
  });

  it("returns [] for a 1-char query", () => {
    const t = makeTask({ id: 1, taskName: "ab" });
    expect(searchWorkspace(ws({ tasks: [t] }), "a")).toEqual([]);
  });

  it("returns [] for an empty / whitespace query", () => {
    const t = makeTask({ id: 1, taskName: "ab" });
    expect(searchWorkspace(ws({ tasks: [t] }), "")).toEqual([]);
    expect(searchWorkspace(ws({ tasks: [t] }), "   ")).toEqual([]);
  });

  it("is case-insensitive (upper query matches lower field)", () => {
    const t = makeTask({ id: 1, taskName: "lowercase widget" });
    const results = searchWorkspace(ws({ tasks: [t] }), "WIDGET");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  it("maps each type to the correct AppView", () => {
    const results = searchWorkspace(
      ws({
        tasks: [makeTask({ id: 1, taskName: "match" })],
        raid: [makeRaid({ id: 1, title: "match" })],
        changes: [makeChange({ id: 1, title: "match" })],
        milestones: [makeMilestone({ id: 1, name: "match" })],
        stakeholders: [makeStakeholder({ id: 1, name: "match" })],
        budgets: [makeBudget({ id: 1, name: "match" })],
        resources: [makeResource({ id: 1, firstName: "match", lastName: "row" })],
      }),
      "match",
    );

    const byType = new Map(results.map((r) => [r.type, r.view]));
    expect(byType.get("task")).toBe("open-points");
    expect(byType.get("raid")).toBe("raid");
    expect(byType.get("change")).toBe("changes");
    expect(byType.get("milestone")).toBe("milestones");
    expect(byType.get("stakeholder")).toBe("stakeholders");
    expect(byType.get("budget")).toBe("budget");
    expect(byType.get("resource")).toBe("resources");
  });

  it("caps each type to SEARCH_MAX_PER_TYPE", () => {
    const tasks = Array.from({ length: 15 }, (_, i) =>
      makeTask({ id: i + 1, taskName: `widget ${i}` }),
    );
    const results = searchWorkspace(ws({ tasks }), "widget");
    const taskResults = results.filter((r) => r.type === "task");
    expect(taskResults.length).toBeLessThanOrEqual(SEARCH_MAX_PER_TYPE);
  });

  it("caps merged results to SEARCH_MAX_RESULTS but keeps diversity across types", () => {
    const tasks = Array.from({ length: 8 }, (_, i) =>
      makeTask({ id: i + 1, taskName: `widget ${i}` }),
    );
    const raid = Array.from({ length: 8 }, (_, i) =>
      makeRaid({ id: i + 1, title: `widget ${i}` }),
    );
    const changes = Array.from({ length: 8 }, (_, i) =>
      makeChange({ id: i + 1, title: `widget ${i}` }),
    );
    const milestones = Array.from({ length: 8 }, (_, i) =>
      makeMilestone({ id: i + 1, name: `widget ${i}` }),
    );
    const stakeholders = Array.from({ length: 8 }, (_, i) =>
      makeStakeholder({ id: i + 1, name: `widget ${i}` }),
    );
    const budgets = Array.from({ length: 8 }, (_, i) =>
      makeBudget({ id: i + 1, name: `widget ${i}` }),
    );
    const resources = Array.from({ length: 8 }, (_, i) =>
      makeResource({ id: i + 1, firstName: "widget", lastName: `${i}` }),
    );

    const results = searchWorkspace(
      ws({ tasks, raid, changes, milestones, stakeholders, budgets, resources }),
      "widget",
    );

    expect(results.length).toBeLessThanOrEqual(SEARCH_MAX_RESULTS);
    const types = new Set(results.map((r) => r.type));
    expect(types.has("task")).toBe(true);
    expect(types.has("raid")).toBe(true);
    expect(types.has("change")).toBe(true);
    expect(types.has("milestone")).toBe(true);
    expect(types.has("stakeholder")).toBe(true);
    expect(types.has("budget")).toBe(true);
    expect(types.has("resource")).toBe(true);
  });
});

describe("buildSearchIndex + searchIndex (query-independent index)", () => {
  it("querying a prebuilt index equals the searchWorkspace one-shot", () => {
    const w = ws({
      tasks: [makeTask({ id: 1, taskName: "Alpha gizmo" }), makeTask({ id: 2, description: "gizmo" })],
      raid: [makeRaid({ id: 5, owner: "Zara" })],
    });
    const index = buildSearchIndex(w);
    for (const q of ["gizmo", "zara", "1", "nomatch"]) {
      expect(searchIndex(index, q)).toEqual(searchWorkspace(w, q));
    }
  });

  it("the index is reusable across many queries without rebuilding", () => {
    const index = buildSearchIndex(ws({ tasks: [makeTask({ id: 3, taskName: "Report draft" })] }));
    expect(searchIndex(index, "report").map((r) => r.id)).toEqual([3]);
    expect(searchIndex(index, "draft").map((r) => r.id)).toEqual([3]);
    expect(searchIndex(index, "xyz")).toEqual([]);
  });

  it("lowercases fields once at build so matching is case-insensitive", () => {
    const index = buildSearchIndex(ws({ tasks: [makeTask({ id: 9, taskName: "MixedCase" })] }));
    expect(searchIndex(index, "mixedcase").map((r) => r.id)).toEqual([9]);
  });
});

describe("rich descriptions are indexed as text (slice B)", () => {
  it("does not match on markup and does match on the words", () => {
    const index = buildSearchIndex(
      ws({
        raid: [
          makeRaid({
            id: 1,
            description: "<p>slipped <strong>badly</strong></p>",
            mitigation: "<p>escalate</p>",
          }),
        ],
      }),
    );
    expect(searchIndex(index, "strong")).toHaveLength(0);
    expect(searchIndex(index, "badly").map((r) => r.id)).toEqual([1]);
    expect(searchIndex(index, "escalate").map((r) => r.id)).toEqual([1]);
  });

  it("shows a milestone's description as plain text in the result subtitle", () => {
    const index = buildSearchIndex(
      ws({ milestones: [makeMilestone({ id: 7, description: "<p>final <em>cutover</em></p>" })] }),
    );
    const [row] = searchIndex(index, "cutover");
    expect(row.subtitle).toBe("final cutover");
  });

  it("finds a change by a word inside its rich description", () => {
    const index = buildSearchIndex(
      ws({ changes: [makeChange({ id: 3, description: "<p>scope <strong>creep</strong></p>" })] }),
    );
    expect(searchIndex(index, "creep")).toHaveLength(1);
  });

  // ★ pre-existing defect: bare htmlToText leaves DOMPurify's entity escapes in
  // the index, so a description containing "&" was only findable as "&amp;".
  it("finds a task description by an ampersand rather than by &amp;", () => {
    const index = buildSearchIndex(
      ws({ tasks: [makeTask({ id: 4, description: "<p>cost &amp; risk</p>" })] }),
    );
    expect(searchIndex(index, "cost & risk")).toHaveLength(1);
    expect(searchIndex(index, "amp")).toHaveLength(0);
  });
});
