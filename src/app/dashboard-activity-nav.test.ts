import { describe, it, expect } from "vitest";
import { activityViewOf } from "./dashboard-activity-nav";
import { ACTIVITY_KIND_TO_KEY, type ActivityKind } from "./activity-log";

describe("activityViewOf", () => {
  it("maps entity kinds to their view", () => {
    expect(activityViewOf("task.completed")).toBe("open-points");
    expect(activityViewOf("raid.created")).toBe("raid");
    expect(activityViewOf("milestone.updated")).toBe("milestones");
    expect(activityViewOf("change.created")).toBe("changes");
    expect(activityViewOf("stakeholder.updated")).toBe("stakeholders");
  });

  // ★ The other five ai.* kinds write to other registers, so this must be an
  // exact match and not an "ai." prefix rule — asserted here together so a
  // prefix "simplification" fails on the very next line.
  it("sends an assistant document write to the Documents view, and no other ai.* kind", () => {
    expect(activityViewOf("ai.documentWrite")).toBe("documents");
    expect(activityViewOf("ai.inlineEdit")).toBeNull();
    expect(activityViewOf("ai.taskDedup")).toBeNull();
    expect(activityViewOf("ai.insightRecommendation")).toBeNull();
    expect(activityViewOf("ai.allocationPlan")).toBeNull();
    expect(activityViewOf("ai.raciSuggest")).toBeNull();
  });

  it("returns null for non-deep-linkable kinds", () => {
    expect(activityViewOf("bulk.edit")).toBeNull();
    expect(activityViewOf("jira.sync")).toBeNull();
    expect(activityViewOf("settings.updated")).toBeNull();
    expect(activityViewOf("doc.linkAdded")).toBeNull();
    expect(activityViewOf("resource.created")).toBeNull();
  });

  it("is total over the ActivityKind union (never throws)", () => {
    for (const kind of Object.keys(ACTIVITY_KIND_TO_KEY) as ActivityKind[]) {
      expect(() => activityViewOf(kind)).not.toThrow();
    }
  });
});
