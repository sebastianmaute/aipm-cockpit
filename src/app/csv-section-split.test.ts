import { describe, it, expect } from "vitest";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import type { ImportDiag } from "./csv-codecs";
import { emptyWorkspace } from "./workspace";
import type { Task } from "./types";

function mkTask(id: number, over: Partial<Task> = {}): Task {
  return {
    id,
    taskName: `T${id}`,
    assignee: "",
    assigneeEmail: "",
    dueDate: "",
    lastUpdateDate: "",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    createdDate: "2026-01-01",
    ...over,
  };
}

describe("CSV section splitting is quote-aware", () => {
  // ★★★ THE FIXTURE IS FOUR TASKS ON PURPOSE. open-followups §105 carried a
  // ONE-task fixture, which showed only `blockers` truncating and hid the real
  // damage: every row after the hostile cell dies too. A single-task fixture
  // passes against a fix that still misroutes the remaining rows.
  it("keeps every later row when a cell contains a line starting with a marker", () => {
    const tasks = [
      mkTask(1, { blockers: "step one\n# RAID\nstep two" }),
      mkTask(2),
      mkTask(3),
      mkTask(4),
    ];
    const ws = { ...emptyWorkspace(), tasks };
    const back = csvToWorkspace(workspaceToCsv(ws));

    expect(back.tasks.map((t) => t.id)).toEqual([1, 2, 3, 4]);
    // LF→CRLF inside a quoted cell is accepted, pinned codec behaviour.
    expect(back.tasks[0].blockers).toBe("step one\r\n# RAID\r\nstep two");
  });

  it("survives a marker-shaped line in a cell of the LAST section too", () => {
    const tasks = [mkTask(1, { blockers: "a\n# TASKS\nb" }), mkTask(2)];
    const ws = { ...emptyWorkspace(), tasks };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.tasks.map((t) => t.id)).toEqual([1, 2]);
  });
});

describe("unbalanced quoting is reported, not silent", () => {
  it("flags a document that ends inside a quote", () => {
    const diag: ImportDiag = { droppedRows: 0 };
    csvToWorkspace('# TASKS\r\nid,taskName,blockers\r\n1,T1,"never closed', diag);
    expect(diag.unterminatedQuote).toBe(true);
  });

  it("leaves the flag false on a well-formed document", () => {
    const diag: ImportDiag = { droppedRows: 0 };
    csvToWorkspace(workspaceToCsv({ ...emptyWorkspace(), tasks: [mkTask(1)] }), diag);
    expect(diag.unterminatedQuote).toBe(false);
  });
});
