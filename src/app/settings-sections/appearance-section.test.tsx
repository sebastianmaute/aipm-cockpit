import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppearanceSection } from "./appearance-section";
import { CiStyleProvider } from "../use-style";
import { STYLE_STORAGE_KEY } from "../style-ci";
import { defaultSettings, type Settings } from "../settings-types";
import { addScheme, loadSchemes } from "../color-schemes";
import { t } from "../i18n";

function renderSection(overrides: Partial<Settings> = {}, initialStyle: "AIPM" | "mockup" | "custom" = "AIPM") {
  // A fresh provider defaults to "custom" (Harbor); set the key explicitly so
  // each case starts from a known style.
  localStorage.setItem(STYLE_STORAGE_KEY, initialStyle);
  const settings = { ...defaultSettings, ...overrides };
  const onChange = vi.fn();
  render(
    <CiStyleProvider>
      <AppearanceSection lang="en-US" settings={settings} onChange={onChange} />
    </CiStyleProvider>,
  );
  return { onChange };
}

beforeEach(() => {
  localStorage.clear();
});

describe("AppearanceSection density control", () => {
  it("renders a Density radiogroup with both options", () => {
    renderSection();
    const group = screen.getByRole("radiogroup", { name: t("en-US", "dashboardDensityLabel") });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: t("en-US", "dashboardDensityComfortable") })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: t("en-US", "dashboardDensityCompact") })).toBeInTheDocument();
  });

  it("marks Comfortable selected by default", () => {
    renderSection();
    expect(screen.getByRole("radio", { name: t("en-US", "dashboardDensityComfortable") })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: t("en-US", "dashboardDensityCompact") })).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange with dashboardDensity=compact when Compact is picked", () => {
    const { onChange } = renderSection();
    fireEvent.click(screen.getByRole("radio", { name: t("en-US", "dashboardDensityCompact") }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dashboardDensity: "compact" }));
  });

  it("reflects a stored compact preference", () => {
    renderSection({ dashboardDensity: "compact" });
    expect(screen.getByRole("radio", { name: t("en-US", "dashboardDensityCompact") })).toHaveAttribute("aria-checked", "true");
  });
});

describe("AppearanceSection scheme control", () => {
  it("renders the scheme selector with the built-ins + AIPM + Mockup", () => {
    renderSection();
    expect(screen.getByLabelText(t("en-US", "schemeAppearanceLabel"))).toBeInTheDocument();
    for (const name of ["Harbor", "Meridian", "Umber"]) {
      expect(screen.getByRole("option", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("option", { name: t("en-US", "styleIcc") })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: t("en-US", "styleMockup") })).toBeInTheDocument();
  });

  it("selecting a built-in scheme switches the style to custom", () => {
    renderSection(); // starts on AIPM
    fireEvent.change(screen.getByLabelText(t("en-US", "schemeAppearanceLabel")), { target: { value: "harbor" } });
    expect(localStorage.getItem(STYLE_STORAGE_KEY)).toBe("custom");
  });

  it("selecting Meridian actually activates Meridian (not the Harbor default)", () => {
    // Regression: setActive must accept built-in ids, else the selection reverts to Harbor.
    renderSection();
    fireEvent.change(screen.getByLabelText(t("en-US", "schemeAppearanceLabel")), { target: { value: "meridian" } });
    expect(localStorage.getItem(STYLE_STORAGE_KEY)).toBe("custom");
    expect(loadSchemes().activeId).toBe("meridian");
  });

  it("selecting Dashboard activates the mockup scheme (style stays custom)", () => {
    // Phase 2: Mockup is a built-in scheme; selecting it routes through
    // selectScheme → activeId "mockup", the style axis stays the constant "custom".
    renderSection();
    fireEvent.change(screen.getByLabelText(t("en-US", "schemeAppearanceLabel")), { target: { value: "mockup" } });
    expect(loadSchemes().activeId).toBe("mockup");
    expect(localStorage.getItem(STYLE_STORAGE_KEY)).toBe("custom");
  });

  it("selecting Mockup disables the Theme control and shows the light-only note", () => {
    // Fresh store → Harbor active (dark-capable) → theme enabled to start.
    renderSection({}, "custom");
    fireEvent.change(screen.getByLabelText(t("en-US", "schemeAppearanceLabel")), { target: { value: "mockup" } });
    expect(screen.getByRole("radiogroup", { name: t("en-US", "theme") })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("radio", { name: t("en-US", "themeLight") })).toBeDisabled();
    expect(screen.getByText(t("en-US", "styleMockupLightOnly"))).toBeInTheDocument();
  });

  it("a dark-capable built-in (Harbor) keeps the Theme control enabled with no light-only note", () => {
    renderSection({}, "custom"); // fresh store → Harbor active (dark-capable)
    expect(screen.getByRole("radiogroup", { name: t("en-US", "theme") })).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("radio", { name: t("en-US", "themeLight") })).not.toBeDisabled();
    expect(screen.queryByText(t("en-US", "styleMockupLightOnly"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "styleCustomLightOnly"))).not.toBeInTheDocument();
  });

  it("when the AIPM scheme is active (dark-capable), the light-only note is absent", () => {
    renderSection(); // starts on AIPM → migrated to activeId "AIPM" (supportsDark)
    expect(screen.queryByText(t("en-US", "styleMockupLightOnly"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "styleCustomLightOnly"))).not.toBeInTheDocument();
  });

  it("keeps the global app-name/footer inputs editable under a built-in scheme (empty branding)", () => {
    // Built-ins (Harbor default) carry branding:{} and are read-only in the editor,
    // so the global app-name/footer inputs must stay present + editable to set them.
    // (Query by id — the always-mounted ColorSchemeEditor also has an "App name"
    // label, so getByLabelText would be ambiguous.)
    const { onChange } = renderSection({}, "custom"); // fresh → Harbor active
    const appName = document.getElementById("branding-appname") as HTMLInputElement | null;
    const footer = document.getElementById("branding-footer-slogan") as HTMLInputElement | null;
    expect(appName).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(appName).not.toBeDisabled();
    fireEvent.change(appName as HTMLInputElement, { target: { value: "My Tracker" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ branding: expect.objectContaining({ slogan: "My Tracker" }) }),
    );
  });

  it("hides the global app-name/footer inputs when a USER scheme is active (editor owns them)", () => {
    // Review HIGH: gate on IDENTITY (built-in) to match the editor. A user scheme
    // (isBuiltin=false) → editor renders its OWN branding inputs, so the global
    // ones must be HIDDEN → exactly ONE "App name" field in every state.
    addScheme("Draft", { "--AIPM-green": "#000000" }, {}); // user scheme active
    renderSection({}, "custom");
    expect(document.getElementById("branding-appname")).toBeNull();
    expect(document.getElementById("branding-footer-slogan")).toBeNull();
    expect(screen.getAllByLabelText(t("en-US", "brandingAppName"))).toHaveLength(1);
  });
});

describe("AppearanceSection Phase 3 (DB-stored schemes)", () => {
  it("shows a 'stored in project database' hint when Turso is configured", () => {
    renderSection({
      integrations: { ...defaultSettings.integrations, turso: { enabled: true, databaseUrl: "libsql://x", authToken: "t" } },
    });
    expect(screen.getByText(t("en-US", "schemeStoredInDb"))).toBeInTheDocument();
  });

  it("hides the hint when no Turso config", () => {
    renderSection();
    expect(screen.queryByText(t("en-US", "schemeStoredInDb"))).not.toBeInTheDocument();
  });
});
