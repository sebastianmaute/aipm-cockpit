// src/app/use-forecast-tools.ts — the chat dispatcher's forecast members (§502): the simulation predicate,
// `get_forecast`'s report, the full-row getter for the scenario token, the three scenario writers (create, update,
// delete) and the two decision writers (proposal, target confidence).
// `chat-tools-forecast.ts` owns the guards in front of them (gate, input parse, token); this file owns what a
// call is allowed to write, what it logs and what it captures for undo.
//
// ★★★ ONE PREDICATE. `isForecastEnabled` (what the executor SERVES) and use-chat-dispatcher's
// `getSnapshot().forecastSimulation` (what the request OFFERS, via `ToolFlags.forecast`) both call
// `isForecastEnabled` below, which reads `isSimulationActive` from refs at CALL time. A value captured at
// construction would keep serving for the whole session after the user turned the switch off.
//
// ★★ ONE REF for the scenarios slice, and the writers assign it SYNCHRONOUSLY, so a create followed by an
// update (or a `get_forecast`) in the same turn sees the create. `getForecast` reads the scenarios from that
// ref, not from the wiring's render-scope input, for the same reason.
// ★★ The same holds for the TASKS, MILESTONES and RESOURCES a same-turn write can change: the run reads them
// from the dispatcher's refs, which `create_task`, `create_milestone` and `create_resource` assign synchronously,
// so a scenario row can name a milestone or person created earlier in the turn and `get_forecast` simulates a
// task created earlier in it. Everything else in the run (the budget facts included) comes from the getter.
//
// ★ Every write refuses in a read-only popout: a popout owns no undo stack of its own.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { LogActivityAsFn } from "./activity-log-context";
import { entityToken } from "./ai-entity-token";
import type { ForecastScenarioResult, ForecastToolDispatcher } from "./chat-tools-forecast";
import { buildForecastReport, scenarioValidationContext, type ForecastReportInput } from "./forecast-ai-report";
import { computeScenarioComparison, sharedAsIsRun } from "./forecast-scenario-compare";
import { checkToolDraft, checkToolRows } from "./forecast-scenario-tool-input";
import {
  addScenario,
  removeScenario,
  replaceScenario,
  trimScenarioChanges,
  type ForecastScenario,
  type ScenarioChange,
} from "./forecast-scenarios";
import { isSimulationActive } from "./forecast-simulation";
import { proposalIdOf, targetConfidenceOf, withTargetConfidence } from "./forecast-target";
import { t } from "./i18n";
import { mintId } from "./id-mint-session";
import type { Settings, SettingsOverrides } from "./settings-types";
import { proposalLogEntry, withProposalChange } from "./use-forecast-settings";
import type { Milestone, Resource, Task } from "./types";
import { capturePart, type UndoStackApi } from "./undo/use-undo-stack";
import { useWorkspace } from "./workspace-context";

export const HOLIDAYS_LOADING_MESSAGE = "The holiday calendar is still loading; try again in a moment.";

export interface ForecastToolsDeps {
  /** True in a popout/mirror window — every write refuses. */
  isReadOnly: boolean;
  logActivityAs?: LogActivityAsFn;
  /** Owned by use-chat-dispatcher: `features` for the predicate, `language` for the read-only refusal. */
  settingsRef: RefObject<Settings>;
  /** Owned by use-chat-dispatcher; see `RegisterToolsDeps.undoRef` for why a ref. */
  undoRef: RefObject<Pick<UndoStackApi, "captureComposite"> | undefined>;
  /** Owned by use-chat-dispatcher, synced from `ChatDispatcherArgs.getForecastInput`. */
  getForecastInputRef: RefObject<() => ForecastReportInput | null>;
  /** Owned by use-chat-dispatcher and written synchronously by the task, milestone and resource writers;
   *  they replace the getter's render-scope slices at call time. */
  tasksRef: RefObject<readonly Task[]>;
  milestonesRef: RefObject<readonly Milestone[]>;
  resourcesRef: RefObject<readonly Resource[]>;
}

function sameRows(a: readonly ScenarioChange[], b: readonly ScenarioChange[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Stored rows not kept unchanged in `next`, as a multiset: each stored row consumes at most one
 *  `JSON.stringify`-equal new row, so a dropped duplicate counts and an edited row counts as removed. */
function countRemovedRows(stored: readonly ScenarioChange[], next: readonly ScenarioChange[]): number {
  const available = new Map<string, number>();
  for (const c of next) {
    const key = JSON.stringify(c);
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  let removed = 0;
  for (const c of stored) {
    const key = JSON.stringify(c);
    const left = available.get(key) ?? 0;
    if (left === 0) removed += 1;
    else available.set(key, left - 1);
  }
  return removed;
}

function toResult(row: ForecastScenario): ForecastScenarioResult {
  return { id: row.id, name: row.name, expectedToken: entityToken("forecastScenario", row), changes: row.changes };
}

export function useForecastTools(deps: ForecastToolsDeps): ForecastToolDispatcher {
  const { isReadOnly, logActivityAs, settingsRef, undoRef, getForecastInputRef, tasksRef, milestonesRef, resourcesRef } = deps;
  const { forecastScenarios, setForecastScenarios, settingsOverrides, setSettingsOverrides } = useWorkspace();

  const scenariosRef = useRef(forecastScenarios);
  // ★★ The effect below syncs what OTHER writers change; the two decision writes assign it synchronously
  //   (`writeOverrides`), so a `get_forecast` later in the same turn reads the new target and proposal.
  const settingsOverridesRef = useRef(settingsOverrides);
  useEffect(() => {
    scenariosRef.current = forecastScenarios;
  }, [forecastScenarios]);
  useEffect(() => {
    settingsOverridesRef.current = settingsOverrides;
  }, [settingsOverrides]);

  const isForecastEnabled = useCallback(
    () => isSimulationActive(settingsOverridesRef.current, settingsRef.current.features),
    [settingsRef],
  );

  const readOnlyError = useCallback(
    () => new Error(t(settingsRef.current.language, "popoutReadOnly")),
    [settingsRef],
  );

  /** Apply `update` to the overrides: to the ref NOW (see `settingsOverridesRef`), and to the state as a FUNCTIONAL
   *  updater, so a writer that queued a change of its own since the ref last synced (the UI, a version restore) is
   *  built on rather than overwritten by a value computed from the stale ref. ★ No undo capture: target and proposal
   *  are logged, never undoable (owner decision; `useForecastSettings` captures none either). */
  const writeOverrides = useCallback((update: (prev: SettingsOverrides | undefined) => SettingsOverrides | undefined) => {
    settingsOverridesRef.current = update(settingsOverridesRef.current);
    setSettingsOverrides((prev) => update(prev));
  }, [setSettingsOverrides]);

  /** The same for the scenario list: the ref NOW, the state through a functional updater (`writeOverrides`). */
  const writeScenarios = useCallback((update: (prev: readonly ForecastScenario[]) => ForecastScenario[]) => {
    scenariosRef.current = update(scenariosRef.current);
    setForecastScenarios((prev) => update(prev));
  }, [setForecastScenarios]);

  /** The run input with the live tasks, milestones, resources and scenarios, or the loading refusal. */
  const requireInput = useCallback((): ForecastReportInput => {
    const input = getForecastInputRef.current();
    if (input === null) throw new Error(HOLIDAYS_LOADING_MESSAGE);
    const { run } = input;
    return {
      ...input,
      run: {
        ...run,
        tasks: tasksRef.current,
        milestones: milestonesRef.current,
        directory: { ...run.directory, resources: resourcesRef.current },
      },
      scenarios: scenariosRef.current,
      // The same ref the predicate reads, so the report's target and proposal are the ones it was served under.
      settingsOverrides: settingsOverridesRef.current,
    };
  }, [getForecastInputRef, tasksRef, milestonesRef, resourcesRef]);

  return useMemo<ForecastToolDispatcher>(
    () => ({
      isForecastEnabled,

      getForecast: (whatIf, options = {}) => {
        const base = requireInput();
        // The call's own window and unit, if any; the shared app run then no longer matches, so the comparison runs
        // its own As is, and the report omits what is defined only at the defaults (`isDefaultRun`).
        const input: ForecastReportInput = {
          ...base,
          run: { ...base.run, window: options.historyWindow ?? base.run.window, unit: options.unit ?? base.run.unit },
        };
        // ★ ONE As-is run: the report's own comparison supplies the context the what-if check and the lever search
        //   need, and it is the shared app run (`sharedAsIsRun`) when the app memo already holds these inputs.
        const comparison = computeScenarioComparison(input.run, input.scenarios, sharedAsIsRun(input.run));
        // ★ Same rules as a save: a what-if row the save path refuses is never simulated or quoted.
        const refusal = whatIf === null
          ? null
          : checkToolRows(whatIf, scenarioValidationContext(input, comparison.context), []);
        if (refusal !== null) throw new Error(`whatIf ${refusal}`);
        return buildForecastReport(input, whatIf, comparison, { byGroup: options.byGroup === true });
      },

      getForecastScenarioRow: (id) => scenariosRef.current.find((s) => s.id === id) ?? null,

      createForecastScenario: (name, changes) => {
        if (isReadOnly) throw readOnlyError();
        const input = requireInput();
        const list = scenariosRef.current;
        const refusal = checkToolDraft({ name, changes, list, exceptId: null, stored: [], ctx: scenarioValidationContext(input) });
        if (refusal !== null) throw new Error(refusal);
        const id = mintId("forecastScenario", list);
        const row: ForecastScenario = { id, name: name.trim(), changes: trimScenarioChanges(changes) };
        writeScenarios((prev) => addScenario(prev, row));
        // ★ No undo capture: undoing a create by capture duplicates the row (docs/AGENTS/undo.md "Creates").
        logActivityAs?.("ai", "forecastScenario.created", id, row.name);
        return toResult(row);
      },

      updateForecastScenario: (id, patch) => {
        if (isReadOnly) throw readOnlyError();
        // ★ A rename keeps the stored rows: nothing is checked against the forecast, so it needs no input (it
        //   works while holidays load) and pays no As-is run.
        const ctx = patch.changes === undefined ? null : scenarioValidationContext(requireInput());
        const list = scenariosRef.current;
        const stored = list.find((s) => s.id === id);
        if (!stored) throw new Error(`forecast scenario ${id} not found`);
        const name = patch.name ?? stored.name;
        const changes = patch.changes ?? stored.changes;
        const refusal = checkToolDraft({ name, changes, list, exceptId: id, stored: stored.changes, ctx });
        if (refusal !== null) throw new Error(refusal);
        // Keep the stored references for what did not change (as use-forecast-scenarios.ts does), so an
        // update that changes nothing writes, logs and captures nothing.
        const trimmedName = name.trim();
        const rows = trimScenarioChanges(changes);
        // Counted on the TRIMMED rows, the ones stored: a label differing only by spaces is not a removal.
        const removed = patch.changes === undefined ? {} : { removedRows: countRemovedRows(stored.changes, rows) };
        const after: ForecastScenario = {
          ...stored,
          name: trimmedName === stored.name ? stored.name : trimmedName,
          changes: sameRows(stored.changes, rows) ? stored.changes : rows,
        };
        if (after.name === stored.name && after.changes === stored.changes) return { ...toResult(stored), ...removed };
        undoRef.current?.captureComposite({
          kind: "forecastScenario.updated",
          primaryCount: 1,
          parts: [capturePart({
            setter: setForecastScenarios,
            edited: [stored], // STORED row, not `after` — see updateRaid in use-register-tools.ts
            fromArray: list, // pre-op
            isPrimary: true,
          })],
          name: stored.name,
          entityKey: "forecastScenario",
        });
        writeScenarios((prev) => replaceScenario(prev, after));
        logActivityAs?.("ai", "forecastScenario.updated", id, after.name);
        return { ...toResult(after), ...removed };
      },

      // As `deleteScenario` in use-forecast-scenarios.ts: one undoable `forecastScenario.deleted` entry. The stored
      // proposal id is kept, so undoing the delete of the proposed scenario brings the proposal back.
      deleteForecastScenario: (id) => {
        if (isReadOnly) throw readOnlyError();
        const list = scenariosRef.current;
        const doomed = list.find((s) => s.id === id);
        if (!doomed) throw new Error(`forecast scenario ${id} not found`);
        undoRef.current?.captureComposite({
          kind: "forecastScenario.deleted",
          primaryCount: 1,
          // Pre-op array, so the row returns at its own index.
          parts: [capturePart({ setter: setForecastScenarios, removed: [doomed], fromArray: list, isPrimary: true })],
          name: doomed.name,
          entityKey: "forecastScenario",
        });
        writeScenarios((prev) => removeScenario(prev, id));
        logActivityAs?.("ai", "forecastScenario.deleted", id, doomed.name);
        return { deleted: true, id, name: doomed.name };
      },

      // Same store and log rules as `useForecastSettings.setProposal` (`withProposalChange`, `proposalLogEntry`),
      // except that an id naming no saved scenario REFUSES instead of doing nothing.
      setForecastProposal: (id) => {
        if (isReadOnly) throw readOnlyError();
        const list = scenariosRef.current;
        const named = id === null ? null : list.find((s) => s.id === id);
        if (named === undefined) throw new Error(`forecast scenario ${id} not found`);
        const prev = settingsOverridesRef.current;
        const from = proposalIdOf(prev, list);
        // ★ Always queue it (idempotent): a UI change queued since the ref synced must not turn this into a
        //   skipped write that still reports `id`. The ref decides only what is logged.
        writeOverrides((o) => (proposalIdOf(o, list) === id ? o : withProposalChange(o, id, list)));
        const entry = proposalLogEntry(from, id, list);
        if (entry) logActivityAs?.("ai", ...entry);
        return { proposal: named === null ? null : { id: named.id, name: named.name } };
      },

      setForecastTargetConfidence: (value) => {
        if (isReadOnly) throw readOnlyError();
        const prev = settingsOverridesRef.current;
        const from = targetConfidenceOf(prev);
        // ★ Always queued, as `setForecastProposal`; an unchanged target (by the ref) logs nothing.
        writeOverrides((o) => (targetConfidenceOf(o) === value ? o : withTargetConfidence(o, value)));
        if (value !== from) logActivityAs?.("ai", "forecast.targetChanged", from, value);
        return { targetConfidence: value };
      },
    }),
    // Exhaustive: the slices are read through `scenariosRef` and `settingsOverridesRef`; everything else listed is
    // stable in practice (refs, `useCallback`s over refs, and the provider's `useState` setters).
    [isReadOnly, logActivityAs, undoRef, setForecastScenarios, isForecastEnabled, readOnlyError, requireInput, writeOverrides, writeScenarios],
  );
}
