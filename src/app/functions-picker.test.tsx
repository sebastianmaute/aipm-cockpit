import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import { FunctionsPicker, UsesNotice } from "./functions-picker";

function setup(features: FeatureModuleId[]) {
  const onChange = vi.fn();
  render(<FunctionsPicker lang="en-US" features={features} onChange={onChange} />);
  return onChange;
}

describe("FunctionsPicker", () => {
  it("presets clear every module or select all of them", () => {
    const onChange = setup(["gantt"]);
    fireEvent.click(screen.getByRole("button", { name: "Apply Simple preset" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole("button", { name: "Apply Advanced preset" }));
    expect(onChange).toHaveBeenLastCalledWith([...ALL_MODULE_IDS]);
  });

  it("toggling a module checkbox adds or removes only that module", () => {
    const onChange = setup(["gantt"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Budget" }));
    expect(onChange).toHaveBeenLastCalledWith(["gantt", "budget"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Gantt" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("says what Time bookings uses and turns both on", () => {
    const onChange = setup(["timelog"]);
    expect(screen.getByText(/uses Resources/)).toHaveTextContent(
      "Time bookings uses Resources (to match bookings to people) and Budget (to cost them). Both are off.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on Resources and Budget" }));
    const next = onChange.mock.calls.at(-1)![0] as FeatureModuleId[];
    expect(new Set(next)).toEqual(new Set(["timelog", "resources", "budget"]));
  });

  it("names the one module that is off and adds only that one", () => {
    const onChange = setup(["timelog", "resources"]);
    expect(screen.getByText(/uses Resources/)).toHaveTextContent("Budget is off.");
    fireEvent.click(screen.getByRole("button", { name: "Turn on Budget" }));
    const next = onChange.mock.calls.at(-1)![0] as FeatureModuleId[];
    expect(new Set(next)).toEqual(new Set(["timelog", "resources", "budget"]));
  });

  it("shows no notice when everything is on or Time bookings itself is off", () => {
    setup(["timelog", "resources", "budget"]);
    expect(screen.queryByText(/uses Resources/)).toBeNull();
  });

  it("shows no notice when Time bookings is off", () => {
    setup(["gantt"]);
    expect(screen.queryByText(/uses Resources/)).toBeNull();
  });

  it("gives the Turn on button an accessible name that contains its visible text", () => {
    setup(["timelog"]);
    const button = screen.getByRole("button", { name: "Turn on Resources and Budget" });
    expect(button).toHaveTextContent("Turn on");
  });
});

describe("UsesNotice", () => {
  it("renders no button without onTurnOn", () => {
    render(<UsesNotice lang="en-US" moduleId="timelog" missing={["resources", "budget"]} />);
    expect(screen.getByText(/uses Resources/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("renders nothing when nothing is missing", () => {
    const { container } = render(<UsesNotice lang="en-US" moduleId="timelog" missing={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
