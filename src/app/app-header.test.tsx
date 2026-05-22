import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type React from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { WorkspaceProvider } from "./workspace-context";
import { AppHeader } from "./app-header";
import type { AppHeaderProps } from "./app-header";
import type { AlertableTask } from "./due-dates";
import type { Task } from "./types";

vi.mock("./use-settings", () => ({
  useSettings: vi.fn(() => ({
    settings: {
      lang: "en-US",
      jira: { enabled: false, siteUrl: "", email: "", apiToken: "", projectKey: "", issueTypes: [] },
      ai: { consentAccepted: false, provider: "none" },
      notifications: { banner: { enabled: false, thresholdWorkDays: 3 }, popup: { enabled: false, thresholdWorkDays: 3 } },
      holidayCountries: [],
    },
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US" as const,
  })),
}));

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
