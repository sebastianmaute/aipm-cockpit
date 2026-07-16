// Round-trip guards for the two new persisted fields:
//   RaidItem.inquiriesSent  (mirrors Task.inquiriesSent)
//   Task.noteLog            (structured JSON-in-cell array)
// Both must survive the CSV and Markdown backends (CSV also drives Turso
// single + tenant via *_CSV_COLUMNS).
import { describe, it, expect } from "vitest";
import {
  emptyWorkspace,
  workspaceToCsv,
  csvToWorkspace,
  workspaceToMarkdown,
  markdownToWorkspace,
} from "./storage";
import type { Workspace } from "./workspace";

const seedRaid = (): Workspace => ({
  ...emptyWorkspace(),
  raid: [{
    id: 1, category: "R", title: "Vendor risk", status: "Open", linkedTaskIds: [],
    causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01", targetDate: "2026-03-01",
    inquiriesSent: 3,
  }],
});

const seedTaskNote = (): Workspace => ({
  ...emptyWorkspace(),
  tasks: [{
    id: 1, taskName: "Chase vendor", assignee: "Alex", assigneeEmail: "alex@example.com",
    dueDate: "2026-02-01", lastUpdateDate: "2026-01-10", priority: "Medium", status: "To Do",
    blockers: "", notes: "",
    noteLog: [
      { authorResourceId: 7, authorName: "Ann", timestamp: "2026-07-16T10:00:00.000Z", text: "Left a voicemail" },
      { authorName: "Bob", timestamp: "2026-07-17T09:30:00.000Z", text: "Emailed follow-up" },
    ],
  }],
});

describe("RaidItem.inquiriesSent persistence", () => {
  it("survives the CSV round-trip", () => {
    const back = csvToWorkspace(workspaceToCsv(seedRaid()));
    expect(back.raid[0]?.inquiriesSent).toBe(3);
  });
  it("survives the Markdown round-trip", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(seedRaid()));
    expect(back.raid[0]?.inquiriesSent).toBe(3);
  });
  it("a legacy RAID item without inquiriesSent stays undefined (sparse)", () => {
    const ws: Workspace = {
      ...emptyWorkspace(),
      raid: [{
        id: 2, category: "I", title: "Issue", status: "Open", linkedTaskIds: [],
        causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
      }],
    };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.raid[0]?.inquiriesSent).toBeUndefined();
  });
});

describe("Task.noteLog persistence", () => {
  it("survives the CSV round-trip", () => {
    const back = csvToWorkspace(workspaceToCsv(seedTaskNote()));
    expect(back.tasks[0]?.noteLog).toEqual(seedTaskNote().tasks[0].noteLog);
  });
  it("survives the Markdown round-trip", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(seedTaskNote()));
    expect(back.tasks[0]?.noteLog).toEqual(seedTaskNote().tasks[0].noteLog);
  });
  it("survives comma + double-quote + pipe in text/authorName (JSON-in-cell edge)", () => {
    const ws: Workspace = {
      ...emptyWorkspace(),
      tasks: [{
        id: 9, taskName: "Edge", assignee: "A", assigneeEmail: "a@x.com",
        dueDate: "2026-02-01", lastUpdateDate: "2026-01-10", priority: "Medium", status: "To Do",
        blockers: "", notes: "",
        noteLog: [{
          authorName: 'Zoe "Z", Ng | Lee',
          timestamp: "2026-07-16T10:00:00.000Z",
          text: 'Called re: "vendor A, B | C" — no answer',
        }],
      }],
    };
    const csvBack = csvToWorkspace(workspaceToCsv(ws));
    expect(csvBack.tasks[0]?.noteLog).toEqual(ws.tasks[0].noteLog);
    const mdBack = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(mdBack.tasks[0]?.noteLog).toEqual(ws.tasks[0].noteLog);
  });

  it("a legacy task without noteLog stays undefined (sparse)", () => {
    const ws: Workspace = {
      ...emptyWorkspace(),
      tasks: [{
        id: 3, taskName: "Plain", assignee: "", assigneeEmail: "",
        dueDate: "2026-02-01", lastUpdateDate: "2026-01-10", priority: "Medium", status: "To Do",
        blockers: "", notes: "",
      }],
    };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.tasks[0]?.noteLog).toBeUndefined();
  });
});
