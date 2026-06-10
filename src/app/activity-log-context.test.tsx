import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityLogProvider, useActivityLogger } from "./activity-log-context";

function Probe() {
  const log = useActivityLogger();
  return <span>{log ? "has-logger" : "no-logger"}</span>;
}

describe("ActivityLogProvider / useActivityLogger", () => {
  it("returns null with no provider", () => {
    render(<Probe />);
    expect(screen.getByText("no-logger")).toBeInTheDocument();
  });
  it("provides the logger inside the provider and forwards calls", () => {
    const log = vi.fn();
    render(
      <ActivityLogProvider value={log}>
        <Probe />
      </ActivityLogProvider>,
    );
    expect(screen.getByText("has-logger")).toBeInTheDocument();
  });
});
