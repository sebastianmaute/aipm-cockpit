import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StakeholderRecipientInput } from "./stakeholder-recipient-input";

const SUGGESTIONS = ["Alice Smith", "Bob Jones", "Carol White"];

function setup(overrides: Partial<React.ComponentProps<typeof StakeholderRecipientInput>> = {}) {
  const onChange = vi.fn();
  render(
    <StakeholderRecipientInput
      id="test-input"
      label="Key Stakeholders"
      value={[]}
      suggestions={SUGGESTIONS}
      onChange={onChange}
      {...overrides}
    />,
  );
  const input = screen.getByRole("combobox");
  return { onChange, input };
}

describe("StakeholderRecipientInput", () => {
  // 1. Renders existing chips from value.
  it("renders existing chips for each value entry", () => {
    setup({ value: ["Alice Smith", "Bob Jones"] });
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
  });

  // 2. Typing a substring shows matching suggestions (and excludes already-chosen).
  it("shows filtered suggestions when typing and excludes already-chosen names", () => {
    const { input } = setup({ value: ["Alice Smith"] });
    fireEvent.change(input, { target: { value: "b" } });
    expect(screen.getByRole("option", { name: "Bob Jones" })).toBeInTheDocument();
    // Carol doesn't match "b".
    expect(screen.queryByRole("option", { name: "Carol White" })).not.toBeInTheDocument();
    // Alice is already chosen — must not appear.
    expect(screen.queryByRole("option", { name: "Alice Smith" })).not.toBeInTheDocument();
  });

  // 3. Clicking a suggestion calls onChange with it appended.
  it("clicking a suggestion appends it via onChange", () => {
    const { onChange, input } = setup({ value: ["Alice Smith"] });
    fireEvent.change(input, { target: { value: "bo" } });
    const option = screen.getByRole("option", { name: "Bob Jones" });
    fireEvent.mouseDown(option);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["Alice Smith", "Bob Jones"]);
  });

  // 4. Typing free text + Enter adds it even with no match.
  it("commits free text on Enter even when no suggestion matches", () => {
    const { onChange, input } = setup();
    fireEvent.change(input, { target: { value: "Zara New" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["Zara New"]);
  });

  // 5. Comma also commits.
  it("commits the current draft on comma key", () => {
    const { onChange, input } = setup();
    fireEvent.change(input, { target: { value: "Dave" } });
    fireEvent.keyDown(input, { key: "," });
    expect(onChange).toHaveBeenCalledWith(["Dave"]);
  });

  // 6. Duplicate (case-insensitive) is ignored.
  it("ignores a duplicate entry (case-insensitive)", () => {
    const { onChange, input } = setup({ value: ["Alice Smith"] });
    // Type the same name in a different case.
    fireEvent.change(input, { target: { value: "alice smith" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  // 7. Removing a chip calls onChange without that name.
  it("calls onChange without the removed name when × is clicked", () => {
    const { onChange } = setup({ value: ["Alice Smith", "Bob Jones"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove Alice Smith" }));
    expect(onChange).toHaveBeenCalledWith(["Bob Jones"]);
  });

  // 8a. A chip matching a suggestion shows the "known" affordance.
  it("marks a chip as known when its name matches a suggestion (title + data-known)", () => {
    setup({ value: ["Alice Smith", "Unknown Person"] });
    const aliceChip = screen.getByText("Alice Smith").closest("span[data-known]");
    expect(aliceChip).not.toBeNull();
    expect(aliceChip).toHaveAttribute("title", "known stakeholder");
  });

  // 8b. A non-matching chip does not have the known affordance.
  it("does not mark a chip as known when its name does not match any suggestion", () => {
    setup({ value: ["Unknown Person"] });
    const unknownChip = screen.getByText("Unknown Person").closest("span");
    expect(unknownChip).not.toHaveAttribute("data-known");
    expect(unknownChip).not.toHaveAttribute("title", "known stakeholder");
  });
});
