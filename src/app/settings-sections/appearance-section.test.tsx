import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppearanceSection } from "./appearance-section";
import { CiStyleProvider } from "../use-style";
import { STYLE_STORAGE_KEY } from "../style-ci";
import { defaultSettings, type Settings } from "../settings-types";
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

  it("selecting Dashboard persists mockup to localStorage", () => {
    renderSection();
    fireEvent.change(screen.getByLabelText(t("en-US", "schemeAppearanceLabel")), { target: { value: "mockup" } });
    expect(localStorage.getItem(STYLE_STORAGE_KEY)).toBe("mockup");
  });

  it("mockup disables the Theme control and shows the light-only note", () => {
    renderSection({}, "mockup");
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

  it("when style is AIPM, the light-only note is absent", () => {
    renderSection();
    expect(screen.queryByText(t("en-US", "styleMockupLightOnly"))).not.toBeInTheDocument();
  });
});
