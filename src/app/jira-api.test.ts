import { describe, it, expect } from "vitest";
import { buildJql, classifyJiraError, issueToTaskFields, JiraApiError, type JiraIssue } from "./jira-api";
import { defaultJiraConfig } from "./settings-types";

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

  // The conflict merge's remote arm (use-jira-sync.ts, the completedDate arm)
  // rests on this coupling: issueToTaskFields reads statusKey ONCE, so a patch
  // can never pair a Done status with no date, or a date with a non-Done
  // status. That was asserted nowhere until this test. The `key` is folded into
  // the compared object so a failure names the category that broke it.
  it("pairs a Done status with a completedDate for every status-category key", () => {
    for (const key of ["new", "indeterminate", "done", "wat", ""]) {
      const p = issueToTaskFields(mk(key), "2026-06-19");
      expect({ key, done: p.status === "Done" }).toEqual({ key, done: !!p.completedDate });
    }
  });
});

describe("buildJql multi-project", () => {
  it("emits `project = \"K\"` for a single project (byte-identical to before)", () => {
    const jql = buildJql({ ...defaultJiraConfig, projectKey: "LOP", assigneeMode: "any", issueTypes: [] });
    expect(jql).toBe('project = "LOP" ORDER BY updated DESC');
  });
  it("emits `project in (...)` for primary + extras", () => {
    const jql = buildJql({
      ...defaultJiraConfig,
      projectKey: "LOP",
      assigneeMode: "any",
      issueTypes: [],
      extraProjects: [
        { key: "OPS", name: "Ops", readOnly: true },
        { key: "DEV", name: "Dev", readOnly: false },
      ],
    });
    expect(jql).toBe('project in ("LOP", "OPS", "DEV") ORDER BY updated DESC');
  });
  it("returns null when no project is set", () => {
    expect(buildJql({ ...defaultJiraConfig, projectKey: "" })).toBeNull();
  });
});
