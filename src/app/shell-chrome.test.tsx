import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type React from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { buildShellChrome, type ShellChromeDeps } from "./shell-chrome";
import { defaultSettings } from "./settings-types";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

function makeDeps(overrides: Partial<ShellChromeDeps> = {}): ShellChromeDeps {
  return {
    handleCancelEdit: vi.fn(),
    setTaskModalOpen: vi.fn(),
    showToast: vi.fn(),
    handleCommand: vi.fn(),
    storageDescription: null,
    storageOk: true,
    onPickStorageFile: vi.fn().mockResolvedValue(undefined),
    onOpenStorageFile: vi.fn().mockResolvedValue(undefined),
    onGrantWriteAccess: vi.fn().mockResolvedValue(undefined),
    onRequestStorageSwitch: vi.fn(),
    setSettings: vi.fn(),
    settings: defaultSettings,
    additionalTimezones: [],
    projectSwitcher: undefined,
    lang: "en-US",
    activeTab: "dashboard",
    nowCount: 0,
    setActiveTab: vi.fn(),
    migrateCurrentProjectToTurso: vi.fn(),
    openPopoutWindow: vi.fn(),
    requestChat: vi.fn(),
    projectTemplates: [],
    handleSaveTemplate: vi.fn(),
    handleApplyTemplate: vi.fn(),
    undoControl: null,
    ...overrides,
  };
}

describe("buildShellChrome — AI assistant button gate", () => {
  it("omits the AI Assistant button from the classic AppHeader when AI is disabled", () => {
    const { appHeaderEl } = buildShellChrome(makeDeps());
    render(<>{appHeaderEl}</>, { wrapper: Wrapper });
    expect(screen.queryByRole("button", { name: "AI Assistant" })).toBeNull();
  });

  it("renders the AI Assistant button in the classic AppHeader when AI is enabled with a key", () => {
    const { appHeaderEl } = buildShellChrome(
      makeDeps({ settings: { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true, apiKey: "test-key" } } }),
    );
    render(<>{appHeaderEl}</>, { wrapper: Wrapper });
    expect(screen.getByRole("button", { name: "AI Assistant" })).toBeInTheDocument();
  });

  it("omits the Ask Claude pill from the classic AppHeader when AI is disabled", () => {
    const { appHeaderEl } = buildShellChrome(makeDeps());
    render(<>{appHeaderEl}</>, { wrapper: Wrapper });
    expect(screen.queryByRole("button", { name: "Ask Claude" })).toBeNull();
  });

  it("renders the Ask Claude pill in the classic AppHeader when AI is enabled with a key", () => {
    const { appHeaderEl } = buildShellChrome(
      makeDeps({ settings: { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true, apiKey: "test-key" } } }),
    );
    render(<>{appHeaderEl}</>, { wrapper: Wrapper });
    expect(screen.getByRole("button", { name: "Ask Claude" })).toBeInTheDocument();
  });
});
