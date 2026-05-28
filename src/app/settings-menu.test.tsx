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
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({
    account: null,
    ready: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
    acquireToken: async () => null,
  }),
}));

const setTheme = vi.hoisted(() => vi.fn());
vi.mock("./use-theme", () => ({
  useTheme: () => ({ theme: "system" as const, setTheme }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...defaultSettings, ...overrides };
}

function makeProps(overrides: Partial<React.ComponentProps<typeof SettingsMenu>> = {}): React.ComponentProps<typeof SettingsMenu> {
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

describe("SettingsMenu theme control", () => {
  it("renders Light/Dark/System and selecting one calls setTheme", () => {
    render(<SettingsMenu {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    expect(screen.getByRole("radio", { name: t("en-US", "themeSystem") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: t("en-US", "themeDark") }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});

describe("SettingsMenu — Integrations section", () => {
  it("renders the M365 master toggle defaulting OFF", () => {
    render(<SettingsMenu {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    const checkbox = screen.getByRole("checkbox", { name: t("en-US", "integrationsM365") });
    expect(checkbox).not.toBeChecked();
  });

  it("renders Outlook sub-toggles disabled when M365 is enabled", () => {
    const settings = makeSettings({
      integrations: {
        m365: {
          enabled: true,
          sharepoint: false,
          outlookContacts: false,
          outlookCalendar: false,
        },
        turso: { enabled: false },
      },
    });
    render(<SettingsMenu {...makeProps({ settings })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    const tursoCheckbox = screen.getByRole("checkbox", { name: t("en-US", "integrationsTurso") });
    expect(tursoCheckbox).toBeDisabled();
  });

  it("SharePoint sub-toggle is interactive (not disabled) when M365 enabled", () => {
    const settings = makeSettings({
      integrations: {
        m365: {
          enabled: true,
          sharepoint: false,
          outlookContacts: false,
          outlookCalendar: false,
        },
        turso: { enabled: false },
      },
    });
    render(<SettingsMenu {...makeProps({ settings })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    const sharepointCheckbox = screen.getByRole("checkbox", { name: t("en-US", "integrationsSharepoint") });
    expect(sharepointCheckbox).not.toBeDisabled();
  });

  it("Outlook contacts and calendar sub-toggles are still disabled (M3/M4 not yet shipped)", () => {
    const settings = makeSettings({
      integrations: {
        m365: {
          enabled: true,
          sharepoint: false,
          outlookContacts: false,
          outlookCalendar: false,
        },
        turso: { enabled: false },
      },
    });
    render(<SettingsMenu {...makeProps({ settings })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    const outlookContactsCheckbox = screen.getByRole("checkbox", { name: t("en-US", "integrationsOutlookContacts") });
    expect(outlookContactsCheckbox).toBeDisabled();
    const outlookCalendarCheckbox = screen.getByRole("checkbox", { name: t("en-US", "integrationsOutlookCalendar") });
    expect(outlookCalendarCheckbox).toBeDisabled();
  });

  it("toggling SharePoint persists settings.integrations.m365.sharepoint", () => {
    const onChange = vi.fn();
    const settings = makeSettings({
      integrations: {
        m365: {
          enabled: true,
          sharepoint: false,
          outlookContacts: false,
          outlookCalendar: false,
        },
        turso: { enabled: false },
      },
    });
    render(<SettingsMenu {...makeProps({ settings, onChange })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    const sharepointCheckbox = screen.getByRole("checkbox", { name: t("en-US", "integrationsSharepoint") });
    fireEvent.click(sharepointCheckbox);
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Settings;
    expect(lastCall.integrations!.m365!.sharepoint).toBe(true);
  });
});
