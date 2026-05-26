import { describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetPanel } from "./budget-panel";
import type { BudgetBucket, Role, ResourcePlan } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];

// Stateful harness: the panel's inputs are CONTROLLED, so the test must hold
// the bucket state and re-render on change — exactly how the app wires it.
// `onChangeSpy` records each emitted array while still driving the re-render.
function Harness({
  initial,
  onChangeSpy,
}: {
  initial: BudgetBucket[];
  onChangeSpy: (next: BudgetBucket[]) => void;
}) {
  const [buckets, setBuckets] = useState<BudgetBucket[]>(initial);
  return (
    <BudgetPanel
      lang="en-US"
      buckets={buckets}
      roles={roles}
      disciplines={[{ id: 1, name: "Consulting" }]}
      grades={[{ id: 1, name: "Senior" }]}
      resources={[]}
      plan={plan}
      fxRates={null}
      absences={[]}
      holidaySet={new Set<string>()}
      workdayHours={8}
      today="2026-02-01"
      onChangeBuckets={(next) => {
        onChangeSpy(next);
        setBuckets(next);
      }}
      onRefreshFx={vi.fn()}
    />
  );
}

describe("BudgetPanel editing", () => {
  test("Add bucket emits a new open bucket", async () => {
    const spy = vi.fn();
    render(<Harness initial={[]} onChangeSpy={spy} />);
    await userEvent.click(screen.getByRole("button", { name: /Add bucket/i }));
    expect(spy).toHaveBeenCalledTimes(1);
    const next = spy.mock.calls[0][0] as BudgetBucket[];
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe("open");
  });

  test("editing an actual-hours cell emits the updated bucket", () => {
    const spy = vi.fn();
    const initial: BudgetBucket[] = [{
      id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
    }];
    render(<Harness initial={initial} onChangeSpy={spy} />);
    const cell = screen.getByLabelText("actual-1-3-2026-01") as HTMLInputElement;
    // Controlled input starts at the prop value.
    expect(cell.value).toBe("80");
    fireEvent.change(cell, { target: { value: "90" } });
    const last = spy.mock.calls.at(-1)![0] as BudgetBucket[];
    expect(last[0].allocations[0].actualHours["2026-01"]).toBe(90);
    // Re-render reflects the new controlled value.
    expect((screen.getByLabelText("actual-1-3-2026-01") as HTMLInputElement).value).toBe("90");
  });

  test("Close bucket toggles status to closed", async () => {
    const spy = vi.fn();
    const initial: BudgetBucket[] = [{
      id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: {}, actualHours: {} }],
    }];
    render(<Harness initial={initial} onChangeSpy={spy} />);
    await userEvent.click(screen.getByRole("button", { name: /Close bucket/i }));
    const last = spy.mock.calls.at(-1)![0] as BudgetBucket[];
    expect(last[0].status).toBe("closed");
    expect(last[0].closedDate).toBe("2026-02-01");
  });
});
