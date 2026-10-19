// src/app/chat-tools-forecast.ts — routing, input handling and the gate for the six forecast tools (§502).
// The dispatcher members are implemented in use-chat-dispatcher.ts; this module owns the guards in front
// of them, like chat-tools-documents.ts.

import type { ForecastReport } from "./forecast-ai-report";
import { parseToolChanges } from "./forecast-scenario-tool-input";
import type { ForecastScenario, ScenarioChange } from "./forecast-scenarios";
import { TARGET_CONFIDENCES, type TargetConfidence } from "./forecast-target";
import { requireToken } from "./chat-tools-updates";
import type { DocumentToolDispatcher } from "./chat-tools-documents";
import { applyOps, type DocOp } from "./document-ops";

export type ForecastScenarioResult = {
  id: number;
  name: string;
  expectedToken: string;
  changes: readonly ScenarioChange[];
};

export type ForecastToolDispatcher = {
  /** Is Monte Carlo forecasting live for this project? ★ The executor must ask, not just the tool list:
   *  `runTool` is reached by NAME, and replayed history carries a template of a succeeded call. */
  isForecastEnabled(): boolean;
  getForecast(whatIf: readonly ScenarioChange[] | null): ForecastReport;
  getForecastScenarioRow(id: number): ForecastScenario | null;
  /** Both throw `Error(<refusal>)` on refusal, as does `getForecast`. */
  createForecastScenario(name: string, changes: readonly ScenarioChange[]): ForecastScenarioResult;
  updateForecastScenario(
    id: number,
    patch: { name?: string; changes?: readonly ScenarioChange[] },
  ): ForecastScenarioResult & { removedRows?: number };
  /** The three decision writes (§502 part 4) throw `Error(<refusal>)` on refusal too. */
  deleteForecastScenario(id: number): { deleted: true; id: number; name: string };
  /** `null` clears. An id naming no saved scenario refuses. */
  setForecastProposal(id: number | null): { proposal: { id: number; name: string } | null };
  setForecastTargetConfidence(value: TargetConfidence): { targetConfidence: TargetConfidence };
};

/** Returned by `runForecastTool` for a name not in `FORECAST_TOOLS`. */
export const NOT_FORECAST_TOOL = Symbol("not-forecast-tool");

// ★ Never "forecasting is off": the Forecast view runs the simulation whatever the switch says (see
//   forecast-ai-prompt.ts), so the refusal sends the user there instead.
export const FORECAST_OFF_MESSAGE =
  'The assistant cannot read or write this project\'s forecast: the project\'s "Use Monte Carlo forecasting" switch is off, or the Forecast view is hidden. While the view is shown it still displays the simulation to the user; point them there, and never estimate forecast dates yourself. Nothing was read or written.';

// ★ A LOCAL literal, not derived from FORECAST_TOOL_DEFS (import-cycle reasoning as chat-tools-documents.ts).
const FORECAST_TOOLS = new Set([
  "get_forecast", "create_forecast_scenario", "update_forecast_scenario",
  "delete_forecast_scenario", "set_forecast_proposal", "set_forecast_target_confidence",
]);

/** The document data-section key that embeds the simulated forecast decision (§502 part 4). */
const DECISION_SECTION = "forecastDecision";

/** Does `node` hold a `dataSection` block naming the forecast decision, at any depth? A `create_document`
 *  carries blocks in `blocks[]`, an `update_document` inside each op's `block` or `blocks[]`; one walk covers
 *  both and any shape added later. */
function namesDecisionSection(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(namesDecisionSection);
  if (node === null || typeof node !== "object") return false;
  const o = node as Record<string, unknown>;
  if (o.type === "dataSection" && o.key === DECISION_SECTION) return true;
  return Object.values(o).some(namesDecisionSection);
}

function countDecisionSections(blocks: readonly unknown[]): number {
  return blocks.filter(namesDecisionSection).length;
}

/** Would this write leave the document holding MORE decision blocks than it holds now? A `create_document`
 *  naming one always adds. An `update_document` is played against the stored blocks with the engine's own
 *  `applyOps`, so every op shape counts the same way it will apply; ops that are not an array of objects, or a
 *  document that is not found, read as adding — the write fails further on anyway. */
function addsDecisionSection(
  name: string,
  input: Record<string, unknown>,
  d: Pick<DocumentToolDispatcher, "getDocument">,
): boolean {
  if (!namesDecisionSection(input)) return false;
  if (name === "create_document") return true;
  const doc = d.getDocument(Number(input.id));
  const ops = input.ops;
  if (!doc || !Array.isArray(ops) || !ops.every((op) => op !== null && typeof op === "object")) return true;
  const after = applyOps(doc.blocks, ops as readonly DocOp[], []);
  return after !== null && countDecisionSections(after) > countDecisionSections(doc.blocks);
}

/** ★ The forecast decision is a data section only while the simulation is active, as in Settings → Export and
 *  the block editor. Offering: `chat-api.ts` sends the document tools without the key while bit 4 is set
 *  (forecast off). Enforcing, here: a document write that would ADD such a block then refuses, so a replayed or
 *  invented call cannot embed a forecast the user cannot see. ★★ Only adding: a block the document already
 *  holds (added while the simulation was on) may be re-sent by a `replaceAll` or `replace`, because refusing
 *  that teaches the model to retry without it, which deletes the user's section through the AI. Throws
 *  `FORECAST_OFF_MESSAGE`; returns quietly otherwise. */
export function refuseHiddenDecisionSection(
  name: string,
  input: Record<string, unknown>,
  d: ForecastToolDispatcher & Pick<DocumentToolDispatcher, "getDocument">,
): void {
  if (name !== "create_document" && name !== "update_document") return;
  if (d.isForecastEnabled()) return;
  if (addsDecisionSection(name, input, d)) throw new Error(FORECAST_OFF_MESSAGE);
}

function requireProposalId(input: Record<string, unknown>): number | null {
  if (input.id === null) return null;
  if (typeof input.id !== "number" || !Number.isFinite(input.id)) throw new Error("id must be a number, or null to clear");
  return input.id;
}

function requireTarget(input: Record<string, unknown>): TargetConfidence {
  const v = input.value;
  if (!(TARGET_CONFIDENCES as readonly unknown[]).includes(v)) {
    throw new Error(`value must be one of ${TARGET_CONFIDENCES.join(", ")}`);
  }
  return v as TargetConfidence;
}

/** The stored row behind `id`, once its token holds; shared by update and delete. */
function requireTokenedRow(input: Record<string, unknown>, d: ForecastToolDispatcher): number {
  const id = requireId(input);
  const row = d.getForecastScenarioRow(id);
  if (!row) throw new Error(`forecast scenario ${id} not found`);
  requireToken("forecastScenario", row, input, `forecast scenario ${id}`);
  return id;
}

function requireChanges(raw: unknown, prefix = ""): ScenarioChange[] {
  const parsed = parseToolChanges(raw);
  if (!parsed.ok) throw new Error(`${prefix}${parsed.error}`);
  return parsed.changes;
}

function requireId(input: Record<string, unknown>): number {
  const id = Number(input.id);
  if (!Number.isFinite(id)) throw new Error("id must be a number");
  return id;
}

export function runForecastTool(
  name: string,
  input: Record<string, unknown>,
  d: ForecastToolDispatcher,
): unknown {
  if (!FORECAST_TOOLS.has(name)) return NOT_FORECAST_TOOL;
  if (!d.isForecastEnabled()) throw new Error(FORECAST_OFF_MESSAGE);

  switch (name) {
    case "get_forecast":
      return d.getForecast(input.whatIf === undefined ? null : requireChanges(input.whatIf, "whatIf "));

    case "create_forecast_scenario": {
      if (typeof input.name !== "string") throw new Error("name must be a string");
      return d.createForecastScenario(input.name, requireChanges(input.changes));
    }

    case "delete_forecast_scenario":
      return d.deleteForecastScenario(requireTokenedRow(input, d));

    case "set_forecast_proposal":
      return d.setForecastProposal(requireProposalId(input));

    case "set_forecast_target_confidence":
      return d.setForecastTargetConfidence(requireTarget(input));

    default: {
      const id = requireTokenedRow(input, d);
      if (input.name === undefined && input.changes === undefined) {
        throw new Error("send name, changes, or both");
      }
      if (input.name !== undefined && typeof input.name !== "string") throw new Error("name must be a string");
      return d.updateForecastScenario(id, {
        ...(input.name !== undefined ? { name: input.name as string } : {}),
        ...(input.changes !== undefined ? { changes: requireChanges(input.changes) } : {}),
      });
    }
  }
}
