import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import TaskManager from "./task-manager";

function setLayout(layout: "modern" | "classic") {
  window.localStorage.setItem("lop-app:settings", JSON.stringify({ layout }));
}

describe("TaskManager shell selection", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders the sidebar brand in modern mode (default)", async () => {
    render(<TaskManager />);
    expect(await screen.findByText("LIST OF OPEN POINTS")).toBeTruthy();
  });

  it("renders the classic layout (no sidebar brand) in classic mode", async () => {
    setLayout("classic");
    render(<TaskManager />);
    // The classic AppHeader renders an "Add task" icon button; the workspace
    // (gantt) renders its own, so there are several — assert at least one and
    // that the modern sidebar brand is absent.
    expect((await screen.findAllByRole("button", { name: "Add task" })).length).toBeGreaterThan(0);
    expect(screen.queryByText("LIST OF OPEN POINTS")).toBeNull();
  });

  it("opens the full-page edit view (not the modal) when New task is clicked in modern mode", async () => {
    render(<TaskManager />); // modern is the default layout
    // The modern top bar's New-task button.
    fireEvent.click(await screen.findByRole("button", { name: "New task" }));
    // Full-page edit view appears…
    expect(await screen.findByRole("heading", { name: /task details/i })).toBeTruthy();
    // …and the dialog modal does NOT.
    expect(screen.queryByRole("dialog", { name: /new task/i })).toBeNull();
    // Top bar now shows Save (Add task) + Cancel instead of New task.
    expect(screen.getByRole("button", { name: "Add task" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
  });

  it("returns to the previous view when the edit is cancelled", async () => {
    render(<TaskManager />);
    fireEvent.click(await screen.findByRole("button", { name: "New task" }));
    expect(await screen.findByRole("heading", { name: /task details/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Back on Open Points (the origin view): the edit heading is gone.
    expect(screen.queryByRole("heading", { name: /task details/i })).toBeNull();
  });
});
