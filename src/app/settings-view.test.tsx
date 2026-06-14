// src/app/settings-view.test.tsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsView } from "./settings-view";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";

vi.mock("./jira-settings", () => ({ JiraSettingsSection: () => <div>jira-stub</div> }));
vi.mock("./storage-config", () => ({ StorageConfigSection: () => <div>storage-stub</div> }));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: async () => null }),
}));
const setTheme = vi.hoisted(() => vi.fn());
vi.mock("./use-theme", () => ({
  useTheme: () => ({ theme: "system" as const, setTheme }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function makeProps(overrides = {}) {
  return {
    lang: "en-US" as const,
    settings: defaultSettings,
    onChange: vi.fn(),
    onCommitFeatures: vi.fn(),
    storageDescription: null,
    storageReady: false,
    onPickStorageFile: vi.fn().mockResolvedValue(undefined),
    onOpenStorageFile: vi.fn().mockResolvedValue(undefined),
    onGrantStorageWrite: vi.fn().mockResolvedValue(undefined),
    onRequestStorageSwitch: vi.fn(),
    ...overrides,
  };
}

describe("SettingsView", () => {
  it("hides the expert-only sections by default (expert mode off)", () => {
    render(<SettingsView {...makeProps()} />);
    // Appearance is the default landing section and is always visible.
    expect(screen.getByRole("radio", { name: t("en-US", "themeSystem") })).toBeInTheDocument();
    // Expert-only rail entries are absent.
    for (const key of ["settingsSectionMode", "settingsSectionTemplates", "settingsSectionNotifications", "settingsSectionNextActions", "settingsSectionExport"] as const) {
      expect(screen.queryByRole("button", { name: t("en-US", key) })).toBeNull();
    }
  });

  it("expert mode reveals the advanced sections", () => {
    render(<SettingsView {...makeProps({ settings: { ...defaultSettings, expertMode: true } })} />);
    const modeBtn = screen.getByRole("button", { name: t("en-US", "settingsSectionMode") });
    expect(modeBtn).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "settingsSectionNextActions") })).toBeInTheDocument();
    fireEvent.click(modeBtn);
    expect(screen.getByText(/Current mode/)).toBeInTheDocument();
  });

  it("toggling expert mode off propagates expertMode:false through onChange", () => {
    const onChange = vi.fn();
    render(<SettingsView {...makeProps({ settings: { ...defaultSettings, expertMode: true }, onChange })} />);
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "settingsExpertMode") }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ expertMode: false }));
  });

  it("clicking Appearance rail entry shows the Appearance section", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAppearance") }));
    expect(screen.getByRole("radio", { name: t("en-US", "themeSystem") })).toBeInTheDocument();
  });

  it("clicking a rail entry switches the visible section", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionStorage") }));
    expect(screen.getByText("storage-stub")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: t("en-US", "themeSystem") })).not.toBeInTheDocument();
  });

  it("auto-saves: a control change propagates through onChange", () => {
    const onChange = vi.fn();
    render(<SettingsView {...makeProps({ onChange })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionGeneral") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "popoutReuseWindow") }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ popout: { reuseWindow: true } }));
  });
});
