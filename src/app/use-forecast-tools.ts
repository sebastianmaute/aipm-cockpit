// src/app/use-forecast-tools.ts — the chat dispatcher's forecast members (§502): the simulation predicate,
// `get_forecast`'s report, the full-row getter for the scenario token, and the two scenario writers.
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
//
// ★ Every write refuses in a read-only popout: a popout owns no undo stack of its own.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { LogActivityAsFn } from "./activity-log-context";
import { entityToken } from "./ai-entity-token";
import type { ForecastScenarioResult, ForecastToolDispatcher } from "./chat-tools-forecast";
import { buildForecastReport, scenarioValidationContext, type ForecastReportInput } from "./forecast-ai-report";
import { checkToolDraft } from "./forecast-scenario-tool-input";
import {
  addScenario,
  replaceScenario,
  trimScenarioChanges,
  type ForecastScenario,
  type ScenarioChange,
} from "./forecast-scenarios";
import { isSimulationActive } from "./forecast-simulation";
import { t } from "./i18n";
import { mintId } from "./id-mint-session";
import type { Settings } from "./settings-types";
import { capturePart, type UndoStackApi } from "./undo/use-undo-stack";
import { useWorkspace } from "./workspace-context";

export const HOLIDAYS_LOADING_MESSAGE = "The holiday calendar is still loading; try again in a moment.";

export interface ForecastToolsDeps {
  /** True in a popout/mirror window — both writes refuse. */
  isReadOnly: boolean;
  logActivityAs?: LogActivityAsFn;
  /** Owned by use-chat-dispatcher: `features` for the predicate, `language` for the read-only refusal. */
  settingsRef: RefObject<Settings>;
  /** Owned by use-chat-dispatcher; see `RegisterToolsDeps.undoRef` for why a ref. */
  undoRef: RefObject<Pick<UndoStackApi, "captureComposite"> | undefined>;
  /** Owned by use-chat-dispatcher, synced from `ChatDispatcherArgs.getForecastInput`. */
  getForecastInputRef: RefObject<() => ForecastReportInput | null>;
}

function sameRows(a: readonly ScenarioChange[], b: readonly ScenarioChange[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Stored rows with no `JSON.stringify`-equal row in `next`: what a replace drops. */
function countRemovedRows(stored: readonly ScenarioChange[], next: readonly ScenarioChange[]): number {
  const kept = new Set(next.map((c) => JSON.stringify(c)));
  return stored.filter((c) => !kept.has(JSON.stringify(c))).length;
}

function toResult(row: ForecastScenario): ForecastScenarioResult {
  return { id: row.id, name: row.name, expectedToken: entityToken("forecastScenario", row), changes: row.changes };
}

export function useForecastTools(deps: ForecastToolsDeps): ForecastToolDispatcher {
  const { isReadOnly, logActivityAs, settingsRef, undoRef, getForecastInputRef } = deps;
  const { forecastScenarios, setForecastScenarios, settingsOverrides } = useWorkspace();

  const scenariosRef = useRef(forecastScenarios);
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

  /** The run input with the live scenarios, or the loading refusal. */
  const requireInput = useCallback((): ForecastReportInput => {
    const input = getForecastInputRef.current();
    if (input === null) throw new Error(HOLIDAYS_LOADING_MESSAGE);
    return { ...input, scenarios: scenariosRef.current };
  }, [getForecastInputRef]);

  return useMemo<ForecastToolDispatcher>(
    () => ({
      isForecastEnabled,

      getForecast: (whatIf) => buildForecastReport(requireInput(), whatIf),

      getForecastScenarioRow: (id) => scenariosRef.current.find((s) => s.id === id) ?? null,

      createForecastScenario: (name, changes) => {
        if (isReadOnly) throw readOnlyError();
        const input = requireInput();
        const list = scenariosRef.current;
        const refusal = checkToolDraft({ name, changes, list, exceptId: null, stored: [], ctx: scenarioValidationContext(input) });
        if (refusal !== null) throw new Error(refusal);
        const id = mintId("forecastScenario", list);
        const row: ForecastScenario = { id, name: name.trim(), changes: trimScenarioChanges(changes) };
        const next = addScenario(list, row);
        scenariosRef.current = next;
        setForecastScenarios(next);
        // ★ No undo capture: undoing a create by capture duplicates the row (docs/AGENTS/undo.md "Creates").
        logActivityAs?.("ai", "forecastScenario.created", id, row.name);
        return toResult(row);
      },

      updateForecastScenario: (id, patch) => {
        if (isReadOnly) throw readOnlyError();
        const input = requireInput();
        const list = scenariosRef.current;
        const stored = list.find((s) => s.id === id);
        if (!stored) throw new Error(`forecast scenario ${id} not found`);
        const name = patch.name ?? stored.name;
        const changes = patch.changes ?? stored.changes;
        const refusal = checkToolDraft({
          name, changes, list, exceptId: id, stored: stored.changes, ctx: scenarioValidationContext(input),
        });
        if (refusal !== null) throw new Error(refusal);
        const removed = patch.changes === undefined ? {} : { removedRows: countRemovedRows(stored.changes, changes) };
        // Keep the stored references for what did not change (as use-forecast-scenarios.ts does), so an
        // update that changes nothing writes, logs and captures nothing.
        const trimmedName = name.trim();
        const rows = trimScenarioChanges(changes);
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
        const next = replaceScenario(list, after);
        scenariosRef.current = next;
        setForecastScenarios(next);
        logActivityAs?.("ai", "forecastScenario.updated", id, after.name);
        return { ...toResult(after), ...removed };
      },
    }),
    // Exhaustive: the slice is read through `scenariosRef`; everything else listed is stable in practice
    // (refs, `useCallback`s over refs, and the provider's `useState` setter).
    [isReadOnly, logActivityAs, undoRef, setForecastScenarios, isForecastEnabled, readOnlyError, requireInput],
  );
}
