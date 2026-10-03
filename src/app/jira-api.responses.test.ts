import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyJiraError, createIssue, formatJiraError, JIRA_MALFORMED_RESPONSE, listProjects,
  searchAllIssues, testConnection,
} from "./jira-api";
import { clearDiagLog, readDiagLog } from "./diagnostics";

// §7 B4 — responses are checked against jira-schemas.ts at the client's one `post()`.
const creds = { siteUrl: "https://x.atlassian.net", email: "a@example.com", apiToken: "t" };

function respond(...bodies: unknown[]) {
  const spy = vi.spyOn(globalThis, "fetch");
  for (const body of bodies) {
    spy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
  }
  return spy;
}

beforeEach(() => clearDiagLog());
afterEach(() => vi.restoreAllMocks());

describe("Jira response validation", () => {
  it("rejects a malformed envelope as a non-network error, logging the path but not the body", async () => {
    respond({ accountId: 7, displayName: "SECRET-BODY" });
    const err = await testConnection(creds).catch((e: unknown) => e);
    expect(classifyJiraError(err)).toBe("other");
    expect(formatJiraError(err)).toBe(JIRA_MALFORMED_RESPONSE);
    const log = JSON.stringify(readDiagLog());
    expect(log).toContain("jira.malformedResponse");
    expect(log).toContain("/api/jira/test");
    expect(log).not.toContain("SECRET-BODY");
  });

  it("keeps the valid projects and logs how many it dropped", async () => {
    respond({ values: [{ id: "1", key: "A", name: "Alpha" }, { id: "2", key: 3, name: "Bad" }] });
    const projects = await listProjects(creds);
    expect(projects.map((p) => p.key)).toEqual(["A"]);
    expect(JSON.stringify(readDiagLog())).toContain("jira.malformedItems");
  });

  it("does not let one malformed issue stop a paged sync", async () => {
    respond(
      { issues: [{ key: "LOP-1", fields: { summary: "ok" } }, { fields: {} }], nextPageToken: "p2", isLast: false },
      { issues: [{ key: "LOP-2", fields: { summary: 99, labels: ["kept"] } }], isLast: true },
    );
    const issues = await searchAllIssues(creds, "project = LOP");
    expect(issues.map((i) => i.key)).toEqual(["LOP-1", "LOP-2"]);
    expect(issues[1].fields?.summary).toBeUndefined();
    expect(issues[0].fields?.summary).toBe("ok");
    expect(issues[1].fields?.labels).toEqual(["kept"]);
  });

  it("rejects a created issue with no key", async () => {
    respond({ id: "10001" });
    await expect(createIssue(creds, "LOP", "Task", {})).rejects.toMatchObject({ payload: { error: JIRA_MALFORMED_RESPONSE } });
  });
});
