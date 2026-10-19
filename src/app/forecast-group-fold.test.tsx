// "Forecast by group" (§502 part 4, Task 11b): one full run per group, so the fold-out computes nothing until it is
// opened, and then off the render path — "Working it out…" first, the rows a macrotask later. An edit while it is
// open never runs the engine during render, and closing it cancels the pending run. The engine is a spy here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ForecastGroupFold } from "./forecast-group-fold";
import { forecastByGroup, type GroupForecastInput, type GroupForecastRow } from "./forecast-by-group";

vi.mock("./forecast-by-group", () => ({ forecastByGroup: vi.fn() }));

const ROWS: GroupForecastRow[] = [{ key: "Build", open: 2, kind: "insufficient", finished: 2, neededFinished: 10, days: 2, neededDays: 20 }];
const input = (): GroupForecastInput => ({ tasks: [], today: "2026-10-14", holidaySet: new Set(), planEnd: "2026-12-31" });
const engine = vi.mocked(forecastByGroup);

function toggle(open: boolean): void {
  const fold = screen.getByTestId("forecast-by-group") as HTMLDetailsElement;
  act(() => {
    fold.open = open;
    fold.dispatchEvent(new Event("toggle"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  engine.mockReset();
  engine.mockReturnValue(ROWS);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ForecastGroupFold (Task 11b)", () => {
  it("computes nothing while closed", () => {
    render(<ForecastGroupFold lang="en-US" input={input()} />);
    act(() => { vi.runAllTimers(); });
    expect(engine).not.toHaveBeenCalled();
  });

  it("opening it shows 'Working it out…', then the rows once the run has gone off the render path", () => {
    render(<ForecastGroupFold lang="en-US" input={input()} />);
    toggle(true);
    expect(engine).not.toHaveBeenCalled();
    expect(screen.getByText("Working it out…")).toBeTruthy();
    expect(screen.queryByText("Build")).toBeNull();
    act(() => { vi.runAllTimers(); });
    expect(engine).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Build")).toBeTruthy();
    expect(screen.queryByText("Working it out…")).toBeNull();
  });

  it("an edit while open runs no engine in the render that follows, and shows no rows from the old input", () => {
    const { rerender } = render(<ForecastGroupFold lang="en-US" input={input()} />);
    toggle(true);
    act(() => { vi.runAllTimers(); });
    expect(engine).toHaveBeenCalledTimes(1);
    const edited = input();
    rerender(<ForecastGroupFold lang="en-US" input={edited} />);
    expect(engine).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Working it out…")).toBeTruthy();
    expect(screen.queryByText("Build")).toBeNull();
    act(() => { vi.runAllTimers(); });
    expect(engine).toHaveBeenCalledTimes(2);
    expect(engine).toHaveBeenLastCalledWith(edited);
    expect(screen.getByText("Build")).toBeTruthy();
  });

  it("a burst of edits runs the engine once, for the last input", () => {
    const { rerender } = render(<ForecastGroupFold lang="en-US" input={input()} />);
    toggle(true);
    const last = input();
    rerender(<ForecastGroupFold lang="en-US" input={input()} />);
    rerender(<ForecastGroupFold lang="en-US" input={last} />);
    act(() => { vi.runAllTimers(); });
    expect(engine).toHaveBeenCalledTimes(1);
    expect(engine).toHaveBeenCalledWith(last);
  });

  it("closing it cancels the pending run", () => {
    render(<ForecastGroupFold lang="en-US" input={input()} />);
    toggle(true);
    toggle(false);
    act(() => { vi.runAllTimers(); });
    expect(engine).not.toHaveBeenCalled();
  });

  it("reopening on the same input shows the rows at once and runs nothing again", () => {
    render(<ForecastGroupFold lang="en-US" input={input()} />);
    toggle(true);
    act(() => { vi.runAllTimers(); });
    toggle(false);
    toggle(true);
    expect(screen.getByText("Build")).toBeTruthy();
    act(() => { vi.runAllTimers(); });
    expect(engine).toHaveBeenCalledTimes(1);
  });
});
