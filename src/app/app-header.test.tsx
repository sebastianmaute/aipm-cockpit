import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type React from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { WorkspaceProvider } from "./workspace-context";
import { AppHeader } from "./app-header";
import type { AppHeaderProps } from "./app-header";
import { defaultSettings } from "./settings-types";
import type { AlertableTask } from "./due-dates";
import type { Task } from "./types";

function makeProps(overrides: Partial<AppHeaderProps> = {}): AppHeaderProps {
  return {
    handleCancelEdit: vi.fn(),
    setTaskModalOpen: vi.fn(),
    bannerItems: [],
    setBannerDismissed: vi.fn(),
    setDueModalOpen: vi.fn(),
    showToast: vi.fn(),
    handleCommand: vi.fn(),
    storageDescription: null,
    storageReady: true,
    onPickStorageFile: vi.fn().mockResolvedValue(undefined),
    onOpenStorageFile: vi.fn().mockResolvedValue(undefined),
    onGrantStorageWrite: vi.fn().mockResolvedValue(undefined),
    onRequestStorageSwitch: vi.fn(),
    settings: defaultSettings,
    setSettings: () => {},
    lang: "en-US",
    ...overrides,
  };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("AppHeader", () => {
  it("renders the app title heading", () => {
    render(<AppHeader {...makeProps()} />, { wrapper: Wrapper });
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("renders the AI Assistant button when onOpenAiAssistant is provided", () => {
    render(<AppHeader {...makeProps({ onOpenAiAssistant: vi.fn() })} />, { wrapper: Wrapper });
    expect(screen.getByRole("button", { name: "AI Assistant" })).toBeInTheDocument();
  });

  it("calls onOpenAiAssistant when the AI Assistant button is clicked", () => {
    const onOpenAiAssistant = vi.fn();
    render(<AppHeader {...makeProps({ onOpenAiAssistant })} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole("button", { name: "AI Assistant" }));
    expect(onOpenAiAssistant).toHaveBeenCalledOnce();
  });

  it("omits the AI Assistant button when onOpenAiAssistant is not provided", () => {
    render(<AppHeader {...makeProps()} />, { wrapper: Wrapper });
    expect(screen.queryByRole("button", { name: "AI Assistant" })).toBeNull();
  });

  it("renders AI Assistant button before Add Task button in DOM order", () => {
    render(<AppHeader {...makeProps({ onOpenAiAssistant: vi.fn() })} />, { wrapper: Wrapper });
    const buttons = screen.getAllByRole("button");
    const aiIdx = buttons.findIndex((b) => b.getAttribute("aria-label") === "AI Assistant");
    const addIdx = buttons.findIndex((b) => b.getAttribute("aria-label") === "Add task");
    expect(aiIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(aiIdx).toBeLessThan(addIdx);
  });

  it("bell badge shows count when bannerItems has entries", () => {
    const makeTask = (id: number): Task =>
      ({
        id,
        taskName: `Task ${id}`,
        assignee: "",
        assigneeEmail: "",
        dueDate: "2099-01-01",
        lastUpdateDate: "2099-01-01",
        priority: "medium",
        blockers: "",
        notes: "",
      }) as unknown as Task;
    const items: AlertableTask[] = [
      { task: makeTask(1), category: "soon", workDaysLeft: 1 },
      { task: makeTask(2), category: "soon", workDaysLeft: 2 },
    ];
    render(<AppHeader {...makeProps({ bannerItems: items })} />, { wrapper: Wrapper });
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
