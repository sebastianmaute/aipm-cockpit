import { describe, expect, it } from "vitest";
import {
  buildChangeByTaskIndex, changeImpactRag, countByStatus, countByType,
  defaultChangeStatus, isPendingChange, isTerminalChangeStatus, nextChangeId,
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
