import { describe, it, expect } from "vitest";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import type { ImportDiag } from "./csv-codecs";
import { emptyWorkspace } from "./workspace";
import type { RaidItem, Task } from "./types";

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

function mkRaid(id: number, over: Partial<RaidItem> = {}): RaidItem {
  return {
    id,
    category: "R",
    title: `R${id}`,
    status: "Open",
    severity: "High",
    stakeholderIds: [],
    linkedTaskIds: [],
    causedByRaidIds: [],
    raisedDate: "2026-01-01",
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

  // ★★★ THIS CASE IS THE ONE WHERE IDS PROVE NOTHING, AND ASSERTING THEM ALONE
  // IS WHAT THIS TEST USED TO DO. The embedded marker names the section that is
  // ALREADY active, so a naive `csv.split(/\r?\n/)` switches `mode` to itself:
  // no row is misrouted, no row is dropped, every id survives — and the cell has
  // silently lost its `# TASKS` line, which IS the §105 loss. Measured against a
  // mutant restoring the pre-fix split: ids `[1,2]` (green) while `blockers` came
  // back as `"a\r\nb"` instead of `"a\r\n# TASKS\r\nb"`. Only the CONTENT
  // assertion can fail here — never weaken this back to an id check.
  //
  // ★ The title used to say "in a cell of the LAST section", which this fixture
  // is not: TASKS is emitted FIRST (`csv-codecs-config.ts`, the `csvPush` order)
  // and is the only section a tasks-only workspace has. Renamed to what it
  // tests. The genuinely-last-section shape — a marker naming an EARLIER section
  // from inside the tail one — is covered by the sibling below.
  it("keeps the cell intact when the embedded marker names the ACTIVE section", () => {
    const tasks = [mkTask(1, { blockers: "a\n# TASKS\nb" }), mkTask(2)];
    const ws = { ...emptyWorkspace(), tasks };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.tasks.map((t) => t.id)).toEqual([1, 2]);
    expect(back.tasks[0].blockers).toBe("a\r\n# TASKS\r\nb");
  });

  // ★★★ A GENUINE LAST-SECTION CASE — the marker sits in a cell of the section
  // emitted LAST and names an EARLIER one. `csvPush` order (csv-codecs-config.ts
  // `workspaceToCsv`) puts TASKS first and RAID second, so with only these two
  // slices populated RAID is the tail: there is no later marker for a naive
  // splitter to re-sync on, and every raid row after the hostile cell is
  // re-routed into the TASKS section instead. Unlike the same-section case
  // above, the ids DO move here — assert both, since a fix that keeps the rows
  // while eating the marker line would pass on ids alone.
  it("survives a marker-shaped line in a cell of the LAST section too", () => {
    const raid = [
      mkRaid(1, { description: "x\n# TASKS\ny" }),
      mkRaid(2, { title: "Second risk" }),
    ];
    const ws = { ...emptyWorkspace(), tasks: [mkTask(1)], raid };
    const back = csvToWorkspace(workspaceToCsv(ws));

    expect(back.raid.map((r) => r.id)).toEqual([1, 2]);
    expect(back.tasks.map((t) => t.id)).toEqual([1]);
    expect(back.raid[0].description).toBe("x\r\n# TASKS\r\ny");
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
