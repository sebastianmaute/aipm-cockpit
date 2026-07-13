import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "./segmented-control";

const PRIORITIES = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
] as const;

describe("SegmentedControl", () => {
  test("renders a radiogroup with the current value marked as selected", () => {
    render(
      <SegmentedControl
        value="Medium"
        options={PRIORITIES}
        onChange={() => {}}
        ariaLabel="Priority"
      />,
    );
    expect(
      screen.getByRole("radiogroup", { name: "Priority" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Medium" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("invokes onChange with the clicked option's value", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="Low"
        options={PRIORITIES}
        onChange={onChange}
        ariaLabel="Priority"
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "High" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("High");
  });

  test("does not fire onChange when disabled", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="Low"
        options={PRIORITIES}
        onChange={onChange}
        disabled
        ariaLabel="Priority"
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "High" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("optionAriaLabel overrides each radio's accessible name (row-unique)", () => {
    render(
      <SegmentedControl
        value="Low"
        options={PRIORITIES}
        onChange={() => {}}
        ariaLabel="Priority"
        optionAriaLabel={(v) => `Row 1 — ${v}`}
      />,
    );
    expect(screen.getByRole("radio", { name: "Row 1 — High" })).toBeInTheDocument();
    // The plain visible label is no longer the accessible name.
    expect(screen.queryByRole("radio", { name: "High" })).toBeNull();
  });

  test("without optionAriaLabel a radio's accessible name stays the visible label", () => {
    render(
      <SegmentedControl value="Low" options={PRIORITIES} onChange={() => {}} ariaLabel="Priority" />,
    );
    expect(screen.getByRole("radio", { name: "High" })).toBeInTheDocument();
  });

  test("applies the title attribute to the radiogroup root", () => {
    render(
      <SegmentedControl
        value="Low"
        options={[{ value: "Low", label: "Low" }, { value: "High", label: "High" }]}
        onChange={() => {}}
        ariaLabel="Demo"
        title="Helpful hint"
      />,
    );
    expect(screen.getByRole("radiogroup")).toHaveAttribute("title", "Helpful hint");
  });
});

describe("SegmentedControl palette", () => {
  test("uses the green focus-ring accent and no drop shadow", () => {
    render(
      <SegmentedControl
        value="a"
        ariaLabel="test"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={() => {}}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios[0].className).toContain("ring-AIPM-green");
    expect(radios[0].className).not.toContain("ring-AIPM-dark-blue");
    const group = screen.getByRole("radiogroup");
    expect(group.className).not.toContain("shadow");
    expect(group.className).not.toContain("zinc");
  });

  test("active button carries token-driven bg/fg classes; inactive button does not", () => {
    // Arrange
    render(
      <SegmentedControl
        value="a"
        ariaLabel="token-test"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={() => {}}
      />,
    );

    // Act
    const selected = screen.getByRole("radio", { name: "A" });
    const unselected = screen.getByRole("radio", { name: "B" });

    // Assert — selected carries token classes
    expect(selected.className).toContain("bg-[var(--segment-active-bg)]");
    expect(selected.className).toContain("text-[var(--segment-active-fg)]");
    // Assert — unselected does NOT carry them
    expect(unselected.className).not.toContain("bg-[var(--segment-active-bg)]");
    expect(unselected.className).not.toContain("text-[var(--segment-active-fg)]");
    // Assert — wrapper uses track token (not raw bg-surface)
    const group = screen.getByRole("radiogroup");
    expect(group.className).toContain("bg-[var(--segment-track-bg)]");
    expect(group.className).not.toContain("bg-surface");
  });
});
