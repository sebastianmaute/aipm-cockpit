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
