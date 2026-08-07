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
    // Appearance is its own always-visible standalone rail entry.
    expect(screen.getByRole("button", { name: t("en-US", "settingsSectionAppearance") })).toBeInTheDocument();
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

  it("clicking a rail entry switches the visible section", () => {
    render(<SettingsView {...makeProps()} />);
    // Localization is an always-visible standalone rail entry.
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionLocalization") }));
    expect(screen.queryByRole("radio", { name: t("en-US", "themeSystem") })).not.toBeInTheDocument();
  });

  it("auto-saves: a control change propagates through onChange", () => {
    const onChange = vi.fn();
    render(<SettingsView {...makeProps({ onChange })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionGeneral") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "popoutReuseWindow") }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ popout: { reuseWindow: true } }));
  });

  it("General folds in the Storage sub-section with a subheading (not Appearance)", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionGeneral") }));
    // Storage sub-section content renders inside General with its subheading.
    expect(screen.getByText("storage-stub")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: t("en-US", "settingsSectionStorage") }),
    ).toBeInTheDocument();
    // Appearance is NO LONGER folded into General — its theme control isn't here.
    expect(screen.queryByRole("radio", { name: t("en-US", "themeSystem") })).toBeNull();
  });

  it("Appearance is its own rail section showing the theme control", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAppearance") }));
    expect(screen.getByRole("radio", { name: t("en-US", "themeSystem") })).toBeInTheDocument();
  });

  it("shows Appearance as a standalone rail entry, but not Storage (Storage folds into General)", () => {
    render(<SettingsView {...makeProps()} />);
    expect(
      screen.queryByRole("button", { name: t("en-US", "settingsSectionStorage") }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: t("en-US", "settingsSectionAppearance") }),
    ).toBeInTheDocument();
  });

  it("shows Communication templates in the rail directly below Templates in expert mode", () => {
    render(<SettingsView {...makeProps({ settings: { ...defaultSettings, expertMode: true }, commTemplatesEnabled: true })} />);
    const railButtons = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
    const templatesIdx = railButtons.indexOf(t("en-US", "settingsSectionTemplates"));
    const commIdx = railButtons.indexOf(t("en-US", "settingsSectionCommTemplates"));
    expect(templatesIdx).toBeGreaterThanOrEqual(0);
    expect(commIdx).toBe(templatesIdx + 1);
  });

  it("hides Communication templates from the rail in non-expert mode", () => {
    render(<SettingsView {...makeProps({ commTemplatesEnabled: true })} />);
    expect(
      screen.queryByRole("button", { name: t("en-US", "settingsSectionCommTemplates") }),
    ).toBeNull();
  });

  it("hides Communication templates from the rail when the comm-templates gate is off", () => {
    render(<SettingsView {...makeProps({ settings: { ...defaultSettings, expertMode: true }, commTemplatesEnabled: false })} />);
    expect(
      screen.queryByRole("button", { name: t("en-US", "settingsSectionCommTemplates") }),
    ).toBeNull();
  });

  it("coerces to General (no blank pane) when the comm-templates gate flips off while it is active", () => {
    const { rerender } = render(
      <SettingsView {...makeProps({ settings: { ...defaultSettings, expertMode: true }, commTemplatesEnabled: true })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionCommTemplates") }));
    // The Turso-backed feature gate flips off while Comm Templates is the active section.
    rerender(
      <SettingsView {...makeProps({ settings: { ...defaultSettings, expertMode: true }, commTemplatesEnabled: false })} />,
    );
    // The pane falls back to General (its folded Storage content visible) instead of going blank.
    expect(screen.getByText("storage-stub")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("en-US", "settingsSectionCommTemplates") }),
    ).toBeNull();
  });

  it("coerces a nextActions deep-link to General (no ghost section) when expert mode is off", () => {
    // A deep-link targets the expert-only Next-actions section while expert mode
    // is OFF — its rail entry is filtered out, so the body must fall back to
    // General rather than render a ghost section with no matching rail item.
    render(
      <SettingsView
        {...makeProps({ requestSection: { id: "nextActions", nonce: 1 } })}
      />,
    );
    // General lands (its folded Storage content visible); no Next-actions rail entry.
    expect(screen.getByText("storage-stub")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("en-US", "settingsSectionNextActions") }),
    ).toBeNull();
  });

  it("a nextActions deep-link lands on Next-actions when expert mode is on", () => {
    const onSectionConsumed = vi.fn();
    render(
      <SettingsView
        {...makeProps({
          settings: { ...defaultSettings, expertMode: true },
          requestSection: { id: "nextActions", nonce: 1 },
          onSectionConsumed,
        })}
      />,
    );
    // The deep-link must actually SELECT the Next-actions section, not merely keep
    // its rail entry present. Assert the section body is shown (its hint text) and
    // that the General/Appearance body (theme radios) is NOT — i.e. we navigated.
    // (Regression guard: a fresh mount initialised `handledNonce` to the live nonce
    // and swallowed the request, leaving the view on General.)
    expect(screen.getByText(t("en-US", "nextActionsHint"))).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: t("en-US", "themeSystem") })).toBeNull();
    // The request is reported consumed so the parent can clear it (no re-jump on
    // a later normal re-open).
    expect(onSectionConsumed).toHaveBeenCalled();
  });

  it("hides the AI children until the AI branch is active", () => {
    render(<SettingsView {...makeProps()} />);
    expect(screen.queryByRole("button", { name: t("en-US", "aiGuidesHeading") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "aiViewsTitle") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "scheduledJobsTitle") })).toBeNull();
  });

  it("reveals the three AI children when AI Assistant is selected", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") }));
    expect(screen.getByRole("button", { name: t("en-US", "aiGuidesHeading") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "aiViewsTitle") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "scheduledJobsTitle") })).toBeInTheDocument();
  });

  it("keeps the branch open while a child is the active section", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiViewsTitle") }));
    // Siblings stay visible, and the child is the one marked current.
    expect(screen.getByRole("button", { name: t("en-US", "aiGuidesHeading") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "aiViewsTitle") })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders each AI child exactly once", () => {
    // The main rail group is defined by EXCLUSION, so a child missing its
    // `!r.parent` filter renders BOTH in the alphabetical main group and under
    // its parent. That is a duplicate, not an absence — an existence assertion
    // cannot catch it, so this counts.
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") }));
    for (const key of ["aiGuidesHeading", "aiViewsTitle", "scheduledJobsTitle"] as const) {
      expect(screen.getAllByRole("button", { name: t("en-US", key) })).toHaveLength(1);
    }
  });

  it("marks the AI parent expanded only while its branch is active", () => {
    render(<SettingsView {...makeProps()} />);
    const ai = () => screen.getByRole("button", { name: t("en-US", "settingsSectionAi") });
    expect(ai()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(ai());
    expect(ai()).toHaveAttribute("aria-expanded", "true");
  });

  it("honours a deep-link straight to a child section", () => {
    render(
      <SettingsView {...makeProps({ requestSection: { id: "scheduledJobs", nonce: 1 } })} />,
    );
    expect(screen.getByRole("button", { name: t("en-US", "scheduledJobsTitle") })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // The branch opened around it, so the siblings are reachable.
    expect(screen.getByRole("button", { name: t("en-US", "aiViewsTitle") })).toBeInTheDocument();
  });

  it("renders the guides section when its rail entry is selected", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiGuidesHeading") }));
    // The shared <h2> supplies the heading, so it appears as a heading, not
    // just as the rail button label.
    expect(
      screen.getByRole("heading", { name: t("en-US", "aiGuidesHeading") }),
    ).toBeInTheDocument();
    // DECISION A: the default settings have AI off, so the section shows the
    // enable hint rather than the guides CRUD. Pins that the gate moved with
    // the content instead of the section rendering unconditionally.
    expect(screen.getByText(t("en-US", "aiEnableHelp"))).toBeInTheDocument();
  });

  it("renders the views section when its rail entry is selected", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiViewsTitle") }));
    expect(screen.getByRole("heading", { name: t("en-US", "aiViewsTitle") })).toBeInTheDocument();
  });

  it("shows the per-view AI scope list once AI is enabled", () => {
    // The gate-off case above would pass against a section that renders
    // nothing at all, so drive the enabled branch too.
    render(
      <SettingsView
        {...makeProps({ settings: { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true } } })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiViewsTitle") }));
    expect(screen.getByText(t("en-US", "aiViewScopeIntro"))).toBeInTheDocument();
  });
});
