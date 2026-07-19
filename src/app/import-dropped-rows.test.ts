// src/app/import-dropped-rows.test.ts
//
// Audit #12: malformed CSV/Markdown import rows are dropped silently. The
// decoders now thread an optional ImportDiag accumulator so the import path can
// count rejected rows and warn the user. These tests pin that counting AND the
// byte-stable guarantee that the optional arg never changes a clean decode.

import { describe, it, expect } from "vitest";
import { csvToWorkspace } from "./csv-codecs";
import { markdownToWorkspace } from "./markdown-codecs";

// Header uses the CSV field keys; buildRaidItemFromObj rejects id <= 0.
const CSV_ONE_BAD = [
  "# RAID",
  "id,category,title,status",
  "1,R,Real risk,Open",
  "0,R,Bad row,Open",
].join("\r\n");

const CSV_CLEAN = [
  "# RAID",
  "id,category,title,status",
  "1,R,Real risk,Open",
  "2,R,Second risk,Open",
].join("\r\n");

// A "# AIPM Tasks" heading keeps the raid table out of the task decoder's
// no-heading fallback (markdownToTasks(s.tasksMd || md)).
const MD_ONE_BAD = [
  "# AIPM Tasks",
  "",
  "# RAID Log",
  "",
  "| ID | Category | Title | Status |",
  "| --- | --- | --- | --- |",
  "| 1 | R | Real risk | Open |",
  "| 0 | R | Bad row | Open |",
  "",
].join("\n");

const MD_CLEAN = [
  "# AIPM Tasks",
  "",
  "# RAID Log",
  "",
  "| ID | Category | Title | Status |",
  "| --- | --- | --- | --- |",
  "| 1 | R | Real risk | Open |",
  "| 2 | R | Second risk | Open |",
  "",
].join("\n");

describe("import dropped-row diagnostics (CSV)", () => {
  it("counts a malformed raid row and still loads the valid one", () => {
    const diag = { droppedRows: 0 };
    const ws = csvToWorkspace(CSV_ONE_BAD, diag);
    expect(diag.droppedRows).toBe(1);
    expect(ws.raid.map((r) => r.title)).toEqual(["Real risk"]);
  });

  it("counts a malformed task row (non-numeric id)", () => {
    const csv = [
      "# TASKS",
      "id,taskName,status",
      "1,Good task,To Do",
      "abc,Bad task,To Do",
    ].join("\r\n");
    const diag = { droppedRows: 0 };
    const ws = csvToWorkspace(csv, diag);
    expect(diag.droppedRows).toBe(1);
    expect(ws.tasks.map((t) => t.taskName)).toEqual(["Good task"]);
  });

  it("reports zero dropped rows for a clean file", () => {
    const diag = { droppedRows: 0 };
    const ws = csvToWorkspace(CSV_CLEAN, diag);
    expect(diag.droppedRows).toBe(0);
    expect(ws.raid.length).toBe(2);
  });

  it("is unchanged: decoding with no diag arg matches decoding with one", () => {
    expect(csvToWorkspace(CSV_ONE_BAD, { droppedRows: 0 })).toEqual(csvToWorkspace(CSV_ONE_BAD));
  });
});

describe("import dropped-row diagnostics (Markdown)", () => {
  it("counts a malformed raid row and still loads the valid one", () => {
    const diag = { droppedRows: 0 };
    const ws = markdownToWorkspace(MD_ONE_BAD, diag);
    expect(diag.droppedRows).toBe(1);
    expect(ws.raid.map((r) => r.title)).toEqual(["Real risk"]);
  });

  it("reports zero dropped rows for a clean file", () => {
    const diag = { droppedRows: 0 };
    const ws = markdownToWorkspace(MD_CLEAN, diag);
    expect(diag.droppedRows).toBe(0);
    expect(ws.raid.length).toBe(2);
  });

  it("is unchanged: decoding with no diag arg matches decoding with one", () => {
    expect(markdownToWorkspace(MD_ONE_BAD, { droppedRows: 0 })).toEqual(markdownToWorkspace(MD_ONE_BAD));
  });
});
