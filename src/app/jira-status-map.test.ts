import { describe, expect, it } from "vitest";
import { jiraCategoryToStatus, isJiraSynced, statusToJiraCategory } from "./jira-status-map";
import type { Task } from "./types";

describe("jiraCategoryToStatus", () => {
  it("maps the three Jira status categories", () => {
    expect(jiraCategoryToStatus("new")).toBe("To Do");
    expect(jiraCategoryToStatus("indeterminate")).toBe("In Progress");
    expect(jiraCategoryToStatus("done")).toBe("Done");
  });
  it("defaults unknown/empty to To Do", () => {
    expect(jiraCategoryToStatus("")).toBe("To Do");
    expect(jiraCategoryToStatus("weird")).toBe("To Do");
  });
});

describe("isJiraSynced", () => {
  it("is true only when jiraKey is set", () => {
    expect(isJiraSynced({ jiraKey: "LOP-1" } as Task)).toBe(true);
    expect(isJiraSynced({} as Task)).toBe(false);
  });
});

describe("statusToJiraCategory", () => {
  it("maps each local status to the Jira category that can carry it", () => {
    expect(statusToJiraCategory("To Do")).toBe("new");
    expect(statusToJiraCategory("In Progress")).toBe("indeterminate");
    // ★ The three Jira cannot represent. On Hold and In Review are both
    //   work-in-flight; Cancelled is terminal, and Jira files cancelled and
    //   won't-do resolutions under the `done` category.
    expect(statusToJiraCategory("On Hold")).toBe("indeterminate");
    expect(statusToJiraCategory("In Review")).toBe("indeterminate");
    expect(statusToJiraCategory("Cancelled")).toBe("done");
    expect(statusToJiraCategory("Done")).toBe("done");
  });

  it("round-trips every status to one Jira can actually produce", () => {
    // The point of the function: whatever it returns must map back through
    // jiraCategoryToStatus to one of the three reachable statuses, or the
    // comparison in diffTaskAgainstIssue can never converge.
    for (const s of ["To Do", "In Progress", "On Hold", "In Review", "Cancelled", "Done"] as const) {
      const back = jiraCategoryToStatus(statusToJiraCategory(s));
      expect(["To Do", "In Progress", "Done"]).toContain(back);
    }
  });
});
