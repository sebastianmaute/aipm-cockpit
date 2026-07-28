import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClearableSearchInput } from "./clearable-search-input";

function setup(value: string, onClear = vi.fn()) {
  render(
    <ClearableSearchInput value={value} onClear={onClear} clearLabel="Clear">
      <input aria-label="Filter" defaultValue={value} readOnly />
    </ClearableSearchInput>,
  );
  return { onClear };
}

describe("ClearableSearchInput", () => {
  it("renders no clear button while the value is empty", () => {
    setup("");
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("renders a labelled clear button once the value is non-empty", () => {
    setup("abc");
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
  });

  it("calls onClear when the button is activated", async () => {
    const { onClear } = setup("abc");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  // ★ Reaching the button with Tab, NOT `btn.focus()`. Programmatic focus
  // succeeds even on `tabIndex={-1}`, so a focus()-then-assert-activeElement
  // test cannot fail for any change to the component — it is vacuous. Tabbing
  // from the field is what actually proves the button is in the tab order,
  // which is the whole point of replacing the browser's own unreachable clear.
  it("is reachable by Tab from the field it clears", async () => {
    setup("abc");
    screen.getByLabelText("Filter").focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Clear" }));
  });

  it("can be activated by keyboard once focused", async () => {
    const { onClear } = setup("abc");
    screen.getByRole("button", { name: "Clear" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("renders the caller's field as its child", () => {
    setup("abc");
    expect(screen.getByLabelText("Filter")).toBeTruthy();
  });
});
