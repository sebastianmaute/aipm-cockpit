import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import TaskManager from "./task-manager";

function setLayout(layout: "modern" | "classic") {
  window.localStorage.setItem("lop-app:settings", JSON.stringify({ layout }));
}

// Seed one registered project so the multi-project empty-state gate (shown when
// the registry has zero projects) does not replace the app chrome these tests
// assert against. The project's storageConfig points at the default browser
// backend, matching the app's default.
function seedRegistry() {
  window.localStorage.setItem(
    "lop-app:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
}

describe("TaskManager shell selection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedRegistry();
  });

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

});
