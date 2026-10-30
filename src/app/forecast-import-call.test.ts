// §500 — the Claude route of the forecast import: one forced tool call that reads a
// sheet and returns a COLUMN MAPPING, never values. The mapping is converted
// (`claudeMappingOf`) and refused when it cannot be used; the hand reader imports
// with it. The request body is read off `fetch`, so this checks what reaches
// Anthropic.
import "../test/ai-consent-live";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FORECAST_MAPPING_TOOL,
  MAX_CLAUDE_IMPORT_CELLS,
  MAX_CLAUDE_IMPORT_CHARS,
  runForecastImportCall,
  sheetToPromptText,
} from "./forecast-import-call";
import { claudeMappingOf } from "./budget-import/claude-mapping";
import type { SheetGrid } from "./budget-import/sheet-grid";
import { XLSX_SHEET_TRUNCATED } from "./xlsx-extract";
import { aiPrivacyFor } from "./ai-privacy";

/** These tests are about the call mechanics, not people: a request for no project (unprotected). */
const UNPROTECTED = aiPrivacyFor([]);

afterEach(() => vi.restoreAllMocks());

const AI = { apiKey: "sk-ant-secret", privacy: UNPROTECTED, model: "claude-x" };
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
    json: async () => ({ stop_reason: stopReason, content: [{ type: "tool_use", name: "propose_forecast_mapping", input }] }),
  } as unknown as Response);
}

const MAPPING = { layout: "wide", headerRow: 1, person: "A", periodCols: ["B", "C"] };

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

// The prompt is the only place the model learns coordinates, and the converter is
// the only place they are read back, so this ties the two together: a mapping read
// OFF THE RENDERED TEXT names the right columns and row, after a blank row too.
describe("prompt coordinates against the converter", () => {
  const GRID: SheetGrid = {
    name: "Plan",
    rows: [
      ["Titel"],
      [],
      ["Name", "2026-01", "2026-02"],
      ["Ada", "12", "8"],
    ],
    truncated: false,
  };
  const cellsOf = (line: string): string[] => line.replace(/^\| /, "").replace(/ \|$/, "").split(" | ");

  /** Row number and column letter of the cell holding `value`, read from the text. */
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

  it("reads a mapping given in the prompt's letters and row numbers as the grid's own columns and row", () => {
    const name = coordinatesInPrompt("Name");
    const jan = coordinatesInPrompt("2026-01");
    const feb = coordinatesInPrompt("2026-02");
    expect(name).toEqual({ rowNumber: 3, letter: "A" });
    const raw = { layout: "wide", headerRow: name.rowNumber, person: name.letter, periodCols: [jan.letter, feb.letter] };
    expect(claudeMappingOf(raw, GRID)).toEqual({ mapping: { layout: "wide", headerRow: 2, person: 0, periodCols: [1, 2] } });
    expect(GRID.rows[2][0]).toBe("Name");
  });
});

describe("FORECAST_MAPPING_TOOL", () => {
  it("asks for where the fields are: the layout, the header row and the person column", () => {
    expect(FORECAST_MAPPING_TOOL.name).toBe("propose_forecast_mapping");
    expect(FORECAST_MAPPING_TOOL.input_schema.required).toEqual(["layout", "headerRow", "person"]);
    expect(FORECAST_MAPPING_TOOL.input_schema.properties.layout.enum).toEqual(["wide", "long"]);
    expect(Object.keys(FORECAST_MAPPING_TOOL.input_schema.properties).sort()).toEqual(
      ["email", "headerRow", "hours", "layout", "notes", "period", "periodCols", "person", "rate", "year", "yearCol"],
    );
  });

  it("speaks the prompt's language: column letters and 1-based row numbers, never values", () => {
    const props = FORECAST_MAPPING_TOOL.input_schema.properties;
    expect(props.person.description).toContain("column letter");
    expect(props.headerRow.description).toContain("row number");
    expect(props.periodCols.items.type).toBe("string");
    expect(props.hours.description).toContain("never actuals");
    expect(JSON.stringify(FORECAST_MAPPING_TOOL)).not.toMatch(/"source"|"rows"/);
  });
});

describe("runForecastImportCall", () => {
  it("forces the mapping tool, sends the sheet text and returns the converted mapping and notes", async () => {
    const spy = mockResponse({ ...MAPPING, notes: "Plan block only" });
    const out = await runForecastImportCall(SHEET, AI);
    const body = sentBody(spy);
    expect(body.tool_choice).toEqual({ type: "tool", name: "propose_forecast_mapping" });
    expect(body.tools.map((t) => t.name)).toEqual(["propose_forecast_mapping"]);
    expect(body.max_tokens).toBe(2000);
    expect(body.messages[0].content).toContain("Sheet: S");
    expect(body.messages[0].content).toContain("Ada");
    expect(out).toEqual({ mapping: { layout: "wide", headerRow: 0, person: 0, periodCols: [1, 2] }, notes: "Plan block only" });
  });

  it("defaults notes to empty", async () => {
    mockResponse({ ...MAPPING, notes: 5 });
    expect((await runForecastImportCall(SHEET, AI)).notes).toBe("");
  });

  it("refuses a mapping it cannot use as bad-mapping, never repaired", async () => {
    for (const input of [{ ...MAPPING, periodCols: ["B", "D"] }, { ...MAPPING, headerRow: 3 }, { rows: [] }, "garbage"]) {
      mockResponse(input);
      await expect(runForecastImportCall(SHEET, AI)).rejects.toThrow("bad-mapping");
    }
  });

  it("sends the fixed system prompt, with guideText as the last block", async () => {
    const spy = mockResponse(MAPPING);
    await runForecastImportCall(SHEET, { ...AI, guideText: "GUIDE-500" });
    const system = sentBody(spy).system as { type: string; text: string }[];
    expect(system[0].text).toBe(
      "You read a project forecast spreadsheet and say where its fields are; you never return values. " +
        "Name the columns by their letters and the header row by its row number, as the sheet below shows them. " +
        "Choose the planned or forecast hours, never actuals (Ist, booked, gebucht, logged). " +
        "If the sheet holds several tables or blocks, map the forecast one and say so in notes. " +
        "Explain your choice, and anything you are unsure of, in notes.",
    );
    expect(system[system.length - 1].text).toBe("GUIDE-500");
  });

  it("sends the system prompt alone without guideText", async () => {
    const spy = mockResponse(MAPPING);
    await runForecastImportCall(SHEET, AI);
    expect(typeof sentBody(spy).system).toBe("string");
  });

  it("forwards the abort signal", async () => {
    const spy = mockResponse(MAPPING);
    const controller = new AbortController();
    await runForecastImportCall(SHEET, AI, controller.signal);
    expect(((spy.mock.calls[0] as unknown[])[1] as RequestInit).signal).toBe(controller.signal);
  });

  it("refuses a sheet over the cell cap before any request", async () => {
    const spy = mockResponse(MAPPING);
    const row = Array.from({ length: 100 }, () => "x");
    const rows = Array.from({ length: MAX_CLAUDE_IMPORT_CELLS / 100 + 1 }, () => row);
    await expect(runForecastImportCall({ name: "Big", rows, truncated: false }, AI)).rejects.toThrow("too-large");
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a sheet whose prompt text is over the character cap, before any request", async () => {
    const spy = mockResponse(MAPPING);
    const row = Array.from({ length: 10 }, () => "y".repeat(3000));
    const rows = Array.from({ length: 10 }, () => row); // 100 cells, 300,000 chars
    expect(rows.flat().length).toBeLessThan(MAX_CLAUDE_IMPORT_CELLS);
    await expect(runForecastImportCall({ name: "Wordy", rows, truncated: false }, AI)).rejects.toThrow("too-large");
    expect(spy).not.toHaveBeenCalled();
    expect(MAX_CLAUDE_IMPORT_CHARS).toBe(200_000);
  });

  it("allows exactly the cap, and does not count blank cells or rows", async () => {
    const spy = mockResponse(MAPPING);
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
    const spy = mockResponse(MAPPING);
    await runForecastImportCall(sheetOfCells(4000), AI);
    expect(spy).toHaveBeenCalledTimes(1);
    await expect(runForecastImportCall(sheetOfCells(4001), AI)).rejects.toThrow("too-large");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("never returns the mapping of a reply cut off at the output budget", async () => {
    mockResponse(MAPPING, "max_tokens");
    await expect(runForecastImportCall(SHEET, AI)).rejects.toThrow("too-large");
  });

  it("never puts the api key in the request body", async () => {
    const spy = mockResponse(MAPPING);
    await runForecastImportCall(SHEET, AI);
    expect(((spy.mock.calls[0] as unknown[])[1] as RequestInit).body as string).not.toContain("sk-ant-secret");
  });
});
