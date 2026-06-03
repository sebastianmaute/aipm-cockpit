import { describe, expect, it } from "vitest";
import { applyChangeStatus } from "./use-change-log";
import type { ChangeItem } from "./types";

function ci(over: Partial<ChangeItem> = {}): ChangeItem {
  return { id: 1, title: "t", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], ...over };
}

describe("applyChangeStatus", () => {
  it("auto-fills decisionDate when leaving the pending set", () => {
    const next = applyChangeStatus(ci({ status: "Proposed" }), "Approved", "2026-06-09");
    expect(next.status).toBe("Approved");
    expect(next.decisionDate).toBe("2026-06-09");
  });
  it("keeps an existing decisionDate rather than overwriting", () => {
    const next = applyChangeStatus(ci({ status: "Approved", decisionDate: "2026-06-05" }), "Implemented", "2026-06-09");
    expect(next.decisionDate).toBe("2026-06-05");
  });
  it("clears decisionDate when returning to a pending status", () => {
    const next = applyChangeStatus(ci({ status: "Approved", decisionDate: "2026-06-05" }), "Under Review", "2026-06-09");
    expect(next.decisionDate).toBeUndefined();
  });
});
