import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChangeStatusSelect } from "./change-status-select";
import { t } from "./i18n";

const item = (id: number, title: string) =>
  ({ id, title, status: "Proposed" as const });

describe("ChangeStatusSelect", () => {
  it("calls onStatusChange with the row id and the picked status", () => {
    const onStatusChange = vi.fn();
    render(<ChangeStatusSelect lang="en-US" item={item(7, "Scope cut")} rowToken="Scope cut" onStatusChange={onStatusChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Approved" } });
    expect(onStatusChange).toHaveBeenCalledWith(7, "Approved");
  });

  // The axe gate provably cannot see two controls sharing an accessible name
  // (measured against axe-core 4.12.1). A multi-row unit test is the ONLY
  // possible detector, so it must render TWO rows.
  it("gives two rows DIFFERENT accessible names", () => {
    render(
      <>
        <ChangeStatusSelect lang="en-US" item={item(1, "Scope cut")} rowToken="Scope cut" onStatusChange={() => {}} />
        <ChangeStatusSelect lang="en-US" item={item(2, "Budget uplift")} rowToken="Budget uplift" onStatusChange={() => {}} />
      </>,
    );
    expect(screen.getByRole("combobox", { name: `${t("en-US", "changeFieldStatus")} – Scope cut` })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: `${t("en-US", "changeFieldStatus")} – Budget uplift` })).toBeTruthy();
  });

  it("renders every status as an option", () => {
    render(<ChangeStatusSelect lang="en-US" item={item(1, "Scope cut")} rowToken="Scope cut" onStatusChange={() => {}} />);
    expect(screen.getAllByRole("option")).toHaveLength(6);
  });
});
