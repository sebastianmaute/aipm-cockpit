import { describe, expect, it } from "vitest";
import { jiraIssueSchema, jiraProjectSchema, parseJiraList } from "./jira-schemas";

// §7 B4 — the envelope is strict, an issue's fields are lenient.
describe("jiraIssueSchema", () => {
  it("keeps a well-formed issue as it is", () => {
    const issue = {
      key: "LOP-1",
      fields: {
        summary: "Fix login", duedate: "2026-10-10", updated: null, resolutiondate: null,
        labels: ["a", "b"], assignee: { displayName: "Ada", emailAddress: "ada@example.com", accountId: "x1" },
        priority: { name: "High" }, status: { statusCategory: { key: "done" }, name: "Done" },
        issuetype: { name: "Task" }, description: { type: "doc", content: [] },
      },
    };
    expect(jiraIssueSchema.parse(issue)).toEqual(issue);
  });

  it("turns a wrong-typed field into undefined instead of rejecting the issue", () => {
    const r = jiraIssueSchema.parse({
      key: "LOP-2",
      fields: { summary: 42, priority: "High", duedate: 7, status: { name: "Open" } },
    });
    expect(r.key).toBe("LOP-2");
    // Anti-vacuity: the sibling survives, so the bad ones were dropped one by one,
    // not with the whole `fields` object.
    expect(r.fields?.status?.name).toBe("Open");
    expect(r.fields?.summary).toBeUndefined();
    expect(r.fields?.priority).toBeUndefined();
    expect(r.fields?.duedate).toBeUndefined();
  });

  it("keeps the string labels and drops the rest", () => {
    const r = jiraIssueSchema.parse({ key: "LOP-3", fields: { labels: ["ok", 5, null, "also"] } });
    expect(r.fields?.labels).toEqual(["ok", "also"]);
  });

  it("keeps the fields of an issue that has no description", () => {
    const r = jiraIssueSchema.parse({ key: "LOP-4", fields: { summary: "No description" } });
    expect(r.fields?.summary).toBe("No description");
  });

  it("rejects an issue with no usable key", () => {
    expect(jiraIssueSchema.safeParse({ fields: {} }).success).toBe(false);
    expect(jiraIssueSchema.safeParse({ key: "" }).success).toBe(false);
    expect(jiraIssueSchema.safeParse({ key: 12 }).success).toBe(false);
  });
});

describe("parseJiraList", () => {
  it("keeps the valid items and counts the dropped ones", () => {
    const r = parseJiraList(jiraProjectSchema, [
      { id: "1", key: "A", name: "Alpha" },
      { id: 2, key: "B", name: "Beta" },
      null,
      { id: "3", key: "C", name: "Gamma" },
    ]);
    expect(r.items.map((p) => p.key)).toEqual(["A", "C"]);
    expect(r.dropped).toBe(2);
  });
});
