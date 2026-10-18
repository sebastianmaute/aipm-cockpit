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
    return { api, settingsOverrides, setSettingsOverrides };
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

  it("an external write that returns to the rendered value in the same tick does not leave a stale no-op", async () => {
    const { result, logActivity } = setup();
    await act(async () => {
      result.current.api.setTarget(95);
      result.current.setSettingsOverrides(undefined); // e.g. an undo landing in the same tick
    });
    expect(result.current.api.target).toBe(80);
    act(() => result.current.api.setTarget(95));
    expect(result.current.settingsOverrides).toEqual({ forecast: { targetConfidence: 95 } });
    expect(logActivity).toHaveBeenLastCalledWith("forecast.targetChanged", 80, 95);
  });

  it("an AI batch with an await between calls writes the last one: set 95 then 80 stores no override", async () => {
    const { result } = setup();
    await act(async () => {
      result.current.api.setTarget(95);
      await Promise.resolve();
      result.current.api.setTarget(80);
    });
    expect(result.current.settingsOverrides).toBeUndefined();
  });

  it("the same for the proposal: set 4 then null stores no proposal", async () => {
    const { result } = setup();
    await act(async () => {
      result.current.api.setProposal(4);
      await Promise.resolve();
      result.current.api.setProposal(null);
    });
    expect(result.current.settingsOverrides).toBeUndefined();
  });

  it("a setProposal captured before the scenario list grew accepts and logs the new scenario", () => {
    const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
    const { result, rerender } = renderHook(({ scenarios }: { scenarios: readonly ForecastScenario[] }) => {
      const [settingsOverrides, setSettingsOverrides] = useState<SettingsOverrides | undefined>(undefined);
      const api = useForecastSettings({ settingsOverrides, setSettingsOverrides, scenarios, logActivity });
      return { api, settingsOverrides };
    }, { initialProps: { scenarios: SCENARIOS } });
    const captured = result.current.api.setProposal;
    rerender({ scenarios: [...SCENARIOS, { id: 9, name: "Late arrival", changes: [] }] });
    act(() => captured(9));
    expect(result.current.settingsOverrides).toEqual({ forecast: { proposalScenarioId: 9 } });
    expect(logActivity).toHaveBeenLastCalledWith("forecast.proposalSet", 9, "Late arrival");
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
