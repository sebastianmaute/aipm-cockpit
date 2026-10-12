// §500 — the Claude route of the forecast import: one forced tool call that reads a
// sheet and returns raw rows. Validation is the caller's job, so the rows come back
// untouched. The request body is read off `fetch`, so this checks what reaches
// Anthropic.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FORECAST_ROWS_TOOL,
  MAX_CLAUDE_IMPORT_CELLS,
  MAX_CLAUDE_IMPORT_CHARS,
  runForecastImportCall,
  sheetToPromptText,
} from "./forecast-import-call";
import { validateForecastRows } from "./budget-import/forecast-validate";
import type { SheetGrid } from "./budget-import/sheet-grid";
import { XLSX_SHEET_TRUNCATED } from "./xlsx-extract";

afterEach(() => vi.restoreAllMocks());

const AI = { apiKey: "sk-ant-secret", model: "claude-x" };
const SHEET: SheetGrid = {
  name: "S",
  rows: [
    ["Name", "2026-01", "2026-02"],
    ["Ada", "12", "8"],
  ],
  truncated: false,
};

function mockResponse(input: unknown, stopReason = "tool_use"): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ stop_reason: stopReason, content: [{ type: "tool_use", name: "propose_forecast_rows", input }] }),
  } as unknown as Response);
}

/** `count` non-blank cells in rows of 100. */
function sheetOfCells(count: number): SheetGrid {
  const rows = Array.from({ length: Math.ceil(count / 100) }, (_, r) =>
    Array.from({ length: Math.min(100, count - r * 100) }, () => "x"),
  );
  return { name: "Cells", rows, truncated: false };
}

type Sent = {
  system?: { type: string; text: string }[] | string;
  tool_choice: { type: string; name: string };
  max_tokens: number;
  messages: { role: string; content: string }[];
  tools: { name: string }[];
};
const sentBody = (spy: ReturnType<typeof vi.spyOn>): Sent =>
  JSON.parse(((spy.mock.calls[0] as unknown[])[1] as RequestInit).body as string) as Sent;

describe("sheetToPromptText", () => {
  it("names the sheet, adds a column-letter header and a row-number column", () => {
    const text = sheetToPromptText(SHEET);
    expect(text.split("\n")[0]).toBe("Sheet: S");
    expect(text).toContain("|  | A | B | C |");
    expect(text).toContain("| 1 | Name | 2026-01 | 2026-02 |");
    expect(text).toContain("| 2 | Ada | 12 | 8 |");
  });

  it("keeps original row numbers across blank rows", () => {
    const text = sheetToPromptText({ name: "S", rows: [["a"], [""], ["c"]], truncated: false });
    expect(text).toContain("| 1 | a |");
    expect(text).not.toContain("| 2 |");
    expect(text).toContain("| 3 | c |");
  });

  it("letters columns past Z as AA, AB", () => {
    const row = Array.from({ length: 28 }, (_, i) => `v${i}`);
    const header = sheetToPromptText({ name: "Wide", rows: [row], truncated: false }).split("\n")[2];
    expect(header).toContain("| Z | AA | AB |");
    expect(header.endsWith("| AB |")).toBe(true);
  });

  it("escapes a pipe in a cell, like the other Markdown path", () => {
    expect(sheetToPromptText({ name: "S", rows: [["a|b"]], truncated: false })).not.toContain("| a|b |");
  });

  it("still says when the grid was truncated", () => {
    expect(sheetToPromptText({ ...SHEET, truncated: true })).toContain(XLSX_SHEET_TRUNCATED);
  });
});

// The prompt is the only place the model learns coordinates, and the validator is
// the only place they are checked, so this ties the two together: a citation read
// OFF THE RENDERED TEXT must pass, and the row above it must not.
describe("prompt coordinates against the validator", () => {
  const GRID: SheetGrid = {
    name: "Plan",
    rows: [
      ["Name", "2026-01", "2026-02"],
      [],
      ["Ada", "12", "8"],
      ["Bob", "5"],
    ],
    truncated: false,
  };
  const cellsOf = (line: string): string[] => line.replace(/^\| /, "").replace(/ \|$/, "").split(" | ");

  /** Row number and column letter of the data cell holding `value`, read from the text. */
  function coordinatesInPrompt(value: string): { rowNumber: number; letter: string } {
    const lines = sheetToPromptText(GRID).split("\n").filter((l) => l.startsWith("|"));
    const header = cellsOf(lines[0]);
    for (const line of lines.slice(2)) {
      const cells = cellsOf(line);
      const at = cells.indexOf(value, 1);
      if (at > 0) return { rowNumber: Number(cells[0]), letter: header[at] };
    }
    throw new Error(`${value} is not in the prompt`);
  }

  const rowCiting = (source: string) => ({ person: "Ada", period: "2026-01", hours: 12, source });

  it("accepts a row citing the coordinates the prompt shows, even after a blank row", () => {
    const { rowNumber, letter } = coordinatesInPrompt("12");
    expect(rowNumber).toBe(3);
    const out = validateForecastRows([rowCiting(`Plan!${letter}${rowNumber}`)], { sheet: GRID, requireSource: true });
    expect(out.rejected).toEqual([]);
    expect(out.ok).toHaveLength(1);
  });

  it("rejects the same row cited one row lower", () => {
    const { rowNumber, letter } = coordinatesInPrompt("12");
    const out = validateForecastRows([rowCiting(`Plan!${letter}${rowNumber - 1}`)], { sheet: GRID, requireSource: true });
    expect(out.ok).toEqual([]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["source"]);
  });
});

describe("FORECAST_ROWS_TOOL", () => {
  it("requires rows and, per row, person, period, hours and source", () => {
    expect(FORECAST_ROWS_TOOL.name).toBe("propose_forecast_rows");
    expect(FORECAST_ROWS_TOOL.input_schema.required).toEqual(["rows"]);
    expect(FORECAST_ROWS_TOOL.input_schema.properties.rows.items.required).toEqual(["person", "period", "hours", "source"]);
  });

  it("tells the model the exact citation format", () => {
    const props = FORECAST_ROWS_TOOL.input_schema.properties.rows.items.properties;
    expect(props.source.description).toContain("uppercase column letter");
    expect(props.source.description).toContain("Sheet1!C7");
    expect(props.person.description).toBe("The person exactly as written in the sheet");
    expect(props.period.description).toBe("The period exactly as written in the sheet's header or period cell");
  });
});

describe("runForecastImportCall", () => {
  it("forces the tool, sends the sheet text and returns the raw rows and notes", async () => {
    const rows = [{ person: "Ada", period: "2026-01", hours: 12, source: "S!B2" }];
    const spy = mockResponse({ rows, notes: "skipped Total" });
    const out = await runForecastImportCall(SHEET, AI);
    const body = sentBody(spy);
    expect(body.tool_choice).toEqual({ type: "tool", name: "propose_forecast_rows" });
    expect(body.max_tokens).toBe(16000);
    expect(body.messages[0].content).toContain("Sheet: S");
    expect(body.messages[0].content).toContain("Ada");
    expect(out).toEqual({ rows, notes: "skipped Total" });
  });

  it("passes rows through untouched, even when malformed, and defaults notes to empty", async () => {
    mockResponse({ rows: "garbage", notes: 5 });
    expect(await runForecastImportCall(SHEET, AI)).toEqual({ rows: "garbage", notes: "" });
  });

  it("sends the fixed system prompt, with guideText as the last block", async () => {
    const spy = mockResponse({ rows: [] });
    await runForecastImportCall(SHEET, { ...AI, guideText: "GUIDE-500" });
    const system = sentBody(spy).system as { type: string; text: string }[];
    expect(system[0].text).toBe(
      "You read a project forecast spreadsheet and return one row per person and period with the hours planned. " +
        "Copy values exactly as written; never compute, total or estimate. " +
        "Every row must cite the cell its hours came from as Sheet!A1. " +
        "Skip totals, subtotals and blank cells. If anything is ambiguous, leave it out and explain in notes.",
    );
    expect(system[system.length - 1].text).toBe("GUIDE-500");
  });

  it("sends the system prompt alone without guideText", async () => {
    const spy = mockResponse({ rows: [] });
    await runForecastImportCall(SHEET, AI);
    expect(typeof sentBody(spy).system).toBe("string");
  });

  it("forwards the abort signal", async () => {
    const spy = mockResponse({ rows: [] });
    const controller = new AbortController();
    await runForecastImportCall(SHEET, AI, controller.signal);
    expect(((spy.mock.calls[0] as unknown[])[1] as RequestInit).signal).toBe(controller.signal);
  });

  it("refuses a sheet over the cell cap before any request", async () => {
    const spy = mockResponse({ rows: [] });
    const row = Array.from({ length: 100 }, () => "x");
    const rows = Array.from({ length: MAX_CLAUDE_IMPORT_CELLS / 100 + 1 }, () => row);
    await expect(runForecastImportCall({ name: "Big", rows, truncated: false }, AI)).rejects.toThrow("too-large");
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a sheet whose prompt text is over the character cap, before any request", async () => {
    const spy = mockResponse({ rows: [] });
    const row = Array.from({ length: 10 }, () => "y".repeat(3000));
    const rows = Array.from({ length: 10 }, () => row); // 100 cells, 300,000 chars
    expect(rows.flat().length).toBeLessThan(MAX_CLAUDE_IMPORT_CELLS);
    await expect(runForecastImportCall({ name: "Wordy", rows, truncated: false }, AI)).rejects.toThrow("too-large");
    expect(spy).not.toHaveBeenCalled();
    expect(MAX_CLAUDE_IMPORT_CHARS).toBe(200_000);
  });

  it("allows exactly the cap, and does not count blank cells or rows", async () => {
    const spy = mockResponse({ rows: [] });
    const row = Array.from({ length: 100 }, () => "x");
    const rows = [
      ...Array.from({ length: MAX_CLAUDE_IMPORT_CELLS / 100 }, () => row),
      ["", " "],
      [],
    ];
    await runForecastImportCall({ name: "Edge", rows, truncated: false }, AI);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("caps a sheet at 4,000 non-blank cells: 4,000 is sent, 4,001 is refused before any request", async () => {
    expect(MAX_CLAUDE_IMPORT_CELLS).toBe(4000);
    const spy = mockResponse({ rows: [] });
    await runForecastImportCall(sheetOfCells(4000), AI);
    expect(spy).toHaveBeenCalledTimes(1);
    await expect(runForecastImportCall(sheetOfCells(4001), AI)).rejects.toThrow("too-large");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("never returns the rows of a reply cut off at the output budget", async () => {
    mockResponse({ rows: [{ person: "Ada", period: "2026-01", hours: 12, source: "S!B2" }] }, "max_tokens");
    await expect(runForecastImportCall(SHEET, AI)).rejects.toThrow("too-large");
  });

  it("never puts the api key in the request body", async () => {
    const spy = mockResponse({ rows: [] });
    await runForecastImportCall(SHEET, AI);
    expect(((spy.mock.calls[0] as unknown[])[1] as RequestInit).body as string).not.toContain("sk-ant-secret");
  });
});
