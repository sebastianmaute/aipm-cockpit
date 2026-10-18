import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { useForecastSettings } from "./use-forecast-settings";
import type { ActivityKind } from "./activity-log";
import type { ForecastScenario } from "./forecast-scenarios";
import type { SettingsOverrides } from "./settings-types";

const SCENARIOS: readonly ForecastScenario[] = [{ id: 4, name: "Add two people", changes: [] }];

function setup(initial: SettingsOverrides | undefined = undefined, scenarios = SCENARIOS) {
  const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
  const { result } = renderHook(() => {
    const [settingsOverrides, setSettingsOverrides] = useState<SettingsOverrides | undefined>(initial);
    const api = useForecastSettings({ settingsOverrides, setSettingsOverrides, scenarios, logActivity });
    return { api, settingsOverrides };
  });
  return { result, logActivity };
}

describe("useForecastSettings", () => {
  it("reads the defaults", () => {
    const { result } = setup();
    expect(result.current.api.target).toBe(80);
    expect(result.current.api.proposalId).toBeNull();
  });

  it("setTarget logs once, writes the value, and does not log a no-op", () => {
    const { result, logActivity } = setup();
    act(() => result.current.api.setTarget(95));
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith("forecast.targetChanged", 80, 95);
    expect(result.current.settingsOverrides).toEqual({ forecast: { targetConfidence: 95 } });
    expect(result.current.api.target).toBe(95);
    act(() => result.current.api.setTarget(95));
    expect(logActivity).toHaveBeenCalledTimes(1);
  });

  it("two setTarget calls in one tick log 80 to 95, then 95 to 50", () => {
    const { result, logActivity } = setup();
    act(() => {
      result.current.api.setTarget(95);
      result.current.api.setTarget(50);
    });
    expect(logActivity.mock.calls).toEqual([
      ["forecast.targetChanged", 80, 95],
      ["forecast.targetChanged", 95, 50],
    ]);
    expect(result.current.settingsOverrides).toEqual({ forecast: { targetConfidence: 50 } });
  });

  it("setProposal logs the id and name, and setProposal(null) logs the clear", () => {
    const { result, logActivity } = setup();
    act(() => result.current.api.setProposal(4));
    expect(logActivity).toHaveBeenLastCalledWith("forecast.proposalSet", 4, "Add two people");
    expect(result.current.api.proposalId).toBe(4);
    act(() => result.current.api.setProposal(null));
    expect(logActivity).toHaveBeenLastCalledWith("forecast.proposalCleared", 4, "Add two people");
    expect(result.current.settingsOverrides).toBeUndefined();
  });

  it("setProposal(null) with nothing proposed logs nothing", () => {
    const { result, logActivity } = setup();
    act(() => result.current.api.setProposal(null));
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("a stored proposal naming a deleted scenario reads as none, and clearing it writes and logs nothing", () => {
    const { result, logActivity } = setup({ forecast: { proposalScenarioId: 7 } });
    expect(result.current.api.proposalId).toBeNull();
    act(() => result.current.api.setProposal(null));
    expect(logActivity).not.toHaveBeenCalled();
    expect(result.current.settingsOverrides).toEqual({ forecast: { proposalScenarioId: 7 } });
  });

  it("setProposal for an unknown scenario writes and logs nothing", () => {
    const { result, logActivity } = setup();
    act(() => result.current.api.setProposal(99));
    expect(logActivity).not.toHaveBeenCalled();
    expect(result.current.settingsOverrides).toBeUndefined();
  });
});
