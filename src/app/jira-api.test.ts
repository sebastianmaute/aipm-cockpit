import { describe, it, expect } from "vitest";
import {
  buildJql,
  classifyJiraError,
  diffTaskAgainstIssue,
  issueToTaskFields,
  JiraApiError,
  type JiraIssue,
} from "./jira-api";
import { defaultJiraConfig } from "./settings-types";
import type { Task } from "./types";

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

describe("diffTaskAgainstIssue", () => {
  it("queues the completion row when only the STATUS differs", () => {
    // Neither side carries a date, so the date test alone finds nothing and the
    // remote status move was dropped silently (open-followups §226).
    const local = {
      id: 1, taskName: "t", status: "In Progress", completedDate: undefined,
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { taskName: "t", status: "To Do", completedDate: undefined });
    expect(diffs.map((d) => d.key)).toContain("completedDate");
  });

  it("queues the completion row when only the DATE differs", () => {
    const local = {
      id: 1, taskName: "t", status: "Done", completedDate: "2026-01-01",
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { taskName: "t", status: "Done", completedDate: "2026-02-02" });
    expect(diffs.map((d) => d.key)).toContain("completedDate");
    // ★★ The completion row is hand-built rather than going through `check()`,
    //   so nothing else pins which side each value came from. A swapped pair
    //   ships green against the key assertion alone — and it is user-visible
    //   corruption, since the modal labels each date by side and "keep local"
    //   would then write Jira's date into the task. Distinct dates above make
    //   this discriminating.
    const row = diffs.find((d) => d.key === "completedDate")!;
    expect(row.localValue).toBe("2026-01-01");
    expect(row.remoteValue).toBe("2026-02-02");
  });

  it("queues nothing when both halves of the pair agree", () => {
    const local = {
      id: 1, taskName: "t", status: "In Progress", completedDate: undefined,
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { taskName: "t", status: "In Progress", completedDate: undefined });
    expect(diffs).toHaveLength(0);
  });

  it("does not queue a status difference when the remote patch carries no status", () => {
    // A patch with no `status` says nothing about the remote status; treating
    // `undefined` as a difference would queue a phantom conflict on every sync.
    const local = {
      id: 1, taskName: "t", status: "In Progress", completedDate: undefined,
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { taskName: "t", completedDate: undefined });
    expect(diffs).toHaveLength(0);
  });

  it("does not queue a status difference Jira cannot represent", () => {
    // "On Hold" has no Jira category of its own — jiraCategoryToStatus can
    // only ever produce "To Do" / "In Progress" / "Done". Comparing the two
    // statuses literally therefore reported a difference on EVERY sync for
    // such a row, queueing a conflict that says nothing real and that the
    // user cannot resolve: picking remote overwrites their "On Hold".
    const local = {
      id: 1, taskName: "t", status: "On Hold", completedDate: undefined,
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { taskName: "t", status: "In Progress", completedDate: undefined });
    expect(diffs).toHaveLength(0);
  });

  it("does not queue a status difference for In Review either", () => {
    const local = {
      id: 1, taskName: "t", status: "In Review", completedDate: undefined,
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { taskName: "t", status: "In Progress", completedDate: undefined });
    expect(diffs).toHaveLength(0);
  });

  it("still queues a genuine category change", () => {
    // ★ REGRESSION FENCE for §226 — this is the case the whole change exists
    //   to catch, and it must survive the category comparison. "In Progress"
    //   is `indeterminate`, "To Do" is `new`: different categories, real move.
    const local = {
      id: 1, taskName: "t", status: "In Progress", completedDate: undefined,
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { taskName: "t", status: "To Do", completedDate: undefined });
    expect(diffs.map((d) => d.key)).toContain("completedDate");
  });

  it("queues a cancelled row against an in-flight remote", () => {
    // Cancelled is `done`, remote "In Progress" is `indeterminate` — a real
    // divergence, still surfaced.
    const local = {
      id: 1, taskName: "t", status: "Cancelled", completedDate: undefined,
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { taskName: "t", status: "In Progress", completedDate: undefined });
    expect(diffs.map((d) => d.key)).toContain("completedDate");
  });

  it("queues a cancelled row against a done remote via the DATE half", () => {
    // Cancelled and Done share the `done` category, so the STATUS half is
    // silent here — but Cancelled carries no completedDate while a done issue
    // does, so the pair still differs and the row is still queued. This is why
    // mapping Cancelled to `done` loses nothing.
    const local = {
      id: 1, taskName: "t", status: "Cancelled", completedDate: undefined,
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { taskName: "t", status: "Done", completedDate: "2026-05-09" });
    expect(diffs.map((d) => d.key)).toContain("completedDate");
  });
});
