import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { allVisibleSelected, toggleAllInSet, toggleInSet } from "./row-selection";
import { BulkEditBar } from "./bulk-edit-bar";
import { BulkEditPanel, selectField, dateField } from "./bulk-edit-panel";

describe("row-selection pure ops", () => {
  test("toggleInSet adds then removes, immutably", () => {
    const a = toggleInSet(new Set<number>(), 1);
    expect([...a]).toEqual([1]);
    const b = toggleInSet(a, 1);
    expect([...b]).toEqual([]);
    expect([...a]).toEqual([1]); // original untouched
  });

  test("toggleAllInSet selects all visible, then clears them when all already selected", () => {
    const sel = toggleAllInSet(new Set<number>([9]), [1, 2, 3]);
    expect([...sel].sort()).toEqual([1, 2, 3, 9]);
    const cleared = toggleAllInSet(sel, [1, 2, 3]);
    expect([...cleared]).toEqual([9]); // visible removed, hidden 9 kept
  });

  test("toggleAllInSet with empty visible list is a no-op copy", () => {
    expect([...toggleAllInSet(new Set([5]), [])]).toEqual([5]);
  });

  test("allVisibleSelected is false for empty visible list", () => {
    expect(allVisibleSelected(new Set([1]), [])).toBe(false);
    expect(allVisibleSelected(new Set([1, 2]), [1, 2])).toBe(true);
    expect(allVisibleSelected(new Set([1]), [1, 2])).toBe(false);
  });
});

describe("BulkEditBar", () => {
  test("renders nothing at zero selection", () => {
    const { container } = render(
      <BulkEditBar lang="en-US" count={0} open={false} onToggleOpen={() => {}} onClear={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("shows count and fires toggle + clear", () => {
    const onToggleOpen = vi.fn();
    const onClear = vi.fn();
    render(<BulkEditBar lang="en-US" count={3} open={false} onToggleOpen={onToggleOpen} onClear={onClear} />);
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bulk edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("BulkEditPanel", () => {
  const FIELDS = [
    selectField("status", "Status", [
      { value: "open", label: "Open" },
      { value: "closed", label: "Closed" },
    ]),
    dateField("targetDate", "Target date"),
  ];

  test("Apply is disabled until a field is enabled, then emits only enabled fields", () => {
    const onApply = vi.fn();
    render(<BulkEditPanel lang="en-US" count={2} fields={FIELDS} onApply={onApply} onCancel={() => {}} />);
    const applyBtn = screen.getByRole("button", { name: "Apply to 2" });
    expect(applyBtn).toBeDisabled();

    // enable Status (the enable checkbox is labelled by the field label)
    fireEvent.click(screen.getByRole("checkbox", { name: "Status" }));
    expect(applyBtn).toBeEnabled();
    fireEvent.click(applyBtn);
    // only the ticked field is emitted; seeded to first option
    expect(onApply).toHaveBeenCalledWith({ status: "open" });
  });

  test("Cancel fires onCancel", () => {
    const onCancel = vi.fn();
    render(<BulkEditPanel lang="en-US" count={1} fields={FIELDS} onApply={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
