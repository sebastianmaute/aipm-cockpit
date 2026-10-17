"use client";
/** Saved forecast scenarios (§502): create, edit, rename and delete, with the activity log and undo.
 *  Per-entity CRUD hook (AGENTS.md "Extraction conventions" 3): every write is a functional setter. */
import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { resolveEntitySave } from "./entity-id-mint";
import { mintId as mintSessionId } from "./id-mint-session";
import { reportSilentFailure } from "./guard-feedback";
import {
  MAX_FORECAST_SCENARIOS,
  addScenario,
  removeScenario,
  replaceScenario,
  trimScenarioChanges,
  validateScenarioDraft,
  type ForecastScenario,
  type ScenarioChange,
} from "./forecast-scenarios";
import type { Lang } from "./i18n";
import type { UndoStackApi } from "./undo/use-undo-stack";

export type ScenarioDraft = { name: string; changes: readonly ScenarioChange[] };

export type ForecastScenariosApi = {
  scenarios: readonly ForecastScenario[];
  canCreate: boolean;
  /** The id an editor opened for a new scenario starts from: mintId("forecastScenario", scenarios). */
  mintId: () => number;
  /** The id, or null when refused (cap, invalid draft). */
  createScenario: (openId: number, d: ScenarioDraft) => number | null;
  /** False when the row vanished (or the draft is invalid). */
  updateScenario: (id: number, d: ScenarioDraft) => boolean;
  renameScenario: (id: number, name: string) => boolean;
  deleteScenario: (id: number) => void;
};

export type UseForecastScenariosArgs = {
  lang: Lang;
  showToast?: (kind: "info" | "error", text: string) => void;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (kind: ActivityKind, changes: readonly FieldChange[], ...args: (string | number)[]) => void;
  capture?: UndoStackApi["capture"];
};

function sameRows(a: readonly ScenarioChange[], b: readonly ScenarioChange[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `diffFields` skips arrays, so a rows edit would log nothing: append the row COUNTS when the rows differ.
 *  ★ Stored as bare digits, like every other diff value (raw data, no language): the activity panel words them
 *  at render (`activityChangeValues`), so "1 row" agrees in number and an equal count reads "3 rows (edited)".
 *  An equal count can only mean edited rows: the caller keeps the stored reference for an unchanged list. */
export function scenarioFieldChanges(before: ForecastScenario, after: ForecastScenario): FieldChange[] {
  const out = diffFields(before, after);
  if (before.changes !== after.changes) {
    out.push({ field: "changes", from: String(before.changes.length), to: String(after.changes.length) });
  }
  return out;
}

export function useForecastScenarios(args: UseForecastScenariosArgs): ForecastScenariosApi {
  const { forecastScenarios: scenarios, setForecastScenarios } = useWorkspace();
  const { lang, showToast, logActivity, logActivityChanges, capture } = args;

  const mintId = useCallback(() => mintSessionId("forecastScenario", scenarios), [scenarios]);

  // Create decides by INTENT (always a create), never by id-existence: an id the editor minted at open
  // and a concurrent writer took since is re-minted instead of clobbering that row (AGENTS.md "ID-MINT RACE").
  // ★ Never captured for undo: undoing a create by capture duplicates the row (docs/AGENTS/undo.md "Creates").
  const createScenario = useCallback((openId: number, d: ScenarioDraft): number | null => {
    if (validateScenarioDraft(d, scenarios, null) !== null) return null;
    const { id } = resolveEntitySave(scenarios, openId, true, () => mintSessionId("forecastScenario", scenarios));
    const row: ForecastScenario = { id, name: d.name.trim(), changes: trimScenarioChanges(d.changes) };
    setForecastScenarios((prev) => addScenario(prev, row));
    logActivity?.("forecastScenario.created", id, row.name);
    return id;
  }, [scenarios, setForecastScenarios, logActivity]);

  const updateScenario = useCallback((id: number, d: ScenarioDraft): boolean => {
    const before = scenarios.find((s) => s.id === id);
    // A concurrent writer (another tab, the AI) deleted it while the editor was open: the replace
    // below would silently no-op, so say so instead of dropping the edit in silence.
    if (!before) {
      if (showToast) {
        reportSilentFailure(showToast, lang, "forecastScenario.editVanished", "concurrent delete during edit", "guardEditVanished");
      }
      return false;
    }
    if (validateScenarioDraft(d, scenarios, id) !== null) return false;
    const name = d.name.trim();
    const rows = trimScenarioChanges(d.changes);
    // Keep the stored references for what did not change, so the undo field patch (fieldEditsFromRows
    // compares by reference) holds only the edited keys and the log adds no row count for an untouched list.
    const after: ForecastScenario = {
      ...before,
      name: name === before.name ? before.name : name,
      changes: sameRows(before.changes, rows) ? before.changes : rows,
    };
    if (after.name === before.name && after.changes === before.changes) return true;
    setForecastScenarios((prev) => replaceScenario(prev, after));
    capture?.({
      setter: setForecastScenarios, kind: "forecastScenario.updated",
      edited: [before], editedAfter: [after], fromArray: scenarios, name: after.name,
    });
    const changes = scenarioFieldChanges(before, after);
    if (logActivityChanges) logActivityChanges("forecastScenario.updated", changes, id, after.name);
    else logActivity?.("forecastScenario.updated", id, after.name);
    return true;
  }, [scenarios, setForecastScenarios, lang, showToast, capture, logActivity, logActivityChanges]);

  const renameScenario = useCallback((id: number, name: string): boolean => {
    const before = scenarios.find((s) => s.id === id);
    return updateScenario(id, { name, changes: before?.changes ?? [] });
  }, [scenarios, updateScenario]);

  // ★ No allowDestructiveSave: the slice is not counted by the save-time data-loss guards, so an
  //   arm here would stay set and leak to the NEXT save, waving through a delete it never saw.
  const deleteScenario = useCallback((id: number) => {
    const doomed = scenarios.find((s) => s.id === id);
    if (!doomed) return;
    capture?.({ setter: setForecastScenarios, kind: "forecastScenario.deleted", removed: [doomed], fromArray: scenarios, name: doomed.name });
    setForecastScenarios((prev) => removeScenario(prev, id));
    logActivity?.("forecastScenario.deleted", id, doomed.name);
  }, [scenarios, setForecastScenarios, capture, logActivity]);

  return {
    scenarios,
    canCreate: scenarios.length < MAX_FORECAST_SCENARIOS,
    mintId,
    createScenario,
    updateScenario,
    renameScenario,
    deleteScenario,
  };
}
