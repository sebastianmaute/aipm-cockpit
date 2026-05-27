import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BudgetBucketModal } from "./budget-bucket-modal";
import type { BudgetBucket, Role } from "./types";

const roles: Role[] = [
  { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
  { id: 4, disciplineId: 1, gradeId: 2, internalRate: 120, externalRate: 180 },
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
});
