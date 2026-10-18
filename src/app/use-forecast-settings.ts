"use client";
/** The project's target confidence and proposed scenario (§502 part 4): reads them off the
 *  per-project overrides and writes them back, logging each real change.
 *  ★ Never captures undo (owner decision): the activity log is the record. */
import { useCallback, useLayoutEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ActivityKind } from "./activity-log";
import type { ForecastScenario } from "./forecast-scenarios";
import {
  proposalIdOf,
  targetConfidenceOf,
  withProposal,
  withTargetConfidence,
  type TargetConfidence,
} from "./forecast-target";
import type { SettingsOverrides } from "./settings-types";

export type UseForecastSettingsArgs = {
  settingsOverrides: SettingsOverrides | undefined;
  setSettingsOverrides: Dispatch<SetStateAction<SettingsOverrides | undefined>>;
  scenarios: readonly ForecastScenario[];
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
};

export type ForecastSettingsApi = {
  target: TargetConfidence;
  proposalId: number | null;
  setTarget: (v: TargetConfidence) => void;
  setProposal: (id: number | null) => void;
};

export function useForecastSettings(args: UseForecastSettingsArgs): ForecastSettingsApi {
  const { settingsOverrides, setSettingsOverrides, scenarios, logActivity } = args;
  const target = targetConfidenceOf(settingsOverrides);
  const proposalId = proposalIdOf(settingsOverrides, scenarios);
  // ★ The `latest` ref decides only whether to LOG, never whether to WRITE. `setTarget` always queues its
  // (idempotent) functional updater, and so does `setProposal` once its scenario check passes (naming a scenario
  // that is not in the list is refused outright), so a stale ref can cost at most a log line, never a lost write
  // (the AI path awaits between calls, possibly with no render in between). The ref is the latest value any call
  // here set: it keeps two calls in one tick from both logging a stale "from". Both refs are re-synced in a layout
  // effect after every commit (never during a render); `scenariosRef` lets a setter held across an await see the
  // current scenario list rather than the one it was created with.
  const latest = useRef({ target, proposalId });
  const scenariosRef = useRef(scenarios);
  useLayoutEffect(() => {
    latest.current = { target, proposalId };
    scenariosRef.current = scenarios;
  });
  // Deleting the proposed scenario (UI or AI) logs no `forecast.proposalCleared` ON PURPOSE: the stored id is kept,
  // so undo or a version restore that brings the scenario back brings the proposal with it.

  const setTarget = useCallback((v: TargetConfidence) => {
    const from = latest.current.target;
    latest.current = { ...latest.current, target: v };
    setSettingsOverrides((prev) => withTargetConfidence(prev, v));
    if (v !== from) logActivity?.("forecast.targetChanged", from, v);
  }, [setSettingsOverrides, logActivity]);

  const setProposal = useCallback((id: number | null) => {
    const from = latest.current.proposalId;
    const list = scenariosRef.current;
    // Setting needs a live scenario to name (a refusal about the scenario list, not about the ref).
    if (id !== null && !list.some((s) => s.id === id)) return;
    latest.current = { ...latest.current, proposalId: id };
    // Clearing when the STORED value already reads as no proposal leaves a kept stale id alone (undo can bring it back).
    setSettingsOverrides((prev) => (id === null && proposalIdOf(prev, list) === null ? prev : withProposal(prev, id)));
    if (id === from) return;
    // Clearing names the one being cleared.
    const named = list.find((s) => s.id === (id ?? from));
    if (!named) return;
    if (id !== null) logActivity?.("forecast.proposalSet", id, named.name);
    else logActivity?.("forecast.proposalCleared", named.id, named.name);
  }, [setSettingsOverrides, logActivity]);

  return { target, proposalId, setTarget, setProposal };
}
