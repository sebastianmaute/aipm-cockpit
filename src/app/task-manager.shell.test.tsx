import { render, screen } from "@testing-library/react";
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
});
