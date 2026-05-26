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
