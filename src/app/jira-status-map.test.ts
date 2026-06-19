import { describe, expect, it } from "vitest";
import { jiraCategoryToStatus, isJiraSynced } from "./jira-status-map";
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
