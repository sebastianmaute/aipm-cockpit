import { describe, it, expect, vi } from "vitest";
import { executeActionCta } from "./action-cta-exec";

const deps = () => ({
  requestOpen: vi.fn(),
  resetFilters: vi.fn(),
  setAssigneeFilter: vi.fn(),
  setHealthFilter: vi.fn(),
  setActiveTab: vi.fn(),
});

describe("executeActionCta", () => {
  it("deep-links an open CTA", () => {
    const d = deps();
    executeActionCta({ kind: "open", view: "milestones", id: 4 }, d);
    expect(d.requestOpen).toHaveBeenCalledWith("milestones", 4);
    expect(d.resetFilters).not.toHaveBeenCalled();
  });

  it("resets the filters BEFORE applying the person filter", () => {
    const d = deps();
    executeActionCta({ kind: "open-tasks-for", resourceId: 7, resourceName: "Alice Anders" }, d);
    expect(d.resetFilters).toHaveBeenCalledTimes(1);
    expect(d.setAssigneeFilter).toHaveBeenCalledWith("Alice Anders");
    expect(d.setHealthFilter).toHaveBeenCalledWith("red");
    expect(d.setActiveTab).toHaveBeenCalledWith("open-points");
    // Order matters: a reset AFTER the set would wipe the filter we just applied.
    expect(d.resetFilters.mock.invocationCallOrder[0]).toBeLessThan(
      d.setAssigneeFilter.mock.invocationCallOrder[0],
    );
  });

  it("does not deep-link for open-tasks-for (no entity id to open)", () => {
    const d = deps();
    executeActionCta({ kind: "open-tasks-for", resourceId: 7, resourceName: "Alice" }, d);
    expect(d.requestOpen).not.toHaveBeenCalled();
  });

  // The workload engine joins an unlinked task to a directory resource by
  // CASE-FOLDED name, but the task filter compares assignee exactly and an
  // unmatched value resolves to "All" — showing every red task in the project.
  it("uses the exact-case assignee option when one is present", () => {
    const d = deps();
    executeActionCta(
      { kind: "open-tasks-for", resourceId: 7, resourceName: "Bo Smith" },
      { ...d, assigneeOptions: ["Ann Lee", "Bo Smith"] },
    );
    expect(d.setAssigneeFilter).toHaveBeenCalledWith("Bo Smith");
  });

  it("uses the STORED spelling when only a differently-cased option exists", () => {
    const d = deps();
    executeActionCta(
      { kind: "open-tasks-for", resourceId: 7, resourceName: "Bo Smith" },
      { ...d, assigneeOptions: ["ann lee", "bo smith"] },
    );
    expect(d.setAssigneeFilter).toHaveBeenCalledWith("bo smith");
  });

  it("falls back to the CTA name with no options or no match", () => {
    const noOptions = deps();
    executeActionCta({ kind: "open-tasks-for", resourceId: 7, resourceName: "Bo Smith" }, noOptions);
    expect(noOptions.setAssigneeFilter).toHaveBeenCalledWith("Bo Smith");

    const noMatch = deps();
    executeActionCta(
      { kind: "open-tasks-for", resourceId: 7, resourceName: "Bo Smith" },
      { ...noMatch, assigneeOptions: ["Ann Lee"] },
    );
    expect(noMatch.setAssigneeFilter).toHaveBeenCalledWith("Bo Smith");
  });

  it("ignores a snooze CTA", () => {
    const d = deps();
    executeActionCta({ kind: "snooze", actionId: "x" }, d);
    expect(d.requestOpen).not.toHaveBeenCalled();
    expect(d.setActiveTab).not.toHaveBeenCalled();
  });
});
