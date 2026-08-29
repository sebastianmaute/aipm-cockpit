// src/app/import-dropped-rows.test.ts
//
// Audit #12: malformed CSV/Markdown import rows are dropped silently. The
// decoders now thread an optional ImportDiag accumulator so the import path can
// count rejected rows and warn the user. These tests pin that counting AND the
// byte-stable guarantee that the optional arg never changes a clean decode.

import { describe, it, expect } from "vitest";
import { type ImportDiag, csvToWorkspace } from "./csv-codecs";
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

// ── per-section attribution (§152, second half) ──────────────────────────────
// ★★★ THE FLAT COUNT CANNOT ANSWER THE QUESTION THE USER ASKS. `onOpenStorageFile`
// applies tasks + RAID and DISCARDS every other slice, so "3 rows were dropped"
// leaves the user unable to tell whether the loss landed on what they just
// imported or on a section this path throws away — different losses, different
// remedies. `droppedBySection` names it; `droppedRows` stays the derived total so
// existing readers do not churn.
// ★★ BOTH ARE WRITTEN BY ONE HELPER (`countDroppedRow`), so they structurally
// cannot disagree. Assert the total ALONGSIDE the map in every test here — a
// second increment path that updates only one of them is otherwise invisible.
describe("import dropped-row attribution (CSV)", () => {
  it("attributes one drop to each section and keeps the flat total", () => {
    const csv = [
      "# TASKS",
      "id,taskName,status",
      "1,Good task,To Do",
      "abc,Bad task,To Do",
      "# RAID",
      "id,category,title,status",
      "1,R,Real risk,Open",
      "0,R,Bad row,Open",
    ].join("\r\n");
    const diag: ImportDiag = { droppedRows: 0 };
    const ws = csvToWorkspace(csv, diag);
    expect(diag.droppedBySection).toEqual({ tasks: 1, raid: 1 });
    expect(diag.droppedRows).toBe(2);
    expect(ws.tasks.map((t) => t.taskName)).toEqual(["Good task"]);
    expect(ws.raid.map((r) => r.title)).toEqual(["Real risk"]);
  });

  it("names a section decoded through the SHARED collectRows path", () => {
    // ★ `collectRows` and `decodeCsvSection` are two different generic
    //   collectors; a fix threading the key through only one of them passes the
    //   test above (tasks has its own loop, raid goes through decodeCsvSection)
    //   and fails here. Resources is a `collectRows` consumer.
    const csv = ["# RESOURCES", "id,name", "1,Real", ",Nameless"].join("\r\n");
    const diag: ImportDiag = { droppedRows: 0 };
    csvToWorkspace(csv, diag);
    expect(diag.droppedBySection).toEqual({ resources: 1 });
    expect(diag.droppedRows).toBe(1);
  });

  it("leaves the map absent for a clean file rather than filling it with zeros", () => {
    // ★ A map of zeros reads as "every section was inspected and lost nothing",
    //   which is more than the decoder knows: sections absent from the file are
    //   never decoded at all. Absent means absent.
    const diag: ImportDiag = { droppedRows: 0 };
    csvToWorkspace(CSV_CLEAN, diag);
    expect(diag.droppedBySection).toBeUndefined();
    expect(diag.droppedRows).toBe(0);
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

// ★★★ THE MARKDOWN FAMILY IS THE HALF A CSV-ONLY GREP MISSES, and §152 records
// that this entry's own first revision missed it. `onOpenStorageFile` reaches
// Markdown as readily as CSV (`local-file-backend.ts` branches on
// `this.format`), so attribution shipped for one family only would be a
// half-fix that reads as a whole one.
describe("import dropped-row attribution (Markdown)", () => {
  it("attributes one drop to each section and keeps the flat total", () => {
    const md = [
      "# AIPM Tasks",
      "",
      "| ID | Task |",
      "| --- | --- |",
      "| 1 | Good task |",
      "| abc | Bad task |",
      "",
      "# RAID Log",
      "",
      "| ID | Category | Title | Status |",
      "| --- | --- | --- | --- |",
      "| 1 | R | Real risk | Open |",
      "| 0 | R | Bad row | Open |",
      "",
    ].join("\n");
    const diag: ImportDiag = { droppedRows: 0 };
    const ws = markdownToWorkspace(md, diag);
    expect(diag.droppedBySection).toEqual({ tasks: 1, raid: 1 });
    expect(diag.droppedRows).toBe(2);
    expect(ws.tasks.map((t) => t.taskName)).toEqual(["Good task"]);
    expect(ws.raid.map((r) => r.title)).toEqual(["Real risk"]);
  });

  it("names a section decoded through the SHARED markdownToRefs wrapper", () => {
    // ★ `markdownToRefs` is one function serving TWO sections (disciplines and
    //   grades), so it cannot hardcode a key — it has to take one from each
    //   caller. A fix that hardcodes passes every other test here.
    const md = [
      "# AIPM Tasks",
      "",
      "# Grades",
      "",
      "| ID | Name |",
      "| --- | --- |",
      "| 1 | Senior |",
      "| 0 | Bad |",
      "",
    ].join("\n");
    const diag: ImportDiag = { droppedRows: 0 };
    markdownToWorkspace(md, diag);
    expect(diag.droppedBySection).toEqual({ grades: 1 });
    expect(diag.droppedRows).toBe(1);
  });

  it("leaves the map absent for a clean file", () => {
    const diag: ImportDiag = { droppedRows: 0 };
    markdownToWorkspace(MD_CLEAN, diag);
    expect(diag.droppedBySection).toBeUndefined();
    expect(diag.droppedRows).toBe(0);
  });
});
