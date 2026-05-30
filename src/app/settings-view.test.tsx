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
  it("defaults to the Appearance section", () => {
    render(<SettingsView {...makeProps()} />);
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
