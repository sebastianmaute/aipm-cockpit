import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModernShell } from "./modern-shell";

function setup(over: Partial<React.ComponentProps<typeof ModernShell>> = {}) {
  const onNavigate = vi.fn();
  render(
    <ModernShell
      lang="en-US"
      activeView="open-points"
      onNavigate={onNavigate}
      version="v0.29.0"
      mode="advanced"
      bannerCount={0}
      onShowAlerts={() => {}}
      topBarMenus={<div data-testid="menus" />}
      sidebarFooter={null}
      tasksSection={<div data-testid="tasks" />}
      workspace={<div data-testid="workspace" />}
      {...over}
    />,
  );
  return { onNavigate };
}

describe("ModernShell", () => {
  it("shows the tasks section for the open-points view", () => {
    setup({ activeView: "open-points" });
    expect(screen.getByTestId("tasks")).toBeTruthy();
    expect(screen.queryByTestId("workspace")).toBeNull();
  });

  it("shows the workspace for other views", () => {
    setup({ activeView: "gantt" });
    expect(screen.getByTestId("workspace")).toBeTruthy();
    expect(screen.queryByTestId("tasks")).toBeNull();
  });

  it("renders projectSwitcherTrailing (Ask-Claude) in the top bar's left cluster", () => {
    setup({ projectSwitcherTrailing: <div data-testid="ask-claude-slot" /> });
    expect(screen.getByTestId("ask-claude-slot")).toBeTruthy();
  });

  it("navigates when a sidebar item is clicked", () => {
    const { onNavigate } = setup({ activeView: "open-points" });
    fireEvent.click(screen.getByRole("button", { name: "RAID" }));
    expect(onNavigate).toHaveBeenCalledWith("raid");
  });

  it("uses the active view's label as the top-bar title", () => {
    setup({ activeView: "gantt" });
    expect(screen.getByRole("heading", { name: "Gantt" })).toBeTruthy();
  });

  it("announces the active view via a polite live region (#26)", () => {
    // A visually-hidden role=status region carries the view label so screen
    // readers hear the view change (only aria-current moves otherwise).
    setup({ activeView: "gantt" });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Gantt");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.className).toContain("sr-only");
  });

  it("shows the edit view and edit title, but never surfaces edit actions in the top bar", () => {
    // Editor actions render inside the editor (editView footer) only. ModernShell
    // must NOT surface a duplicate copy in the top bar — there is no editActions
    // prop and no top-bar primaryAction while editing.
    setup({
      activeView: "edit",
      editView: (
        <div data-testid="edit">
          <button type="button">Save changes</button>
        </div>
      ),
      editTitle: "Editing task #5",
    });
    expect(screen.getByTestId("edit")).toBeTruthy();
    expect(screen.queryByTestId("tasks")).toBeNull();
    expect(screen.queryByTestId("workspace")).toBeNull();
    expect(screen.getByRole("heading", { name: "Editing task #5" })).toBeTruthy();
    // The editor renders exactly one "Save changes"; the top bar adds no second copy.
    expect(screen.getAllByRole("button", { name: "Save changes" })).toHaveLength(1);
    // No top-bar primaryAction (New-task button) while editing.
    expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
  });

  it("forwards collapsed to the sidebar (brand subtitle hidden, expand button shown)", () => {
    setup({ collapsed: true });
    expect(screen.queryByText("List of Open Points")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("renders a skip-to-content link targeting the main region", () => {
    setup();
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link.getAttribute("href")).toBe("#main-content");
    expect(document.getElementById("main-content")).not.toBeNull();
  });

  it("calls onToggleCollapsed when the sidebar collapse button is clicked", () => {
    const onToggleCollapsed = vi.fn();
    setup({ collapsed: false, onToggleCollapsed });
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onToggleCollapsed).toHaveBeenCalled();
  });
});

describe("ModernShell settings slot", () => {
  it("renders settingsView in main when activeView === 'settings'", () => {
    setup({
      activeView: "settings",
      settingsView: <div>settings-page</div>,
    });
    expect(screen.getByText("settings-page")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace")).toBeNull();
  });
});

describe("ModernShell banners slot", () => {
  it("renders banners at the top of the main content region", () => {
    setup({ banners: <div data-testid="banners" /> });
    const main = document.getElementById("main-content");
    const banners = screen.getByTestId("banners");
    expect(banners).toBeInTheDocument();
    expect(main?.contains(banners)).toBe(true);
    // Banners come before the view content in DOM order.
    const tasks = screen.getByTestId("tasks");
    expect(banners.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders banners on the edit view too (all views)", () => {
    setup({
      activeView: "edit",
      editView: <div data-testid="edit" />,
      editTitle: "Editing task #1",
      banners: <div data-testid="banners" />,
    });
    expect(screen.getByTestId("banners")).toBeInTheDocument();
  });
});
