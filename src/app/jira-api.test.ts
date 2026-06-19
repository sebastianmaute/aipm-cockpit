import { describe, it, expect } from "vitest";
import { classifyJiraError, issueToTaskFields, JiraApiError, type JiraIssue } from "./jira-api";

describe("classifyJiraError", () => {
  it("classifies 401/403 as auth", () => {
    expect(classifyJiraError(new JiraApiError(401, {}))).toBe("auth");
    expect(classifyJiraError(new JiraApiError(403, {}))).toBe("auth");
  });
  it("classifies 5xx as network", () => {
    expect(classifyJiraError(new JiraApiError(500, {}))).toBe("network");
  });
  it("classifies other HTTP statuses as other", () => {
    expect(classifyJiraError(new JiraApiError(404, {}))).toBe("other");
    expect(classifyJiraError(new JiraApiError(400, {}))).toBe("other");
  });
  it("classifies a thrown non-Jira error (fetch failure) as network", () => {
    expect(classifyJiraError(new TypeError("Failed to fetch"))).toBe("network");
  });
});

describe("issueToTaskFields status mapping", () => {
  const mk = (key: string): JiraIssue =>
    ({ key: "LOP-1", fields: { summary: "x", status: { statusCategory: { key } } } } as unknown as JiraIssue);

  it("derives status from statusCategory", () => {
    expect(issueToTaskFields(mk("indeterminate"), "2026-06-19").status).toBe("In Progress");
    expect(issueToTaskFields(mk("done"), "2026-06-19").status).toBe("Done");
    expect(issueToTaskFields(mk("new"), "2026-06-19").status).toBe("To Do");
  });

  it("defaults unknown/absent category to To Do", () => {
    expect(issueToTaskFields(mk(""), "2026-06-19").status).toBe("To Do");
    expect(issueToTaskFields({ key: "LOP-2", fields: { summary: "x" } } as unknown as JiraIssue, "2026-06-19").status).toBe("To Do");
  });
});
