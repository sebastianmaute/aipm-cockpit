// src/app/alloc-plan/alloc-alternatives.ts
//
// Pure, i18n-free parser for the §769 "Plan with AI" answer: up to three
// ALTERNATIVES, each a one-line summary, task moves and hour cells. The model
// output is UNTRUSTED and only shape-validated here; ids and period keys are
// grounded against the live workspace later.
import { oneLine } from "../rich-text-plain";
import { MAX_ALLOC_CELLS, parseRawCell, toInt, type RawAllocCell } from "./alloc-plan";

/** At most this many alternatives are read; further ones are dropped. */
export const MAX_ALLOC_ALTERNATIVES = 3;
/** Bound on task moves across ALL alternatives together (blast radius + token budget). */
export const MAX_ALLOC_MOVES = 50;
/** Longest summary kept, after collapsing it to one line. */
const MAX_SUMMARY_CHARS = 200;

export interface RawTaskMove {
  taskId: number;
  toResourceId: number;
}

export interface RawAllocAlternative {
  summary: string;
  taskMoves: RawTaskMove[];
  cells: RawAllocCell[];
}

export interface ParsedAllocAlternatives {
  alternatives: RawAllocAlternative[];
  /** True when anything well-formed was dropped at a cap (alternatives, cells or moves). */
  truncated: boolean;
}

function parseMove(raw: unknown): RawTaskMove | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { taskId?: unknown; toResourceId?: unknown };
  const taskId = toInt(m.taskId);
  const toResourceId = toInt(m.toResourceId);
  return taskId === null || toResourceId === null ? null : { taskId, toResourceId };
}

/** Fill `out` from `raw` up to `room` valid items; true when a valid item did not fit. */
function takeValid<T>(raw: unknown, parse: (r: unknown) => T | null, room: number, out: T[]): boolean {
  if (!Array.isArray(raw)) return false;
  for (const r of raw) {
    const item = parse(r);
    if (!item) continue;
    if (out.length >= room) return true;
    out.push(item);
  }
  return false;
}

/** Parse the untrusted tool input. Accepts `alternatives`, or the pre-§769 top-level
 *  `cells` as ONE alternative. Null only when neither is an array; malformed alternatives,
 *  moves and cells are dropped, not fatal. Cells and moves are capped across all
 *  alternatives together (`MAX_ALLOC_CELLS`, `MAX_ALLOC_MOVES`). */
export function parseAllocationAlternatives(input: unknown): ParsedAllocAlternatives | null {
  if (!input || typeof input !== "object") return null;
  const { alternatives, cells } = input as { alternatives?: unknown; cells?: unknown };
  let rawAlts: unknown[];
  if (Array.isArray(alternatives)) rawAlts = alternatives;
  else if (Array.isArray(cells)) rawAlts = [{ cells }];
  else return null;

  const out: RawAllocAlternative[] = [];
  let truncated = false;
  let cellCount = 0;
  let moveCount = 0;
  for (const raw of rawAlts) {
    if (!raw || typeof raw !== "object") continue;
    if (out.length >= MAX_ALLOC_ALTERNATIVES) {
      truncated = true;
      break;
    }
    const a = raw as { summary?: unknown; taskMoves?: unknown; cells?: unknown };
    const taskMoves: RawTaskMove[] = [];
    const altCells: RawAllocCell[] = [];
    if (takeValid(a.taskMoves, parseMove, MAX_ALLOC_MOVES - moveCount, taskMoves)) truncated = true;
    if (takeValid(a.cells, parseRawCell, MAX_ALLOC_CELLS - cellCount, altCells)) truncated = true;
    moveCount += taskMoves.length;
    cellCount += altCells.length;
    const summary = typeof a.summary === "string" ? oneLine(a.summary).slice(0, MAX_SUMMARY_CHARS) : "";
    out.push({ summary, taskMoves, cells: altCells });
  }
  return { alternatives: out, truncated };
}
