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

  it("renders a menu button that calls onToggleSidebar when provided", () => {
    const onToggleSidebar = vi.fn();
    render(<TopBar {...base} onToggleSidebar={onToggleSidebar} />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(onToggleSidebar).toHaveBeenCalled();
  });

  it("omits the menu button when onToggleSidebar is not provided", () => {
    render(<TopBar {...base} />);
    expect(screen.queryByRole("button", { name: "Open navigation menu" })).toBeNull();
  });

  it("renders primaryAction in place of the default New-task button", () => {
    render(
      <TopBar
        lang="en-US"
        title="Editing task #5"
        bannerCount={0}
        onNewTask={() => {}}
        onShowAlerts={() => {}}
        primaryAction={<button type="button">Save changes</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
  });

  it("renders the AI Assistant button when onOpenAiAssistant is provided", () => {
    const onOpenAiAssistant = vi.fn();
    render(<TopBar {...base} onOpenAiAssistant={onOpenAiAssistant} />);
    expect(screen.getByRole("button", { name: "AI Assistant" })).toBeTruthy();
  });

  it("calls onOpenAiAssistant when the AI Assistant button is clicked", () => {
    const onOpenAiAssistant = vi.fn();
    render(<TopBar {...base} onOpenAiAssistant={onOpenAiAssistant} />);
    fireEvent.click(screen.getByRole("button", { name: "AI Assistant" }));
    expect(onOpenAiAssistant).toHaveBeenCalledOnce();
  });

  it("omits the AI Assistant button when onOpenAiAssistant is not provided", () => {
    render(<TopBar {...base} />);
    expect(screen.queryByRole("button", { name: "AI Assistant" })).toBeNull();
  });

  it("renders AI Assistant button before New Task button in DOM order", () => {
    const onOpenAiAssistant = vi.fn();
    render(<TopBar {...base} onOpenAiAssistant={onOpenAiAssistant} />);
    const buttons = screen.getAllByRole("button");
    const aiIdx = buttons.findIndex((b) => b.getAttribute("aria-label") === "AI Assistant");
    const newTaskIdx = buttons.findIndex((b) => b.textContent?.trim() === "New task");
    expect(aiIdx).toBeGreaterThanOrEqual(0);
    expect(newTaskIdx).toBeGreaterThanOrEqual(0);
    expect(aiIdx).toBeLessThan(newTaskIdx);
  });
});
