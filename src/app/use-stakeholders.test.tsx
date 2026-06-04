import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { useStakeholders } from "./use-stakeholders";
import type { Stakeholder } from "./types";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const mk = (id: number): Stakeholder => ({
  id,
  name: `S${id}`,
  category: "Internal",
  influence: "Medium",
  interest: "Medium",
  raci: {},
});

describe("useStakeholders", () => {
  it("adds, updates, and deletes", () => {
    const { result } = renderHook(
      () => useStakeholders({ today: "2026-06-04" }),
      { wrapper: Wrapper },
    );

    act(() => result.current.handleSaveStakeholder(mk(1)));
    expect(result.current.stakeholders).toHaveLength(1);
    expect(result.current.stakeholders[0].localModifiedAt).toBeTruthy();

    act(() => result.current.handleSaveStakeholder({ ...mk(1), name: "Renamed" }));
    expect(result.current.stakeholders).toHaveLength(1);
    expect(result.current.stakeholders[0].name).toBe("Renamed");

    act(() => result.current.handleDeleteStakeholder(1));
    expect(result.current.stakeholders).toHaveLength(0);
  });
});
