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
  //
  // ★★ THE TWO ROWS MUST SHARE A TITLE. With distinct titles ("Scope cut" /
  // "Budget uplift") the two names differed because the TITLES differed, so the
  // one-token mutation `rowLabel(t(lang, "changeFieldStatus"), item.title)` —
  // dropping `rowToken` entirely — kept both names distinct and stayed GREEN.
  // Colliding titles plus occurrence-suffixed tokens is the shape
  // `buildRowTokens` actually emits, and the only one where the names can differ
  // ONLY because the token was honoured.
  it("gives two rows DIFFERENT accessible names", () => {
    render(
      <>
        <ChangeStatusSelect lang="en-US" item={item(1, "Scope cut")} rowToken="Scope cut (1)" onStatusChange={() => {}} />
        <ChangeStatusSelect lang="en-US" item={item(2, "Scope cut")} rowToken="Scope cut (2)" onStatusChange={() => {}} />
      </>,
    );
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(screen.getByRole("combobox", { name: `${t("en-US", "changeFieldStatus")} – Scope cut (1)` })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: `${t("en-US", "changeFieldStatus")} – Scope cut (2)` })).toBeTruthy();
  });

  it("renders every status as an option", () => {
    render(<ChangeStatusSelect lang="en-US" item={item(1, "Scope cut")} rowToken="Scope cut" onStatusChange={() => {}} />);
    expect(screen.getAllByRole("option")).toHaveLength(6);
  });
});
