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
    onRequestStorageSwitch: vi.fn(),
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
  const m365EnabledIntegrations = {
    m365: {
      enabled: true,
      sharepoint: false,
      outlookContacts: false,
      outlookCalendar: false,
    },
    turso: { enabled: false },
  } as const;

  it("renders the M365 master toggle defaulting OFF", () => {
    render(<SettingsMenu {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    const checkbox = screen.getByRole("checkbox", { name: t("en-US", "integrationsM365") });
    expect(checkbox).not.toBeChecked();
  });

  it("Turso toggle is interactive and persists integrations.turso.enabled", () => {
    const onChange = vi.fn();
    render(<SettingsMenu {...makeProps({ onChange })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    const turso = screen.getByRole("checkbox", { name: t("en-US", "integrationsTurso") });
    expect(turso).not.toBeDisabled();
    fireEvent.click(turso);
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Settings;
    expect(lastCall.integrations?.turso?.enabled).toBe(true);
  });

  it("shows Turso URL + token inputs when enabled", () => {
    const settings = makeSettings({ integrations: { turso: { enabled: true } } });
    render(<SettingsMenu {...makeProps({ settings })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    expect(screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder"))).toBeInTheDocument();
    expect(screen.getByPlaceholderText(t("en-US", "integrationsTursoTokenPlaceholder"))).toBeInTheDocument();
  });

  it("SharePoint sub-toggle is interactive (not disabled) when M365 enabled", () => {
    const settings = makeSettings({ integrations: m365EnabledIntegrations });
    render(<SettingsMenu {...makeProps({ settings })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    const sharepointCheckbox = screen.getByRole("checkbox", { name: t("en-US", "integrationsSharepoint") });
    expect(sharepointCheckbox).not.toBeDisabled();
  });

  it("Outlook contacts sub-toggle is interactive (M3 shipped)", () => {
    const settings = makeSettings({ integrations: m365EnabledIntegrations });
    render(<SettingsMenu {...makeProps({ settings })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    const outlookContactsCheckbox = screen.getByRole("checkbox", { name: t("en-US", "integrationsOutlookContacts") });
    expect(outlookContactsCheckbox).not.toBeDisabled();
  });

  it("Outlook calendar sub-toggle is interactive (M4 shipped)", () => {
    const settings = makeSettings({ integrations: m365EnabledIntegrations });
    render(<SettingsMenu {...makeProps({ settings })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    const cal = screen.getByRole("checkbox", { name: t("en-US", "integrationsOutlookCalendar") });
    expect(cal).not.toBeDisabled();
  });

  it("toggling Outlook calendar persists settings.integrations.m365.outlookCalendar", () => {
    const onChange = vi.fn();
    const settings = makeSettings({ integrations: m365EnabledIntegrations });
    render(<SettingsMenu {...makeProps({ settings, onChange })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "integrationsOutlookCalendar") }));
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Settings;
    expect(lastCall.integrations?.m365?.outlookCalendar).toBe(true);
  });

  it("toggling Outlook contacts persists settings.integrations.m365.outlookContacts", () => {
    const onChange = vi.fn();
    const settings = makeSettings({ integrations: m365EnabledIntegrations });
    render(<SettingsMenu {...makeProps({ settings, onChange })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "integrationsOutlookContacts") }));
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Settings;
    expect(lastCall.integrations?.m365?.outlookContacts).toBe(true);
  });

  it("toggling SharePoint persists settings.integrations.m365.sharepoint", () => {
    const onChange = vi.fn();
    const settings = makeSettings({ integrations: m365EnabledIntegrations });
    render(<SettingsMenu {...makeProps({ settings, onChange })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    const sharepointCheckbox = screen.getByRole("checkbox", { name: t("en-US", "integrationsSharepoint") });
    fireEvent.click(sharepointCheckbox);
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Settings;
    expect(lastCall.integrations?.m365?.sharepoint).toBe(true);
  });
});
