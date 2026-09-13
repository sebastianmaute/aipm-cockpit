import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Sidebar } from "./sidebar";
import { t } from "./i18n";
import { defaultSettings, type Settings } from "./settings-types";

vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));

import { useSettings } from "./use-settings";
const mockUseSettings = useSettings as ReturnType<typeof vi.fn>;

function stubSettings(settings: Settings) {
  mockUseSettings.mockReturnValue({
    settings,
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US" as const,
  });
}

describe("Sidebar", () => {
  beforeEach(() => {
    stubSettings(defaultSettings);
  });

  const base = {
    lang: "en-US" as const,
    activeView: "open-points" as const,
    onNavigate: () => {},
    collapsed: false,
    onToggleCollapsed: () => {},
    version: "v0.29.0",
    onShowVersion: () => {},
    mode: "advanced" as const,
  };

  it("renders the brand subtitle and version with the Version label", () => {
    render(<Sidebar {...base} />);
    expect(screen.getByText("PROJECT MANAGEMENT TRACKER")).toBeTruthy();
    expect(screen.getByText("Version v0.29.0")).toBeTruthy();
  });

  it("fires onShowVersion when the version line is clicked", () => {
    const onShowVersion = vi.fn();
    render(<Sidebar {...base} onShowVersion={onShowVersion} />);
    fireEvent.click(screen.getByText("Version v0.29.0"));
    expect(onShowVersion).toHaveBeenCalledTimes(1);
  });

  it("toggles collapse when the collapse button is clicked", () => {
    const onToggleCollapsed = vi.fn();
    render(<Sidebar {...base} onToggleCollapsed={onToggleCollapsed} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onToggleCollapsed).toHaveBeenCalled();
  });

  it("hides the brand subtitle when collapsed", () => {
    render(<Sidebar {...base} collapsed={true} />);
    expect(screen.queryByText("PROJECT MANAGEMENT TRACKER")).toBeNull();
  });

  it("shows the current mode pill in the sidebar footer when expanded", () => {
    render(<Sidebar {...base} mode="modular" collapsed={false} />);
    expect(screen.getByTestId("sidebar-mode-badge")).toHaveTextContent(t("en-US", "modeModular"));
  });

  it("hides the mode pill when collapsed to the icon rail", () => {
    render(<Sidebar {...base} mode="advanced" collapsed={true} />);
    expect(screen.queryByTestId("sidebar-mode-badge")).not.toBeInTheDocument();
  });

  describe("logo", () => {
    beforeEach(() => {
      stubSettings(defaultSettings);
    });

    it("uses the AI PM Cockpit banner as the default, without the old invert filter", () => {
      render(<Sidebar {...base} />);
      const img = screen.getByRole("img", { name: t("en-US", "appTitle") });
      expect(img).toHaveAttribute("src", "/ai-pm-cockpit-banner.svg");
      expect(img.className).not.toMatch(/brightness-0/);
      expect(img.className).not.toMatch(/(^|\s)invert(\s|$)/);
    });

    it("uses the custom branding logo when one is set", () => {
      stubSettings({
        ...defaultSettings,
        branding: { ...defaultSettings.branding, logo: "data:image/png;base64,custom" },
      });
      render(<Sidebar {...base} />);
      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "data:image/png;base64,custom");
    });
  });
});
