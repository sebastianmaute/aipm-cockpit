import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SingleEntityPicker, type SingleEntityOption } from "./single-entity-picker";

const OPTIONS: SingleEntityOption[] = [
  { value: "task:1", code: "Task", label: "Ship the release" },
  { value: "raid:2", code: "RAID", label: "Vendor delay" },
];

function renderPicker(overrides: Partial<Parameters<typeof SingleEntityPicker>[0]> = {}) {
  const props = {
    value: "",
    options: OPTIONS,
    query: "",
    onQueryChange: vi.fn(),
    onSelect: vi.fn(),
    searchLabel: "Attach to",
    placeholder: "Search…",
    clearLabel: "Clear – Attach to",
    emptyLabel: "—",
    ...overrides,
  };
  return { props, ...render(<SingleEntityPicker {...props} />) };
}

describe("SingleEntityPicker", () => {
  it("names its search box and exposes the combobox role", () => {
    renderPicker();
    // A placeholder is NOT an accessible name — it fails the axe gate.
    expect(screen.getByRole("combobox", { name: "Attach to" })).toBeInTheDocument();
  });

  it("keeps the listbox closed while the query is blank", () => {
    renderPicker();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the listbox once a query has options", () => {
    renderPicker({ query: "ship" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("selects with a click", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "ship" });
    await user.click(screen.getByRole("option", { name: /Ship the release/ }));
    expect(props.onSelect).toHaveBeenCalledWith("task:1");
  });

  it("arrows to an option and commits it with Enter", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");
    box.focus();
    await user.keyboard("{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0].id);
    await user.keyboard("{Enter}");
    expect(props.onSelect).toHaveBeenCalledWith("task:1");
  });

  // ★ Enter must NOT be swallowed unless an option is actually armed. This
  // control sits inside forms where a bare Enter submits; claiming Enter merely
  // because a dropdown is open would silently break submitting from this field.
  it("leaves Enter alone when no option is armed", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");
    box.focus();
    await user.keyboard("{Enter}");
    expect(props.onSelect).not.toHaveBeenCalled();
    // ★★ `onSelect` staying uncalled is only HALF the claim, and it is the half
    // a broken guard satisfies for the wrong reason: without the armed check,
    // `options[-1].value` THROWS before onSelect is ever reached, so the
    // assertion above passes while React reports an unhandled error and the
    // suite summary still reads green. The claim that matters is that Enter is
    // not CLAIMED — `fireEvent` returns the dispatch result, which is false
    // exactly when a listener called preventDefault, so this is the direct
    // observable for "a bare Enter still reaches the enclosing form".
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(true);
  });

  it("closes on Escape without clearing the query", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "a" });
    screen.getByRole("combobox").focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(props.onQueryChange).not.toHaveBeenCalled();
  });

  it("renders the current selection's label when one is set", () => {
    renderPicker({ value: "raid:2", selectedLabel: "RAID: Vendor delay" });
    expect(screen.getByText("RAID: Vendor delay")).toBeInTheDocument();
  });

  it("shows the empty label when nothing is selected", () => {
    renderPicker({ value: "" });
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
