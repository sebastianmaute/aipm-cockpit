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

  it("keeps the clear button keyboard-reachable", async () => {
    setup("abc");
    const btn = screen.getByRole("button", { name: "Clear" });
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  it("renders the caller's field as its child", () => {
    setup("abc");
    expect(screen.getByLabelText("Filter")).toBeTruthy();
  });
});
