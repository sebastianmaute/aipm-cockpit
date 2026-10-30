// ONE forced tool call for the forecast import's Claude route (§500): the model
// reads a sheet and says WHERE its fields are — a column mapping in the prompt's
// column letters and row numbers — never a value. Mirrors raci-suggest-call.ts:
// no agentic loop, and the api key goes to the shared never-log envelope only.
// ★★ The mapping is converted by `claudeMappingOf` and refused (`bad-mapping`)
// when it cannot be used; the hand route's reader then imports with it, through
// every question and refusal it has, and only after the user confirms it.
import { PRIVACY_NOT_YET_THREADED } from "./ai-privacy";
import { claudeMappingOf } from "./budget-import/claude-mapping";
import { columnLetters } from "./budget-import/forecast-rows";
import type { ColumnMapping } from "./budget-import/forecast-types";
import type { SheetGrid } from "./budget-import/sheet-grid";
import { runForcedToolCallWithStop } from "./ai-forced-call";
import { renderSheetMarkdown } from "./xlsx-extract";

/** The reply's output budget: a mapping is a handful of letters and a note, so
 *  2,000 tokens is ample. A reply that reaches it stops with `stop_reason:
 *  "max_tokens"` and its tool input may be cut short, so such a reply is
 *  refused (`Error("too-large")`), never used in part. */
const MAX_TOKENS = 2_000;

/** Non-blank cells a sheet may hold and still be sent. Bounds the prompt
 *  (context and cost). Over it, `runForecastImportCall` throws
 *  `Error("too-large")` before any request. */
export const MAX_CLAUDE_IMPORT_CELLS = 4000;

/** The rendered prompt text may not pass this many characters either: a few
 *  long cells stay under the cell cap and still make a prompt too large to
 *  answer. Over it, the same `Error("too-large")`, before any request. */
export const MAX_CLAUDE_IMPORT_CHARS = 200_000;

const SYSTEM =
  "You read a project forecast spreadsheet and say where its fields are; you never return values. " +
  "Name the columns by their letters and the header row by its row number, as the sheet below shows them. " +
  "Choose the planned or forecast hours, never actuals (Ist, booked, gebucht, logged). " +
  "If the sheet holds several tables or blocks, map the forecast one and say so in notes. " +
  "Explain your choice, and anything you are unsure of, in notes.";

const letter = (description: string) => ({ type: "string" as const, description: `${description}, as its column letter (A, B, … AA)` });

export const FORECAST_MAPPING_TOOL = {
  name: "propose_forecast_mapping",
  description:
    "Say where the forecast's fields are in the spreadsheet: its layout, header row and columns. " +
    "Return column letters and row numbers only, never values.",
  input_schema: {
    type: "object" as const,
    properties: {
      layout: {
        type: "string" as const,
        enum: ["wide", "long"],
        description: "wide: one column per period, one row per person. long: one row per person and period",
      },
      headerRow: { type: "integer" as const, description: "The header row, as its row number in the sheet (1 is the first row)" },
      person: letter("The column naming the person"),
      email: letter("The column holding the person's email, only if there is one"),
      rate: letter("The column holding the hourly rate, only if there is one"),
      periodCols: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "wide only: the column letters of the planned-hours period columns, never actuals",
      },
      period: letter("long only: the column naming the period"),
      hours: letter("long only: the column of planned or forecast hours, never actuals"),
      yearCol: letter("long only: a column holding each row's year, only if there is one"),
      year: { type: "integer" as const, description: "The year for period labels written without one (Jan, KW03)" },
      notes: { type: "string" as const, description: "Why you chose these columns, and anything you are unsure of" },
    },
    required: ["layout", "headerRow", "person"],
  },
} as const;

/** The sheet as a Markdown table the model can name fields in: a `Sheet: <name>`
 *  line, a header of column letters (A, B, … AA) and a leading row-number
 *  column, so a header in row 7 is row 7 and its third column is C. Blank rows
 *  are skipped but keep their numbers. Rendered by the renderer `extractXlsx`
 *  uses, so the cell budget and the truncation marker are the same. */
export function sheetToPromptText(sheet: SheetGrid): string {
  const width = sheet.rows.reduce((max, r) => Math.max(max, r.length), 0);
  const header = ["", ...Array.from({ length: width }, (_, col) => columnLetters(col))];
  const numbered = sheet.rows.flatMap((row, i) =>
    row.some((c) => c.trim() !== "") ? [[String(i + 1), ...row]] : [],
  );
  return `Sheet: ${sheet.name}\n\n${renderSheetMarkdown([header, ...numbered], sheet.truncated)}`;
}

function countNonBlankCells(sheet: SheetGrid): number {
  return sheet.rows.reduce((sum, row) => sum + row.filter((c) => c.trim() !== "").length, 0);
}

/** Claude's column mapping for `sheet`, converted to the hand route's
 *  `ColumnMapping`, and its notes. Throws `Error("too-large")` over the caps
 *  (before any request) or for a reply cut off at the output budget, and
 *  `Error("bad-mapping")` when the mapping cannot be used (`claudeMappingOf`). */
export async function runForecastImportCall(
  sheet: SheetGrid,
  ai: { apiKey: string; model: string; guideText?: string },
  signal?: AbortSignal,
): Promise<{ mapping: ColumnMapping; notes: string }> {
  if (countNonBlankCells(sheet) > MAX_CLAUDE_IMPORT_CELLS) throw new Error("too-large");
  const prompt = sheetToPromptText(sheet);
  if (prompt.length > MAX_CLAUDE_IMPORT_CHARS) throw new Error("too-large");
  const { input: raw, stopReason } = await runForcedToolCallWithStop({
    apiKey: ai.apiKey,
    privacy: PRIVACY_NOT_YET_THREADED,
    model: ai.model,
    system: SYSTEM,
    guideText: ai.guideText,
    tools: [FORECAST_MAPPING_TOOL],
    toolName: FORECAST_MAPPING_TOOL.name,
    messages: [{ role: "user", content: prompt }],
    maxTokens: MAX_TOKENS,
    signal,
  });
  if (stopReason === "max_tokens") throw new Error("too-large");
  const converted = claudeMappingOf(raw, sheet);
  if ("refused" in converted) throw new Error("bad-mapping");
  return { mapping: converted.mapping, notes: typeof raw.notes === "string" ? raw.notes : "" };
}
