import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import TaskManager from "./task-manager";

function setLayout(layout: "modern" | "classic") {
  window.localStorage.setItem("lop-app:settings", JSON.stringify({ layout }));
}

describe("TaskManager shell selection", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders the sidebar brand in modern mode (default)", async () => {
    render(<TaskManager />);
    expect(await screen.findByText("PROJECT MANAGEMENT TRACKER")).toBeTruthy();
  });

  it("renders the classic layout (no sidebar brand) in classic mode", async () => {
    setLayout("classic");
    render(<TaskManager />);
    // The classic AppHeader renders an "Add task" icon button; the workspace
    // (gantt) renders its own, so there are several — assert at least one and
    // that the modern sidebar brand is absent.
    expect((await screen.findAllByRole("button", { name: "Add task" })).length).toBeGreaterThan(0);
    expect(screen.queryByText("PROJECT MANAGEMENT TRACKER")).toBeNull();
  });

  it("classic layout fits the viewport with a pinned footer (non-popout)", async () => {
    setLayout("classic");
    const { container } = render(<TaskManager />);
    await screen.findAllByRole("button", { name: "Add task" });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-screen");
    expect(root.className).toContain("flex");
    expect(root.className).toContain("flex-col");
  });

  it("opens the full-page edit view (not the modal) when New task is clicked in modern mode", async () => {
    render(<TaskManager />); // modern is the default layout
    // The modern top bar's New-task button.
    fireEvent.click(await screen.findByRole("button", { name: "New task" }));
    // Full-page edit view appears…
    expect(await screen.findByRole("heading", { name: "1. Details" })).toBeTruthy();
    // …and the dialog modal does NOT.
    expect(screen.queryByRole("dialog", { name: /new task/i })).toBeNull();
    // Top bar + footer both show Save (Add task) + Cancel instead of New task.
    expect(screen.getAllByRole("button", { name: "Add task" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
  });

  it("returns to the previous view when the edit is cancelled", async () => {
    render(<TaskManager />);
    fireEvent.click(await screen.findByRole("button", { name: "New task" }));
    expect(await screen.findByRole("heading", { name: "1. Details" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    // Back on Open Points (the origin view): the edit heading is gone.
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "1. Details" })).toBeNull(),
    );
  });
});
