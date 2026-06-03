import { describe, expect, it } from "vitest";
import {
  buildChangeByTaskIndex, changeImpactRag, compareChange, computeScopeStatus, countByStatus, countByType,
  defaultChangeStatus, isPendingChange, isTerminalChangeStatus, nextChangeId,
  SCOPE_PENDING_RED, selectTopChanges,
  type ChangeSortKey,
} from "./change-log";
import type { ChangeItem } from "./types";

function ci(over: Partial<ChangeItem> = {}): ChangeItem {
  return {
    id: 1, title: "t", description: "", type: "Scope", status: "Proposed",
    raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], ...over,
  };
}

describe("change-log predicates", () => {
  it("defaultChangeStatus is Proposed", () => expect(defaultChangeStatus()).toBe("Proposed"));
  it("pending = Proposed | Under Review", () => {
    expect(isPendingChange("Proposed")).toBe(true);
    expect(isPendingChange("Under Review")).toBe(true);
    expect(isPendingChange("Approved")).toBe(false);
  });
  it("terminal = Rejected | Implemented | Deferred", () => {
    expect(isTerminalChangeStatus("Rejected")).toBe(true);
    expect(isTerminalChangeStatus("Implemented")).toBe(true);
    expect(isTerminalChangeStatus("Deferred")).toBe(true);
    expect(isTerminalChangeStatus("Approved")).toBe(false);
    expect(isTerminalChangeStatus("Proposed")).toBe(false);
  });
});

describe("change-log helpers", () => {
  it("nextChangeId is max+1 (1 when empty)", () => {
    expect(nextChangeId([])).toBe(1);
    expect(nextChangeId([ci({ id: 3 }), ci({ id: 7 })])).toBe(8);
  });
  it("changeImpactRag maps via severity", () => {
    expect(changeImpactRag("Critical")).toBe("R");
    expect(changeImpactRag("Medium")).toBe("A");
    expect(changeImpactRag("Low")).toBe("G");
    expect(changeImpactRag(undefined)).toBe("G");
  });
  it("countByType / countByStatus tally", () => {
    const items = [ci({ type: "Scope", status: "Proposed" }), ci({ id: 2, type: "Cost", status: "Approved" })];
    expect(countByType(items).Scope).toBe(1);
    expect(countByType(items).Cost).toBe(1);
    expect(countByStatus(items).Approved).toBe(1);
  });
  it("buildChangeByTaskIndex groups by linked task id", () => {
    const a = ci({ id: 1, linkedTaskIds: [10, 20] });
    const b = ci({ id: 2, linkedTaskIds: [20] });
    const idx = buildChangeByTaskIndex([a, b]);
    expect(idx.get(10)).toHaveLength(1);
    expect(idx.get(20)).toHaveLength(2);
  });
});

describe("compareChange", () => {
  const a = ci({ id: 1, title: "alpha", type: "Scope", impact: "Low", status: "Proposed", requestedBy: "Ann", raisedDate: "2026-06-01", decisionDate: "2026-06-05" });
  const b = ci({ id: 2, title: "beta", type: "Cost", impact: "Critical", status: "Approved", requestedBy: "Bob", raisedDate: "2026-06-02" });
  const sorted = (key: ChangeSortKey, dir: "asc" | "desc") => [a, b].slice().sort((x, y) => compareChange(x, y, key, dir));
  it("sorts by impact rank ascending (Low < Critical)", () => {
    expect(sorted("impact", "asc").map((x) => x.id)).toEqual([1, 2]);
  });
  it("sorts by title descending", () => {
    expect(sorted("title", "desc").map((x) => x.id)).toEqual([2, 1]);
  });
  it("puts a missing decisionDate LAST regardless of direction", () => {
    expect(sorted("decisionDate", "asc").map((x) => x.id)).toEqual([1, 2]);
    expect(sorted("decisionDate", "desc").map((x) => x.id)).toEqual([1, 2]);
  });
});

describe("computeScopeStatus", () => {
  it("null when no pending changes", () => {
    expect(computeScopeStatus([ci({ status: "Approved" })])).toBeNull();
  });
  it("Amber with 1..4 pending", () => {
    expect(computeScopeStatus([ci({ status: "Proposed" })])).toBe("A");
  });
  it("Red at the threshold", () => {
    const pend = Array.from({ length: SCOPE_PENDING_RED }, (_, i) => ci({ id: i + 1, status: "Under Review" }));
    expect(computeScopeStatus(pend)).toBe("R");
  });
});

describe("selectTopChanges", () => {
  it("returns pending only, highest impact first, capped", () => {
    const items = [
      ci({ id: 1, status: "Proposed", impact: "Low" }),
      ci({ id: 2, status: "Under Review", impact: "Critical" }),
      ci({ id: 3, status: "Approved", impact: "Critical" }), // not pending -> excluded
    ];
    const top = selectTopChanges(items, 5);
    expect(top.map((c) => c.id)).toEqual([2, 1]);
  });
});
