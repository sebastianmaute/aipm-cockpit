import { test, expect, vi } from "vitest";
import type React from "react";
import { renderHook, act } from "@testing-library/react";
import { useStakeholders } from "./use-stakeholders";
import type { Stakeholder } from "./types";

vi.mock("./workspace-context", () => {
  let state: readonly Stakeholder[] = [];
  const setStakeholders = (u: React.SetStateAction<readonly Stakeholder[]>) => {
    state = typeof u === "function" ? (u as (p: readonly Stakeholder[]) => readonly Stakeholder[])(state) : u;
  };
  return {
    useWorkspace: () => ({ stakeholders: state, setStakeholders }),
    __seed: (rows: readonly Stakeholder[]) => { state = rows; },
  };
});

test("editing a stakeholder field pushes a captureFieldEdit", async () => {
  const mod = (await import("./workspace-context")) as unknown as { __seed: (r: readonly Stakeholder[]) => void };
  const existing = { id: 1, name: "S", influence: "High" } as Stakeholder;
  mod.__seed([existing]);
  const captureFieldEdit = vi.fn();
  const { result } = renderHook(() => useStakeholders({ today: "2026-01-01", captureFieldEdit }));
  act(() => result.current.handleSaveStakeholder({ ...existing, influence: "Low" } as Stakeholder, false));
  expect(captureFieldEdit).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "stakeholder.updated", id: 1, before: { influence: "High" }, after: { influence: "Low" } }),
  );
});
