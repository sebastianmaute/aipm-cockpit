import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SegmentedControl } from "./segmented-control";

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
});
