import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ChangeEditModal } from "./change-edit-modal";
import type { ChangeItem } from "./types";

const draft: ChangeItem = { id: 1, title: "Widen scope", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [] };
const base = {
  lang: "en-US" as const, tasks: [], raid: [], draft, isNew: false,
  onChange: vi.fn(), onApplyStatus: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn(),
};

describe("ChangeEditModal", () => {
  it("renders the title field, a type select, and a status select", () => {
    const { getByDisplayValue, getByLabelText } = render(<ChangeEditModal {...base} />);
    expect(getByDisplayValue("Widen scope")).toBeTruthy();
    expect(getByLabelText(/type/i)).toBeTruthy();
    expect(getByLabelText(/status/i)).toBeTruthy();
  });
  it("calls onApplyStatus when the status changes", () => {
    const onApplyStatus = vi.fn();
    const { getByLabelText } = render(<ChangeEditModal {...base} onApplyStatus={onApplyStatus} />);
    const sel = getByLabelText(/status/i) as HTMLSelectElement;
    sel.value = "Approved";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onApplyStatus).toHaveBeenCalledWith("Approved");
  });
  it("calls onSave / onCancel from the footer buttons", () => {
    const onSave = vi.fn(), onCancel = vi.fn();
    const { getByRole } = render(<ChangeEditModal {...base} onSave={onSave} onCancel={onCancel} />);
    getByRole("button", { name: /save/i }).click();
    getByRole("button", { name: /cancel/i }).click();
    expect(onSave).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
