import { describe, expect, it } from "vitest";
import { sanitizeChangeItem } from "./sanitize";

describe("sanitizeChangeItem", () => {
  it("returns null without a positive id or a title", () => {
    expect(sanitizeChangeItem({ title: "x" })).toBeNull();
    expect(sanitizeChangeItem({ id: 1 })).toBeNull();
  });
  it("accepts a minimal valid item with enum + array defaults", () => {
    const c = sanitizeChangeItem({ id: 2, title: "Add scope", raisedDate: "2026-06-01" });
    expect(c).toMatchObject({ id: 2, title: "Add scope", type: "Other", status: "Proposed", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] });
  });
  it("falls back to Other/Proposed for invalid enums and clamps numbers", () => {
    const c = sanitizeChangeItem({ id: 3, title: "t", type: "Bogus", status: "Nope", scheduleImpactDays: -4, costImpact: "12.5" });
    expect(c?.type).toBe("Other");
    expect(c?.status).toBe("Proposed");
    expect(c?.scheduleImpactDays).toBeUndefined();
    expect(c?.costImpact).toBe(12.5);
  });
  it("keeps valid impact + decision fields + id arrays", () => {
    const c = sanitizeChangeItem({ id: 4, title: "t", impact: "High", status: "Approved", decisionBy: "Bob", decisionDate: "2026-06-09", linkedTaskIds: [1, "2", -3, 0], linkedRaidIds: [5], stakeholderIds: [8, "9"] });
    expect(c?.impact).toBe("High");
    expect(c?.decisionDate).toBe("2026-06-09");
    expect(c?.linkedTaskIds).toEqual([1, 2]);
    expect(c?.linkedRaidIds).toEqual([5]);
    expect(c?.stakeholderIds).toEqual([8, 9]);
  });
  it("preserves outlookEventId, capped at 1024", () => {
    const ok = sanitizeChangeItem({ id: 1, title: "t", status: "Approved", decisionDate: "2026-06-09", outlookEventId: "evt-123", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] });
    expect(ok?.outlookEventId).toBe("evt-123");
    const long = sanitizeChangeItem({ id: 2, title: "t", status: "Approved", outlookEventId: "x".repeat(2000), linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] });
    expect(long?.outlookEventId?.length).toBe(1024);
    const none = sanitizeChangeItem({ id: 3, title: "t", status: "Proposed", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] });
    expect(none?.outlookEventId).toBeUndefined();
  });
});
