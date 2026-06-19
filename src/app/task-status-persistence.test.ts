import { describe, expect, it } from "vitest";
import { csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import { jsonToWorkspace } from "./workspace";

describe("status persistence", () => {
  it("round-trips status through CSV", () => {
    const ws = csvToWorkspace(
      workspaceToCsv(
        jsonToWorkspace(JSON.stringify({
          tasks: [{ id: 1, taskName: "T", assignee: "", assigneeEmail: "",
            dueDate: "2026-06-01", lastUpdateDate: "2026-05-01", priority: "Medium",
            blockers: "", notes: "", status: "In Review" }],
          raid: [],
        })),
      ),
    );
    expect(ws.tasks[0].status).toBe("In Review");
  });

  it("migrates a legacy task (no status, completedDate set) to Done on JSON load", () => {
    const ws = jsonToWorkspace(JSON.stringify({
      tasks: [{ id: 1, taskName: "T", assignee: "", assigneeEmail: "",
        dueDate: "2026-06-01", lastUpdateDate: "2026-05-01", priority: "Medium",
        blockers: "", notes: "", completedDate: "2026-01-01" }],
      raid: [],
    }));
    expect(ws.tasks[0].status).toBe("Done");
  });

  it("migrates a legacy open task (no status, no completedDate) to To Do", () => {
    const ws = jsonToWorkspace(JSON.stringify({
      tasks: [{ id: 1, taskName: "T", assignee: "", assigneeEmail: "",
        dueDate: "2026-06-01", lastUpdateDate: "2026-05-01", priority: "Medium",
        blockers: "", notes: "" }],
      raid: [],
    }));
    expect(ws.tasks[0].status).toBe("To Do");
  });
});
