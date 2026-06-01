import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BudgetBucketModal } from "./budget-bucket-modal";
import type { BudgetBucket, Role } from "./types";

const roles: Role[] = [
  { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
  { id: 4, disciplineId: 1, gradeId: 2, internalRate: 120, externalRate: 180 },
];

const disciplines = [
  { id: 1, name: "Consulting" },
  { id: 2, name: "Development" },
];

const baseBucket: BudgetBucket = {
  id: 1,
  name: "PAM",
  type: "tm",
  currency: "EUR",
  startDate: "2026-01-01",
  endDate: "2026-06-30",
  status: "open",
  allocations: [],
};

function setup(
  over: Partial<React.ComponentProps<typeof BudgetBucketModal>> = {},
) {
  const onSave = vi.fn();
  render(
    <BudgetBucketModal
      lang="en-US"
      bucket={baseBucket}
      allBuckets={[baseBucket]}
      roles={roles}
      disciplines={[]}
      grades={[]}
      resources={[]}
      onSave={onSave}
      onClose={vi.fn()}
      {...over}
    />,
  );
  return { onSave };
}

describe("BudgetBucketModal", () => {
  test("editing name and saving emits the updated bucket", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByDisplayValue("PAM"), {
      target: { value: "PAM v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].name).toBe("PAM v2");
  });

  test("blank name blocks save with a message", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByDisplayValue("PAM"), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });

  test("start after end blocks save", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByDisplayValue("2026-06-30"), {
      target: { value: "2025-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/start date must be/i)).toBeInTheDocument();
  });

  test("negative fixed-price amount blocks save", () => {
    const { onSave } = setup({ bucket: { ...baseBucket, type: "fixed", fixedPriceAmount: 0 } });
    // switch the amount to a negative value
    const amount = screen.getByDisplayValue("0");
    fireEvent.change(amount, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/amount must be zero or greater/i)).toBeInTheDocument();
  });

  test("zero/negative FX override blocks save", () => {
    const { onSave } = setup();
    const fx = screen.getByLabelText(/manual fx rate/i);
    fireEvent.change(fx, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/fx rate must be greater than zero/i)).toBeInTheDocument();
  });

  test("remove role drops the allocation", () => {
    const { onSave } = setup({
      bucket: { ...baseBucket, allocations: [{ roleId: 3, resourceIds: [], budgetHours: {}, actualHours: {} }] },
    });
    fireEvent.click(screen.getByRole("button", { name: /remove role/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect((onSave.mock.calls[0][0] as BudgetBucket).allocations).toHaveLength(0);
  });

  test("toggling a resource updates the allocation's resourceIds", () => {
    const resource = { id: 7, firstName: "Sam", lastName: "Lee", roleId: null, utilizationMode: "percent" as const, utilization: {} };
    const { onSave } = setup({
      bucket: { ...baseBucket, allocations: [{ roleId: 3, resourceIds: [], budgetHours: {}, actualHours: {} }] },
      resources: [resource],
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /sam lee/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect((onSave.mock.calls[0][0] as BudgetBucket).allocations[0].resourceIds).toEqual([7]);
  });

  test("add role appends an allocation with empty hour maps", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByRole("combobox", { name: /add role/i }), {
      target: { value: "3" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /\+ add role/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const saved = onSave.mock.calls[0][0] as BudgetBucket;
    expect(saved.allocations).toHaveLength(1);
    expect(saved.allocations[0]).toMatchObject({
      roleId: 3,
      resourceIds: [],
      budgetHours: {},
      actualHours: {},
    });
  });

  test("blended bucket shows discipline rows and can add one", () => {
    const { onSave } = setup({
      disciplines,
      bucket: { ...baseBucket, planningMode: "blended", disciplineAllocations: [] },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /add discipline/i }), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /\+ add discipline/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const saved = onSave.mock.calls[0][0] as BudgetBucket;
    expect(saved.disciplineAllocations).toEqual([
      { disciplineId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
    ]);
  });

  test("turning off detailed planning with entered hours warns and clears them on confirm", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onSave } = setup({
      disciplines,
      bucket: {
        ...baseBucket,
        planningMode: "detailed",
        allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: {} }],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /detailed budget planning/i }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const saved = onSave.mock.calls[0][0] as BudgetBucket;
    expect(saved.planningMode).toBe("blended");
    expect(saved.allocations[0].budgetHours).toEqual({});
    confirmSpy.mockRestore();
  });

  test("cancelling the warning keeps detailed mode and hours", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onSave } = setup({
      disciplines,
      bucket: {
        ...baseBucket,
        planningMode: "detailed",
        allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: {} }],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /detailed budget planning/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const saved = onSave.mock.calls[0][0] as BudgetBucket;
    expect(saved.planningMode ?? "detailed").toBe("detailed");
    expect(saved.allocations[0].budgetHours).toEqual({ "2026-01": 40 });
    confirmSpy.mockRestore();
  });

  test("negative internal rate override blocks save", () => {
    const { onSave } = setup({ disciplines });
    fireEvent.change(screen.getByLabelText(/internal rate override/i), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/zero or greater/i)).toBeInTheDocument();
  });
});
