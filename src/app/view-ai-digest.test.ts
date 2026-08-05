import { describe, it, expect } from "vitest";
import { VIEW_AI_DIGEST, digestForView } from "./view-ai-digest";
import { FILTER_ALL } from "./task-filters";

describe("view digests", () => {
  it("covers exactly the four intended views", () => {
    expect(Object.keys(VIEW_AI_DIGEST).sort()).toEqual([
      "budget",
      "gantt",
      "open-points",
      "workload",
    ]);
  });

  it("returns undefined for a view with no digest", () => {
    expect(digestForView("raid", { tasks: [], resources: [] } as never)).toBeUndefined();
  });

  it("reports the visible task count and the active filters for open-points", () => {
    // `tasks` here is what the CALLER already narrowed down (mirrors
    // filteredSortedTasks) — the digest itself never re-applies the filter,
    // it only describes it. So the fixture carries just the one row an
    // assignee=Ana filter would leave visible, not the whole workspace.
    const text = digestForView("open-points", {
      tasks: [
        { id: 1, taskName: "A", status: "To Do", assignee: "Ana", dueDate: "2026-08-10" },
      ],
      filters: { assignee: "Ana", group: FILTER_ALL, label: FILTER_ALL },
      today: "2026-08-05",
    });
    expect(text).toContain("1 task(s)");
    expect(text).toContain("Ana");
  });

  it("is clock-free: the same input yields the same output", () => {
    const input = { tasks: [], filters: {} } as never;
    expect(digestForView("open-points", input)).toBe(digestForView("open-points", input));
  });

  it("says no filters are active when every filter is the FILTER_ALL sentinel", () => {
    const text = digestForView("open-points", {
      tasks: [{ id: 1, taskName: "A", status: "To Do", assignee: "Ana", dueDate: "2026-08-10" }],
      filters: { assignee: "All", group: "All", label: "All" },
      today: "2026-08-05",
    });
    expect(text).toContain("No filters active");
  });

  it("reports an empty-string filter value (e.g. GROUP_NONE) distinctly, not as inactive", () => {
    const text = digestForView("open-points", {
      tasks: [],
      filters: { assignee: "All", group: "", label: "All" },
      today: "2026-08-05",
    });
    expect(text).toContain("group=");
    expect(text).not.toContain("No filters active");
  });

  it("omits the visible-rows line entirely for an empty task list", () => {
    const text = digestForView("open-points", {
      tasks: [],
      today: "2026-08-05",
    });
    expect(text).toContain("0 task(s)");
    expect(text).not.toContain("Visible rows");
  });

  it("truncates the visible-rows sample at 15 and reports how many more are hidden", () => {
    const tasks = Array.from({ length: 20 }, (_, idx) => ({
      id: idx + 1,
      taskName: `Task ${idx + 1}`,
      status: "To Do",
      assignee: "Ana",
      dueDate: "2026-08-10",
    }));
    const text = digestForView("open-points", { tasks, today: "2026-08-05" });
    expect(text).toContain("20 task(s)");
    expect(text).toContain("5 further visible rows");
  });

  it("reports the resource count for workload", () => {
    const text = digestForView("workload", {
      tasks: [],
      resources: [
        { id: 1, firstName: "Ana", lastName: "Ng" },
        { id: 2, firstName: "Bo", lastName: "Lin" },
      ],
      today: "2026-08-05",
    });
    expect(text).toContain("2 resource(s)");
  });

  it("defaults workload to zero resources when none are supplied", () => {
    const text = digestForView("workload", { tasks: [], today: "2026-08-05" });
    expect(text).toContain("0 resource(s)");
  });

  it("reports task and milestone counts for gantt", () => {
    const text = digestForView("gantt", {
      tasks: [{ id: 1, taskName: "A", status: "To Do", assignee: "Ana", dueDate: "2026-08-10" }],
      milestones: [{ id: 1, name: "Kickoff", date: "2026-08-20" }],
      today: "2026-08-05",
    });
    expect(text).toContain("1 task(s)");
    expect(text).toContain("1 milestone(s)");
  });

  it("defaults gantt milestone count to zero when none are supplied", () => {
    const text = digestForView("gantt", { tasks: [], today: "2026-08-05" });
    expect(text).toContain("0 milestone(s)");
  });

  it("reports the bucket count for budget", () => {
    const text = digestForView("budget", {
      tasks: [],
      budgets: [{ id: 1, name: "Delivery" }],
      today: "2026-08-05",
    });
    expect(text).toContain("1 bucket(s)");
  });

  it("defaults budget bucket count to zero when none are supplied", () => {
    const text = digestForView("budget", { tasks: [], today: "2026-08-05" });
    expect(text).toContain("0 bucket(s)");
  });
});
