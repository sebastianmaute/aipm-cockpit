"use client";
/** The project's target confidence and proposed scenario (§502 part 4): reads them off the
 *  per-project overrides and writes them back, logging each real change.
 *  ★ Never captures undo (owner decision): the activity log is the record. */
import { useCallback, useEffect, useRef } from "react";
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
  // The latest stored values, for the no-op check and the logged "from": two calls in one tick (no render between)
  // would otherwise both read the render closure and log a stale "from". Written by the setters themselves and
  // re-synced after every render (never during one).
  const latest = useRef({ target, proposalId });
  useEffect(() => {
    latest.current = { target, proposalId };
  }, [target, proposalId]);
  // Deleting the proposed scenario (UI or AI) logs no `forecast.proposalCleared` ON PURPOSE: the stored id is kept,
  // so undo or a version restore that brings the scenario back brings the proposal with it.

  const setTarget = useCallback((v: TargetConfidence) => {
    const from = latest.current.target;
    if (v === from) return;
    latest.current = { ...latest.current, target: v };
    setSettingsOverrides((prev) => withTargetConfidence(prev, v));
    logActivity?.("forecast.targetChanged", from, v);
  }, [setSettingsOverrides, logActivity]);

  const setProposal = useCallback((id: number | null) => {
    const from = latest.current.proposalId;
    if (id === from) return;
    // Setting needs a live scenario to name; clearing names the one being cleared.
    const named = scenarios.find((s) => s.id === (id ?? from));
    if (id !== null && !named) return;
    latest.current = { ...latest.current, proposalId: id };
    setSettingsOverrides((prev) => withProposal(prev, id));
    if (!named) return;
    if (id !== null) logActivity?.("forecast.proposalSet", id, named.name);
    else logActivity?.("forecast.proposalCleared", named.id, named.name);
  }, [scenarios, setSettingsOverrides, logActivity]);

  return { target, proposalId, setTarget, setProposal };
}
