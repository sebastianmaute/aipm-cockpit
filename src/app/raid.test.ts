import { describe, it, expect, test, beforeEach } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import {
  riskSeverityFromMatrix,
  statusOptionsFor,
  isTerminalStatus,
  severityRag,
  defaultStatusForCategory,
  buildRaidByTaskIndex,
  countByCategory,
  nextRaidId,
  buildRaidCausesIndex,
  wouldCreateCycle,
  compareRaid,
  type RaidSortKey,
} from "./raid";
import {
  ASSUMPTION_STATUSES,
  DEPENDENCY_STATUSES,
  ISSUE_STATUSES,
  RISK_STATUSES,
} from "./types";
import type { RaidItem } from "./types";

// ---------------------------------------------------------------------------
// Minimal factory — only the fields required by RaidItem
// ---------------------------------------------------------------------------
function makeItem(overrides: Partial<RaidItem> & Pick<RaidItem, "id" | "category">): RaidItem {
  return {
    title: "test item",
    status: "Open",
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    raisedDate: "2025-01-01",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// riskSeverityFromMatrix
// ---------------------------------------------------------------------------
describe("riskSeverityFromMatrix", () => {
  // Low band: score 1–5
  it("returns Low for the minimum score (1×1 = 1)", () => {
    expect(riskSeverityFromMatrix(1, 1)).toBe("Low");
  });

  it("returns Low for score exactly 5 (1×5 = 5)", () => {
    expect(riskSeverityFromMatrix(1, 5)).toBe("Low");
  });

  it("returns Low for score exactly 5 via 5×1", () => {
    expect(riskSeverityFromMatrix(5, 1)).toBe("Low");
  });

  // Medium band: score 6–10
  it("returns Medium for score exactly 6 (2×3 = 6)", () => {
    expect(riskSeverityFromMatrix(2, 3)).toBe("Medium");
  });

  it("returns Medium for score exactly 10 (2×5 = 10)", () => {
    expect(riskSeverityFromMatrix(2, 5)).toBe("Medium");
  });

  it("returns Medium for midpoint 8 (2×4 = 8)", () => {
    expect(riskSeverityFromMatrix(2, 4)).toBe("Medium");
  });

  // High band: score 11–15
  it("returns High for score exactly 11 (3×4 — rounded up past 10, but not, use exact: no — use real combo)", () => {
    // 11 is not achievable with integers from 1-5, lowest above 10 is 12 (3×4) or 11 (no exact pair)
    // Actually 3×4=12, 2×5+1=11 not integer multiplication — lowest reachable > 10 is 12
    // Let's verify: 3×4=12 → High
    expect(riskSeverityFromMatrix(3, 4)).toBe("High");
  });

  it("returns High for score exactly 15 (3×5 = 15)", () => {
    expect(riskSeverityFromMatrix(3, 5)).toBe("High");
  });

  it("returns High for score exactly 15 via 5×3", () => {
    expect(riskSeverityFromMatrix(5, 3)).toBe("High");
  });

  // Critical band: score 16–25
  it("returns Critical for score exactly 16 (4×4 = 16)", () => {
    expect(riskSeverityFromMatrix(4, 4)).toBe("Critical");
  });

  it("returns Critical for score exactly 20 (4×5 = 20)", () => {
    expect(riskSeverityFromMatrix(4, 5)).toBe("Critical");
  });

  it("returns Critical for maximum score (5×5 = 25)", () => {
    expect(riskSeverityFromMatrix(5, 5)).toBe("Critical");
  });

  // Boundary around score 5→6 transition
  it("returns Low for 1×5=5 and Medium for 2×3=6, confirming the ≤5 boundary", () => {
    expect(riskSeverityFromMatrix(1, 5)).toBe("Low");
    expect(riskSeverityFromMatrix(2, 3)).toBe("Medium");
  });

  // Boundary around score 10→12 transition (11 not achievable with RiskScale integers)
  it("returns Medium for 2×5=10 and High for 3×4=12, confirming the ≤10 boundary", () => {
    expect(riskSeverityFromMatrix(2, 5)).toBe("Medium");
    expect(riskSeverityFromMatrix(3, 4)).toBe("High");
  });

  // Boundary around score 15→16 transition
  it("returns High for 5×3=15 and Critical for 4×4=16, confirming the ≤15 boundary", () => {
    expect(riskSeverityFromMatrix(5, 3)).toBe("High");
    expect(riskSeverityFromMatrix(4, 4)).toBe("Critical");
  });
});

// ---------------------------------------------------------------------------
// statusOptionsFor
// ---------------------------------------------------------------------------
describe("statusOptionsFor", () => {
  it("returns RISK_STATUSES for category R", () => {
    expect(statusOptionsFor("R")).toEqual(RISK_STATUSES);
  });

  it("returns ASSUMPTION_STATUSES for category A", () => {
    expect(statusOptionsFor("A")).toEqual(ASSUMPTION_STATUSES);
  });

  it("returns ISSUE_STATUSES for category I", () => {
    expect(statusOptionsFor("I")).toEqual(ISSUE_STATUSES);
  });

  it("returns DEPENDENCY_STATUSES for category D", () => {
    expect(statusOptionsFor("D")).toEqual(DEPENDENCY_STATUSES);
  });

  it("R status list includes Open, Mitigated, Realized, Closed", () => {
    const statuses = statusOptionsFor("R");
    expect(statuses).toContain("Open");
    expect(statuses).toContain("Mitigated");
    expect(statuses).toContain("Realized");
    expect(statuses).toContain("Closed");
  });

  it("A status list includes Pending, Validated, Invalidated", () => {
    const statuses = statusOptionsFor("A");
    expect(statuses).toContain("Pending");
    expect(statuses).toContain("Validated");
    expect(statuses).toContain("Invalidated");
  });

  it("I status list includes Open, In Progress, Resolved, Closed", () => {
    const statuses = statusOptionsFor("I");
    expect(statuses).toContain("Open");
    expect(statuses).toContain("In Progress");
    expect(statuses).toContain("Resolved");
    expect(statuses).toContain("Closed");
  });

  it("D status list includes Open, In Progress, Delivered, Blocked", () => {
    const statuses = statusOptionsFor("D");
    expect(statuses).toContain("Open");
    expect(statuses).toContain("In Progress");
    expect(statuses).toContain("Delivered");
    expect(statuses).toContain("Blocked");
  });
});

// ---------------------------------------------------------------------------
// isTerminalStatus
// ---------------------------------------------------------------------------
describe("isTerminalStatus", () => {
  // Risk category
  it("R: Closed is terminal", () => {
    expect(isTerminalStatus("Closed", "R")).toBe(true);
  });

  it("R: Realized is terminal", () => {
    expect(isTerminalStatus("Realized", "R")).toBe(true);
  });

  it("R: Open is not terminal", () => {
    expect(isTerminalStatus("Open", "R")).toBe(false);
  });

  it("R: Mitigated is not terminal", () => {
    expect(isTerminalStatus("Mitigated", "R")).toBe(false);
  });

  // Assumption category
  it("A: Validated is terminal", () => {
    expect(isTerminalStatus("Validated", "A")).toBe(true);
  });

  it("A: Invalidated is terminal", () => {
    expect(isTerminalStatus("Invalidated", "A")).toBe(true);
  });

  it("A: Pending is not terminal", () => {
    expect(isTerminalStatus("Pending", "A")).toBe(false);
  });

  // Issue category
  it("I: Resolved is terminal", () => {
    expect(isTerminalStatus("Resolved", "I")).toBe(true);
  });

  it("I: Closed is terminal", () => {
    expect(isTerminalStatus("Closed", "I")).toBe(true);
  });

  it("I: Open is not terminal", () => {
    expect(isTerminalStatus("Open", "I")).toBe(false);
  });

  it("I: In Progress is not terminal", () => {
    expect(isTerminalStatus("In Progress", "I")).toBe(false);
  });

  // Dependency category
  it("D: Delivered is terminal", () => {
    expect(isTerminalStatus("Delivered", "D")).toBe(true);
  });

  it("D: Open is not terminal", () => {
    expect(isTerminalStatus("Open", "D")).toBe(false);
  });

  it("D: In Progress is not terminal", () => {
    expect(isTerminalStatus("In Progress", "D")).toBe(false);
  });

  it("D: Blocked is not terminal", () => {
    expect(isTerminalStatus("Blocked", "D")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// severityRag
// ---------------------------------------------------------------------------
describe("severityRag", () => {
  it("returns G when severity is undefined", () => {
    expect(severityRag(undefined)).toBe("G");
  });

  it("returns R for Critical severity", () => {
    expect(severityRag("Critical")).toBe("R");
  });

  it("returns R for High severity", () => {
    expect(severityRag("High")).toBe("R");
  });

  it("returns A for Medium severity", () => {
    expect(severityRag("Medium")).toBe("A");
  });

  it("returns G for Low severity", () => {
    expect(severityRag("Low")).toBe("G");
  });
});

// ---------------------------------------------------------------------------
// defaultStatusForCategory
// ---------------------------------------------------------------------------
describe("defaultStatusForCategory", () => {
  it("R defaults to Open", () => {
    expect(defaultStatusForCategory("R")).toBe("Open");
  });

  it("A defaults to Pending", () => {
    expect(defaultStatusForCategory("A")).toBe("Pending");
  });

  it("I defaults to Open", () => {
    expect(defaultStatusForCategory("I")).toBe("Open");
  });

  it("D defaults to Open", () => {
    expect(defaultStatusForCategory("D")).toBe("Open");
  });
});

// ---------------------------------------------------------------------------
// buildRaidByTaskIndex
// ---------------------------------------------------------------------------
describe("buildRaidByTaskIndex", () => {
  it("returns an empty map for an empty list", () => {
    expect(buildRaidByTaskIndex([]).size).toBe(0);
  });

  it("indexes a single item linked to one task", () => {
    const item = makeItem({ id: 1, category: "R", linkedTaskIds: [10] });
    const idx = buildRaidByTaskIndex([item]);
    expect(idx.get(10)).toEqual([item]);
  });

  it("indexes a single item linked to multiple tasks", () => {
    const item = makeItem({ id: 1, category: "R", linkedTaskIds: [10, 20] });
    const idx = buildRaidByTaskIndex([item]);
    expect(idx.get(10)).toEqual([item]);
    expect(idx.get(20)).toEqual([item]);
  });

  it("appends multiple items sharing the same task id", () => {
    const a = makeItem({ id: 1, category: "R", linkedTaskIds: [10] });
    const b = makeItem({ id: 2, category: "I", linkedTaskIds: [10] });
    const idx = buildRaidByTaskIndex([a, b]);
    expect(idx.get(10)).toEqual([a, b]);
  });

  it("does not create entries for items with no linked tasks", () => {
    const item = makeItem({ id: 1, category: "A", linkedTaskIds: [] });
    const idx = buildRaidByTaskIndex([item]);
    expect(idx.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// countByCategory
// ---------------------------------------------------------------------------
describe("countByCategory", () => {
  it("returns all zeros for an empty list", () => {
    expect(countByCategory([])).toEqual({ R: 0, A: 0, I: 0, D: 0 });
  });

  it("counts one item per category correctly", () => {
    const items = [
      makeItem({ id: 1, category: "R" }),
      makeItem({ id: 2, category: "A" }),
      makeItem({ id: 3, category: "I" }),
      makeItem({ id: 4, category: "D" }),
    ];
    expect(countByCategory(items)).toEqual({ R: 1, A: 1, I: 1, D: 1 });
  });

  it("counts multiple items in the same category", () => {
    const items = [
      makeItem({ id: 1, category: "R" }),
      makeItem({ id: 2, category: "R" }),
      makeItem({ id: 3, category: "I" }),
    ];
    const result = countByCategory(items);
    expect(result.R).toBe(2);
    expect(result.I).toBe(1);
    expect(result.A).toBe(0);
    expect(result.D).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// nextRaidId
// ---------------------------------------------------------------------------
describe("nextRaidId", () => {
  beforeEach(__resetMintStateForTests);

  it("returns 1 for an empty list", () => {
    expect(nextRaidId([])).toBe(1);
  });

  it("never reuses a deleted id within the session", () => {
    const three = [
      makeItem({ id: 1, category: "R" }),
      makeItem({ id: 2, category: "A" }),
      makeItem({ id: 3, category: "I" }),
    ];
    expect(nextRaidId(three)).toBe(4);
    // id 3 "deleted" — minting over [1,2] must NOT reuse 3
    const two = [makeItem({ id: 1, category: "R" }), makeItem({ id: 2, category: "A" })];
    expect(nextRaidId(two)).toBe(5);
  });

  it("returns max id + 1 for a non-empty list", () => {
    const items = [
      makeItem({ id: 3, category: "R" }),
      makeItem({ id: 7, category: "A" }),
      makeItem({ id: 2, category: "I" }),
    ];
    expect(nextRaidId(items)).toBe(8);
  });

  it("handles a list with a single item", () => {
    expect(nextRaidId([makeItem({ id: 5, category: "D" })])).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// buildRaidCausesIndex
// ---------------------------------------------------------------------------
describe("buildRaidCausesIndex", () => {
  it("returns an empty map for an empty list", () => {
    expect(buildRaidCausesIndex([]).size).toBe(0);
  });

  it("returns an empty map when no item has causedByRaidIds", () => {
    const item = makeItem({ id: 1, category: "I", causedByRaidIds: [] });
    expect(buildRaidCausesIndex([item]).size).toBe(0);
  });

  it("indexes a child under its parent", () => {
    const parent = makeItem({ id: 1, category: "R", causedByRaidIds: [] });
    const child = makeItem({ id: 2, category: "I", causedByRaidIds: [1] });
    const idx = buildRaidCausesIndex([parent, child]);
    expect(idx.get(1)).toEqual([child]);
  });

  it("indexes a child with multiple parents under each parent", () => {
    const child = makeItem({ id: 3, category: "I", causedByRaidIds: [1, 2] });
    const idx = buildRaidCausesIndex([child]);
    expect(idx.get(1)).toEqual([child]);
    expect(idx.get(2)).toEqual([child]);
  });

  it("appends multiple children under the same parent", () => {
    const childA = makeItem({ id: 2, category: "I", causedByRaidIds: [1] });
    const childB = makeItem({ id: 3, category: "A", causedByRaidIds: [1] });
    const idx = buildRaidCausesIndex([childA, childB]);
    expect(idx.get(1)).toEqual([childA, childB]);
  });

  it("handles items with undefined causedByRaidIds gracefully via nullish coalescing", () => {
    // The implementation uses `item.causedByRaidIds ?? []`, so an item without
    // the field should produce no entries.
    const item = { ...makeItem({ id: 1, category: "I" }), causedByRaidIds: undefined as unknown as number[] };
    expect(buildRaidCausesIndex([item]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// wouldCreateCycle
// ---------------------------------------------------------------------------
describe("wouldCreateCycle", () => {
  it("returns true for a self-reference (childId === proposedParentId)", () => {
    expect(wouldCreateCycle([], 1, 1)).toBe(true);
  });

  it("returns false when there are no items and no relationship exists", () => {
    expect(wouldCreateCycle([], 1, 2)).toBe(false);
  });

  it("returns false for a simple non-cyclic parent–child relationship", () => {
    // 1 ← 2  (item 2 is caused by item 1). Adding 1 as parent of 3 is safe.
    const items = [
      makeItem({ id: 1, category: "R", causedByRaidIds: [] }),
      makeItem({ id: 2, category: "I", causedByRaidIds: [1] }),
    ];
    expect(wouldCreateCycle(items, 3, 1)).toBe(false);
  });

  it("returns true for a direct 2-node cycle (A→B, proposing B→A)", () => {
    // For a real cycle: item 1 caused by 2, item 2 caused by 1.
    const cyclic = [
      makeItem({ id: 1, category: "R", causedByRaidIds: [] }),
      makeItem({ id: 2, category: "I", causedByRaidIds: [1] }),
    ];
    // proposing to add 2 as parent of 1: walk ancestors of 2 → finds 1 → cycle
    expect(wouldCreateCycle(cyclic, 1, 2)).toBe(true);
  });

  it("returns true for a 3-node transitive cycle (A←B←C, proposing C as parent of A)", () => {
    // Chain: 3 ← 2 ← 1 (item 1's ancestors: 2, then 3)
    // Propose adding 3 as a parent of item 1 would close 1→3→2→1.
    const items = [
      makeItem({ id: 1, category: "R", causedByRaidIds: [] }),
      makeItem({ id: 2, category: "I", causedByRaidIds: [1] }),
      makeItem({ id: 3, category: "A", causedByRaidIds: [2] }),
    ];
    // Proposing 3 as parent of 1: walk ancestors of 3 → 2 → 1 → found childId=1 → true
    expect(wouldCreateCycle(items, 1, 3)).toBe(true);
  });

  it("returns false for a legitimate addition that does not close any loop", () => {
    // Chain: 1 ← 2 ← 3. Adding 4 as parent of 1 is safe.
    const items = [
      makeItem({ id: 1, category: "R", causedByRaidIds: [] }),
      makeItem({ id: 2, category: "I", causedByRaidIds: [1] }),
      makeItem({ id: 3, category: "A", causedByRaidIds: [2] }),
      makeItem({ id: 4, category: "D", causedByRaidIds: [] }),
    ];
    expect(wouldCreateCycle(items, 1, 4)).toBe(false);
  });

  it("terminates without infinite loop even when stored data is already cyclic", () => {
    // Hand-edit scenario: items 1 and 2 already reference each other.
    const items = [
      makeItem({ id: 1, category: "R", causedByRaidIds: [2] }),
      makeItem({ id: 2, category: "I", causedByRaidIds: [1] }),
    ];
    // Just verify it terminates and returns a boolean (visited-set protection)
    const result = wouldCreateCycle(items, 3, 1);
    expect(typeof result).toBe("boolean");
  });

  it("returns true when proposedParent is a grandparent of the proposedParent itself (multi-hop)", () => {
    // Propose: add item 1 as parent of item 1 (self-ref covered above),
    // but also: item 3's parent is item 2, item 2's parent is item 1.
    // Proposing item 3 as parent of item 1: walk 3→2→1 → hit childId=1 → true.
    const items = [
      makeItem({ id: 1, category: "R", causedByRaidIds: [] }),
      makeItem({ id: 2, category: "I", causedByRaidIds: [1] }),
      makeItem({ id: 3, category: "A", causedByRaidIds: [2] }),
    ];
    expect(wouldCreateCycle(items, 1, 3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// compareRaid
// ---------------------------------------------------------------------------
function ri(over: Partial<import("./types").RaidItem>): import("./types").RaidItem {
  return {
    id: 1,
    category: "R",
    title: "t",
    status: "Open",
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    raisedDate: "2026-01-01",
    ...over,
  };
}

describe("compareRaid", () => {
  const sortBy = (items: import("./types").RaidItem[], key: RaidSortKey, dir: "asc" | "desc" = "asc") =>
    [...items].sort((a, b) => compareRaid(a, b, key, dir));

  test("severity by rank Low<Medium<High<Critical (missing lowest)", () => {
    const items = [
      ri({ id: 1, severity: "Critical" }),
      ri({ id: 2, severity: "Low" }),
      ri({ id: 3, severity: undefined }),
      ri({ id: 4, severity: "High" }),
    ];
    expect(sortBy(items, "severity", "asc").map((i) => i.id)).toEqual([3, 2, 4, 1]);
    expect(sortBy(items, "severity", "desc").map((i) => i.id)).toEqual([1, 4, 2, 3]);
  });

  test("category follows R→A→I→D", () => {
    const items = [
      ri({ id: 1, category: "D" }),
      ri({ id: 2, category: "R" }),
      ri({ id: 3, category: "I" }),
      ri({ id: 4, category: "A" }),
    ];
    expect(sortBy(items, "category", "asc").map((i) => i.category)).toEqual(["R", "A", "I", "D"]);
  });

  test("id numeric, owner case-insensitive", () => {
    expect(sortBy([ri({ id: 10 }), ri({ id: 2 })], "id").map((i) => i.id)).toEqual([2, 10]);
    expect(
      sortBy([ri({ id: 1, owner: "bob" }), ri({ id: 2, owner: "Alice" })], "owner").map((i) => i.id),
    ).toEqual([2, 1]);
  });

  test("owner sorts by the linked resource's LIVE name, not the stale cache", () => {
    const byId = new Map<number, import("./types").Resource>([
      [7, { id: 7, firstName: "Aaa", lastName: "Live", roleId: null, utilizationMode: "percent", utilization: {} } as import("./types").Resource],
      [8, { id: 8, firstName: "Zzz", lastName: "Live", roleId: null, utilizationMode: "percent", utilization: {} } as import("./types").Resource],
    ]);
    // id1's cache sorts LAST but its live name is first; id2 the opposite.
    const items = [
      ri({ id: 1, owner: "Zzz Cache", ownerResourceId: 7 }),
      ri({ id: 2, owner: "Aaa Cache", ownerResourceId: 8 }),
    ];
    // With the directory → live names: Aaa(id1) before Zzz(id2).
    expect([...items].sort((a, b) => compareRaid(a, b, "owner", "asc", byId)).map((i) => i.id)).toEqual([1, 2]);
    // Without it → cache: "Aaa Cache"(id2) before "Zzz Cache"(id1).
    expect([...items].sort((a, b) => compareRaid(a, b, "owner", "asc")).map((i) => i.id)).toEqual([2, 1]);
  });

  test("missing targetDate sorts LAST in both directions", () => {
    const items = [
      ri({ id: 1, targetDate: undefined }),
      ri({ id: 2, targetDate: "2026-03-01" }),
      ri({ id: 3, targetDate: "2026-01-01" }),
    ];
    expect(sortBy(items, "targetDate", "asc").map((i) => i.id)).toEqual([3, 2, 1]);
    expect(sortBy(items, "targetDate", "desc").map((i) => i.id)).toEqual([2, 3, 1]);
  });
});
