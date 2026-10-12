// ONE forced tool call for the forecast import's Claude route (§500): the model
// reads a sheet and returns one row per person and period, each citing the cell
// its hours came from. Mirrors raci-suggest-call.ts: no agentic loop, and the api
// key goes to the shared never-log envelope only. The rows come back RAW — the
// caller validates them with `validateForecastRows(…, { requireSource: true })`,
// which is what makes a hallucinated row fail instead of reaching the plan.
import { columnLetters } from "./budget-import/forecast-rows";
import type { SheetGrid } from "./budget-import/sheet-grid";
import { runForcedToolCallWithStop } from "./ai-forced-call";
import { renderSheetMarkdown } from "./xlsx-extract";

/** The reply's output budget. Each row the model returns costs about 35 output
 *  tokens, so 16,000 holds roughly 450 rows; a reply that reaches it stops with
 *  `stop_reason: "max_tokens"` and its tool input may be cut short, so such a
 *  reply is refused (`Error("too-large")`), never imported in part. */
const MAX_TOKENS = 16_000;

/** Non-blank cells a sheet may hold and still be sent. Bounds the prompt (context
 *  and cost) and, with it, how many rows the reply can owe: a sheet near this cap
 *  can still hold more hours cells than MAX_TOKENS can return, which the
 *  `max_tokens` refusal catches. Over it, `runForecastImportCall` throws
 *  `Error("too-large")` before any request. */
export const MAX_CLAUDE_IMPORT_CELLS = 4000;

/** The rendered prompt text may not pass this many characters either: a few
 *  long cells stay under the cell cap and still make a prompt too large to
 *  answer. Over it, the same `Error("too-large")`, before any request. */
export const MAX_CLAUDE_IMPORT_CHARS = 200_000;

const SYSTEM =
  "You read a project forecast spreadsheet and return one row per person and period with the hours planned. " +
  "Copy values exactly as written; never compute, total or estimate. " +
  "Every row must cite the cell its hours came from as Sheet!A1. " +
  "Skip totals, subtotals and blank cells. If anything is ambiguous, leave it out and explain in notes.";

// The validator accepts only an UPPERCASE A1 cell, so the exact citation format
// rides the schema descriptions rather than the fixed system prompt.
export const FORECAST_ROWS_TOOL = {
  name: "propose_forecast_rows",
  description:
    "Return the planned hours found in the spreadsheet, one row per person and period. " +
    "Copy values exactly as written. Omit anything you are unsure of and say why in notes.",
  input_schema: {
    type: "object" as const,
    properties: {
      rows: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            person: { type: "string" as const, description: "The person exactly as written in the sheet" },
            email: { type: "string" as const, description: "The person's email, only if the sheet shows one" },
            period: {
              type: "string" as const,
              description: "The period exactly as written in the sheet's header or period cell",
            },
            hours: { type: "number" as const, description: "The planned hours, copied from the cell" },
            rate: { type: "number" as const, description: "The hourly rate, only if the sheet shows one" },
            source: {
              type: "string" as const,
              description:
                "The cell the hours came from, as SheetName!A1 with an uppercase column letter, e.g. Sheet1!C7. " +
                "Quote the sheet name in single quotes if it contains spaces: 'My Sheet'!C7.",
            },
          },
          required: ["person", "period", "hours", "source"],
        },
      },
      notes: { type: "string" as const, description: "Anything ambiguous you left out, and why" },
    },
    required: ["rows"],
  },
} as const;

/** The sheet as a Markdown table the model can cite from: a `Sheet: <name>` line,
 *  a header of column letters (A, B, … AA) and a leading row-number column, so a
 *  value in column C of row 7 is `Name!C7`. Blank rows are skipped but keep their
 *  numbers. Rendered by the renderer `extractXlsx` uses, so the cell budget and
 *  the truncation marker are the same. */
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

export async function runForecastImportCall(
  sheet: SheetGrid,
  ai: { apiKey: string; model: string; guideText?: string },
  signal?: AbortSignal,
): Promise<{ rows: unknown; notes: string }> {
  if (countNonBlankCells(sheet) > MAX_CLAUDE_IMPORT_CELLS) throw new Error("too-large");
  const prompt = sheetToPromptText(sheet);
  if (prompt.length > MAX_CLAUDE_IMPORT_CHARS) throw new Error("too-large");
  const { input: raw, stopReason } = await runForcedToolCallWithStop({
    apiKey: ai.apiKey,
    model: ai.model,
    system: SYSTEM,
    guideText: ai.guideText,
    tools: [FORECAST_ROWS_TOOL],
    toolName: FORECAST_ROWS_TOOL.name,
    messages: [{ role: "user", content: prompt }],
    maxTokens: MAX_TOKENS,
    signal,
  });
  if (stopReason === "max_tokens") throw new Error("too-large");
  return { rows: raw.rows, notes: typeof raw.notes === "string" ? raw.notes : "" };
}
