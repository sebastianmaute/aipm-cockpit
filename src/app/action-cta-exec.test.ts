import { describe, it, expect, vi } from "vitest";
import { executeActionCta } from "./action-cta-exec";

const deps = () => ({
  requestOpen: vi.fn(),
  resetFilterValues: vi.fn(),
  setAssigneeFilter: vi.fn(),
  setHealthFilter: vi.fn(),
  setActiveTab: vi.fn(),
});

describe("executeActionCta", () => {
  it("deep-links an open CTA", () => {
    const d = deps();
    executeActionCta({ kind: "open", view: "milestones", id: 4 }, d);
    expect(d.requestOpen).toHaveBeenCalledWith("milestones", 4);
    expect(d.resetFilterValues).not.toHaveBeenCalled();
  });

  it("resets the filters BEFORE applying the person filter", () => {
    const d = deps();
    executeActionCta({ kind: "open-tasks-for", resourceId: 7, resourceName: "Alice Anders" }, d);
    expect(d.resetFilterValues).toHaveBeenCalledTimes(1);
    expect(d.setAssigneeFilter).toHaveBeenCalledWith("Alice Anders");
    expect(d.setHealthFilter).toHaveBeenCalledWith("red");
    expect(d.setActiveTab).toHaveBeenCalledWith("open-points");
    // Order matters: a reset AFTER the set would wipe the filter we just applied.
    expect(d.resetFilterValues.mock.invocationCallOrder[0]).toBeLessThan(
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

  // Undefined options is NOT evidence of an orphan — it means the caller never
  // told us what the filter offers, so the CTA's own name stays the best guess.
  it("falls back to the CTA name when no options were provided at all", () => {
    const d = deps();
    executeActionCta({ kind: "open-tasks-for", resourceId: 7, resourceName: "Bo Smith" }, d);
    expect(d.setAssigneeFilter).toHaveBeenCalledWith("Bo Smith");
    expect(d.setActiveTab).toHaveBeenCalledWith("open-points");
  });

  // ★★ A PROVIDED list that misses the person IS proof of an orphan: hide-external
  // -tasks keeps an external's tasks out of uniqueAssignees while the workload
  // engine still raises their overload. Setting the name anyway made
  // resolveEffectiveFilters collapse it to FILTER_ALL, so Open Points opened
  // reading "All" + health red — the whole project's red backlog presented as one
  // person's overdue work. Filter nothing and report instead.
  it("does not orphan the filter when the person is in no live option", () => {
    const d = deps();
    const onUnresolvedAssignee = vi.fn();
    executeActionCta(
      { kind: "open-tasks-for", resourceId: 7, resourceName: "Dana Ext" },
      { ...d, assigneeOptions: ["Ann Lee", "Bo Smith"], onUnresolvedAssignee },
    );
    expect(d.setAssigneeFilter).not.toHaveBeenCalled();
    expect(d.setHealthFilter).not.toHaveBeenCalled();
    expect(d.setActiveTab).not.toHaveBeenCalled();
    expect(d.requestOpen).not.toHaveBeenCalled();
    // ...and the user is told why, rather than the click doing nothing at all.
    expect(onUnresolvedAssignee).toHaveBeenCalledWith("Dana Ext");
  });

  // Bailing must not cost the user the filters they already had: the reset is for
  // a navigation that is no longer happening, so it would be a second silent loss.
  it("leaves the existing filters untouched when it bails", () => {
    const d = deps();
    executeActionCta(
      { kind: "open-tasks-for", resourceId: 7, resourceName: "Dana Ext" },
      { ...d, assigneeOptions: ["Ann Lee"] },
    );
    expect(d.resetFilterValues).not.toHaveBeenCalled();
  });

  // The reporting hook is optional — a caller that omits it must not crash.
  it("bails safely when no report callback is wired", () => {
    const d = deps();
    expect(() =>
      executeActionCta(
        { kind: "open-tasks-for", resourceId: 7, resourceName: "Dana Ext" },
        { ...d, assigneeOptions: ["Ann Lee"] },
      ),
    ).not.toThrow();
    expect(d.setAssigneeFilter).not.toHaveBeenCalled();
  });

  it("ignores a snooze CTA", () => {
    const d = deps();
    executeActionCta({ kind: "snooze", actionId: "x" }, d);
    expect(d.requestOpen).not.toHaveBeenCalled();
    expect(d.setActiveTab).not.toHaveBeenCalled();
  });
});
