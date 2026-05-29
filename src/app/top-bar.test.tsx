import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TopBar } from "./top-bar";

describe("TopBar", () => {
  const base = {
    lang: "en-US" as const,
    title: "Gantt",
    bannerCount: 0,
    onNewTask: () => {},
    onShowAlerts: () => {},
  };

  it("renders the view title", () => {
    render(<TopBar {...base} />);
    expect(screen.getByRole("heading", { name: "Gantt" })).toBeTruthy();
  });

  it("calls onNewTask when the new-task button is clicked", () => {
    const onNewTask = vi.fn();
    render(<TopBar {...base} onNewTask={onNewTask} />);
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(onNewTask).toHaveBeenCalled();
  });

  it("shows the alert badge count when > 0", () => {
    render(<TopBar {...base} bannerCount={3} />);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("hides the alert badge when bannerCount is 0", () => {
    render(<TopBar {...base} />);
    expect(screen.queryByText("0")).toBeNull();
  });
});
