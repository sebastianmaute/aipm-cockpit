import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioDraftCompare, type DraftCompareInput } from "./forecast-scenario-draft-compare";
import type { ScheduleContext } from "./forecast-added-people";
import type { ScenarioChange } from "./forecast-scenarios";
import type { ComparedColumn } from "./forecast-scenario-tables";

// The engine and the tables are stubbed: this file pins WHICH inputs a Draft column may be shown against,
// not the figures. The stub column carries the input it was computed from.
vi.mock("./forecast-scenario-compare", () => ({
  computeScenarioColumn: (input: { tag: string }) => ({ computedFrom: input.tag }),
}));
vi.mock("./forecast-scenario-tables", () => ({
  ScenarioComparisonTable: ({ columns }: { columns: ComparedColumn[] }) => (
    <ul>{columns.map((c) => <li key={c.key} data-testid={c.key}>{(c.column as unknown as { computedFrom?: string }).computedFrom ?? "as-is"}</li>)}</ul>
  ),
  ScenarioMilestoneTable: () => null,
}));

const compareOf = (tag: string): DraftCompareInput => ({
  input: { tag, milestones: [], directory: { baseCurrency: "EUR" } } as unknown as DraftCompareInput["input"],
  asIs: {} as DraftCompareInput["asIs"],
});
const CONTEXT = {} as ScheduleContext;
const CHANGES: ScenarioChange[] = [{ kind: "scope", tasks: 2, on: "2026-06-01" } as ScenarioChange];
const view = (compare: DraftCompareInput, changes: readonly ScenarioChange[] | null) => (
  <ScenarioDraftCompare lang="en-US" compare={compare} context={CONTEXT} changes={changes} />
);

describe("ScenarioDraftCompare", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows no Draft column once the As is input changes, until the draft is recomputed from the new input (§502)", () => {
    const first = compareOf("old");
    const { rerender } = render(view(first, CHANGES));
    expect(screen.queryByTestId("draft")).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("draft").textContent).toBe("old");

    rerender(view(compareOf("new"), CHANGES));
    expect(screen.queryByTestId("draft")).toBeNull(); // never the old-input figure beside the new As is

    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("draft").textContent).toBe("new");
  });
});
