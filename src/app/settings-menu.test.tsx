import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { defaultSettings, SettingsMenu, type Settings } from "./settings-menu";
import { t } from "./i18n";

vi.mock("./jira-settings", () => ({
  JiraSettingsSection: () => null,
}));
vi.mock("./storage-config", () => ({
  StorageConfigSection: () => null,
}));

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...defaultSettings, ...overrides };
}

function makeProps(overrides: Partial<ReturnType<typeof makeProps>> = {}) {
  return {
    settings: makeSettings(),
    onChange: vi.fn(),
    storageDescription: null,
    storageReady: false,
    onPickStorageFile: vi.fn().mockResolvedValue(undefined),
    onOpenStorageFile: vi.fn().mockResolvedValue(undefined),
    onGrantStorageWrite: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("defaultSettings", () => {
  it("popout.reuseWindow defaults to false", () => {
    expect(defaultSettings.popout.reuseWindow).toBe(false);
  });
});

describe("SettingsMenu popout toggle", () => {
  it("renders 'Reuse popout window' toggle in settings panel", () => {
    render(<SettingsMenu {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));

    expect(
      screen.getByRole("checkbox", { name: t("en-US", "popoutReuseWindow") }),
    ).toBeInTheDocument();
  });

  it("toggling calls onChange with updated popout.reuseWindow value", () => {
    const onChange = vi.fn();
    render(<SettingsMenu {...makeProps({ onChange })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));

    fireEvent.click(
      screen.getByRole("checkbox", { name: t("en-US", "popoutReuseWindow") }),
    );

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        popout: { reuseWindow: true },
      }),
    );
  });
});
