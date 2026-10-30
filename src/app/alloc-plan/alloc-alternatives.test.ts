import { describe, it, expect } from "vitest";
import {
  MAX_ALLOC_ALTERNATIVES,
  MAX_ALLOC_MOVES,
  parseAllocationAlternatives,
} from "./alloc-alternatives";
import { MAX_ALLOC_CELLS, PROPOSE_ALLOCATIONS_TOOL } from "./alloc-plan";

const cell = (i = 0) => ({ resourceId: 1, periodKey: `2026-${String((i % 12) + 1).padStart(2, "0")}`, hours: 8 });
const move = (i = 0) => ({ taskId: i + 1, toResourceId: 2 });
const alt = (summary: string, nMoves: number, nCells: number) => ({
  summary,
  taskMoves: Array.from({ length: nMoves }, (_, i) => move(i)),
  cells: Array.from({ length: nCells }, (_, i) => cell(i)),
});

describe("parseAllocationAlternatives", () => {
  it("reads up to three alternatives with summary, moves and cells", () => {
    const r = parseAllocationAlternatives({
      alternatives: [alt("A", 1, 1), alt("B", 2, 0), alt("C", 0, 2), alt("D", 1, 1)],
    });
    expect(MAX_ALLOC_ALTERNATIVES).toBe(3);
    expect(r?.alternatives.map((a) => a.summary)).toEqual(["A", "B", "C"]);
    expect(r?.alternatives[0]).toEqual({
      summary: "A",
      taskMoves: [{ taskId: 1, toResourceId: 2 }],
      cells: [cell(0)],
    });
    expect(r?.truncated).toBe(true);
  });

  it("is not truncated when within every cap", () => {
    expect(parseAllocationAlternatives({ alternatives: [alt("A", 1, 1)] })?.truncated).toBe(false);
  });

  it("accepts the old top-level cells answer as one alternative", () => {
    const r = parseAllocationAlternatives({ cells: [cell(0)] });
    expect(r).toEqual({ alternatives: [{ summary: "", taskMoves: [], cells: [cell(0)] }], truncated: false });
  });

  it("caps cells and moves across all alternatives", () => {
    const cells = parseAllocationAlternatives({
      alternatives: [alt("A", 0, 100), alt("B", 0, 100), alt("C", 0, 100)],
    });
    expect(cells?.alternatives.reduce((n, a) => n + a.cells.length, 0)).toBe(MAX_ALLOC_CELLS);
    expect(cells?.truncated).toBe(true);
    const moves = parseAllocationAlternatives({
      alternatives: [alt("A", 30, 0), alt("B", 30, 0), alt("C", 30, 0)],
    });
    expect(MAX_ALLOC_MOVES).toBe(50);
    expect(moves?.alternatives.reduce((n, a) => n + a.taskMoves.length, 0)).toBe(MAX_ALLOC_MOVES);
    expect(moves?.truncated).toBe(true);
  });

  it("drops malformed moves and cells, keeps the rest", () => {
    const r = parseAllocationAlternatives({
      alternatives: [
        {
          summary: "A",
          taskMoves: [null, { taskId: "x", toResourceId: 2 }, { taskId: 1.5, toResourceId: 2 }, { taskId: 3 }, move(4)],
          cells: [null, { resourceId: 1, periodKey: " ", hours: 3 }, { resourceId: 1, periodKey: "2026-01", hours: NaN }, cell(0)],
        },
        "nonsense",
      ],
    });
    expect(r?.alternatives).toHaveLength(1);
    expect(r?.alternatives[0].taskMoves).toEqual([{ taskId: 5, toResourceId: 2 }]);
    expect(r?.alternatives[0].cells).toEqual([cell(0)]);
    expect(r?.truncated).toBe(false);
  });

  it("summary is one line and at most 200 characters", () => {
    const r = parseAllocationAlternatives({
      alternatives: [{ summary: `first\nsecond ${"x".repeat(300)}`, taskMoves: [], cells: [] }],
    });
    const s = r?.alternatives[0].summary ?? "";
    expect(s).not.toMatch(/[\n\r]/);
    expect(s.startsWith("first second")).toBe(true);
    expect(s.length).toBe(200);
  });

  it("treats a missing or non-string summary as empty", () => {
    const r = parseAllocationAlternatives({ alternatives: [{ summary: 5, cells: [cell(0)] }] });
    expect(r?.alternatives[0]).toEqual({ summary: "", taskMoves: [], cells: [cell(0)] });
  });

  it("returns null when neither alternatives nor cells is an array", () => {
    expect(parseAllocationAlternatives(null)).toBeNull();
    expect(parseAllocationAlternatives("x")).toBeNull();
    expect(parseAllocationAlternatives({})).toBeNull();
    expect(parseAllocationAlternatives({ alternatives: "no", cells: 3 })).toBeNull();
  });
});

describe("PROPOSE_ALLOCATIONS_TOOL schema", () => {
  it("requires alternatives, each with summary, taskMoves and cells", () => {
    const s = PROPOSE_ALLOCATIONS_TOOL.input_schema as unknown as {
      required: string[];
      properties: { alternatives: { items: { required: string[] } } };
    };
    expect(s.required).toEqual(["alternatives"]);
    expect(s.properties.alternatives.items.required).toEqual(["summary", "taskMoves", "cells"]);
  });
});
