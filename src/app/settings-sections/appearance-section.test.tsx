import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppearanceSection } from "./appearance-section";
import { CiStyleProvider } from "../use-style";
import { STYLE_STORAGE_KEY } from "../style-ci";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";

function renderSection(overrides: Partial<Settings> = {}, initialStyle: "AIPM" | "mockup" = "AIPM") {
  if (initialStyle === "mockup") {
    localStorage.setItem(STYLE_STORAGE_KEY, "mockup");
  }
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

describe("AppearanceSection style control", () => {
  it("renders the Style radiogroup with the accessible name and both options", () => {
    renderSection();
    const group = screen.getByRole("radiogroup", { name: t("en-US", "styleLabel") });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: t("en-US", "styleIcc") })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: t("en-US", "styleMockup") })).toBeInTheDocument();
  });

  it("marks Acme selected by default", () => {
    renderSection();
    expect(screen.getByRole("radio", { name: t("en-US", "styleIcc") })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: t("en-US", "styleMockup") })).toHaveAttribute("aria-checked", "false");
  });

  it("selecting Dashboard persists mockup to localStorage", () => {
    renderSection();
    fireEvent.click(screen.getByRole("radio", { name: t("en-US", "styleMockup") }));
    expect(localStorage.getItem(STYLE_STORAGE_KEY)).toBe("mockup");
  });

  it("when style is mockup, the Theme radiogroup is disabled", () => {
    renderSection({}, "mockup");
    const themeGroup = screen.getByRole("radiogroup", { name: t("en-US", "theme") });
    expect(themeGroup).toHaveAttribute("aria-disabled", "true");
  });

  it("when style is mockup, individual theme buttons are disabled", () => {
    renderSection({}, "mockup");
    expect(screen.getByRole("radio", { name: t("en-US", "themeLight") })).toBeDisabled();
    expect(screen.getByRole("radio", { name: t("en-US", "themeDark") })).toBeDisabled();
    expect(screen.getByRole("radio", { name: t("en-US", "themeSystem") })).toBeDisabled();
  });

  it("when style is mockup, renders the light-only note", () => {
    renderSection({}, "mockup");
    expect(screen.getByText(t("en-US", "styleMockupLightOnly"))).toBeInTheDocument();
  });

  it("when style is AIPM, the light-only note is absent", () => {
    renderSection();
    expect(screen.queryByText(t("en-US", "styleMockupLightOnly"))).not.toBeInTheDocument();
  });

  it("switching back from mockup to Acme re-enables the theme control and removes the note", () => {
    renderSection({}, "mockup");
    // Starts disabled in mockup.
    expect(screen.getByRole("radiogroup", { name: t("en-US", "theme") })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(t("en-US", "styleMockupLightOnly"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: t("en-US", "styleIcc") }));

    expect(screen.getByRole("radio", { name: t("en-US", "themeLight") })).not.toBeDisabled();
    expect(screen.getByRole("radio", { name: t("en-US", "themeDark") })).not.toBeDisabled();
    expect(screen.getByRole("radio", { name: t("en-US", "themeSystem") })).not.toBeDisabled();
    expect(screen.queryByText(t("en-US", "styleMockupLightOnly"))).not.toBeInTheDocument();
  });
});
