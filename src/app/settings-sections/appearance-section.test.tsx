import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppearanceSection } from "./appearance-section";
import { CiStyleProvider } from "../use-style";
import { STYLE_STORAGE_KEY } from "../style-ci";
import { defaultSettings, type Settings } from "../settings-types";
import { addScheme, loadSchemes, setActive } from "../color-schemes";
import { t } from "../i18n";
import { expectRowUniqueNames } from "../../test/row-unique-names";

function renderSection(
  overrides: Partial<Settings> = {},
  initialStyle: "AIPM" | "mockup" | "custom" = "AIPM",
) {
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

describe("AppearanceSection 'I am' resource", () => {
  it("no longer renders the self-resource picker (it moved to General)", () => {
    // Rendered WITH a stored id, so a surviving select would still be found by
    // its label even if the directory list were empty.
    renderSection({ selfResourceId: 5 });
    expect(screen.queryByLabelText(t("en-US", "selfResourceLabel"))).toBeNull();
    expect(screen.queryByText(t("en-US", "selfResourceLabel"))).toBeNull();
  });
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

describe("AppearanceSection help reading level", () => {
  it("renders all three levels", () => {
    renderSection();
    expect(screen.getByRole("radiogroup", { name: t("en-US", "helpReadingLevelLabel") })).toBeInTheDocument();
    for (const key of ["helpReadingLevelGuided", "helpReadingLevelStandard", "helpReadingLevelExpert"] as const) {
      expect(screen.getByRole("radio", { name: t("en-US", key) })).toBeInTheDocument();
    }
  });

  it("marks Standard selected by default", () => {
    renderSection();
    expect(screen.getByRole("radio", { name: t("en-US", "helpReadingLevelStandard") })).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with the picked level", () => {
    const { onChange } = renderSection();
    fireEvent.click(screen.getByRole("radio", { name: t("en-US", "helpReadingLevelGuided") }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ helpReadingLevel: "guided" }));
  });

  it("reflects a stored expert preference", () => {
    renderSection({ helpReadingLevel: "expert" });
    expect(screen.getByRole("radio", { name: t("en-US", "helpReadingLevelExpert") })).toHaveAttribute("aria-checked", "true");
  });
});

describe("AppearanceSection scheme control", () => {
  it("renders the scheme selector with the canonical built-ins (no AIPM/Mockup by default)", () => {
    renderSection();
    expect(screen.getByLabelText(t("en-US", "schemeAppearanceLabel"))).toBeInTheDocument();
    for (const name of ["Harbor", "Meridian", "Umber"]) {
      expect(screen.getByRole("option", { name })).toBeInTheDocument();
    }
    // AIPM + Dashboard are shipped importable themes now, not built-in options.
    expect(screen.queryByRole("option", { name: "AIPM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Dashboard" })).not.toBeInTheDocument();
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

  it("a light-only scheme disables the Theme control and shows the light-only note", () => {
    // No built-in is light-only anymore; seed a light-only USER scheme (it becomes
    // active) → pinsLight → theme control disabled + the generic light-only note.
    addScheme("LightOnly", { "--surface": "#eeeeee" }, {}); // → u-1, active
    renderSection({}, "custom");
    expect(screen.getByRole("radiogroup", { name: t("en-US", "theme") })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("radio", { name: t("en-US", "themeLight") })).toBeDisabled();
    expect(screen.getByText(t("en-US", "styleCustomLightOnly"))).toBeInTheDocument();
  });

  it("a dark-capable built-in (Harbor) keeps the Theme control enabled with no light-only note", () => {
    // Beacon (light-only) is the default now, so activate Harbor explicitly
    // rather than relying on what a fresh store happens to default to.
    setActive("harbor");
    renderSection({}, "custom");
    expect(screen.getByRole("radiogroup", { name: t("en-US", "theme") })).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("radio", { name: t("en-US", "themeLight") })).not.toBeDisabled();
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
    addScheme("Draft", { "--ui-green": "#000000" }, {}); // user scheme active
    renderSection({}, "custom");
    expect(document.getElementById("branding-appname")).toBeNull();
    expect(document.getElementById("branding-footer-slogan")).toBeNull();
    expect(screen.getAllByLabelText(t("en-US", "brandingAppName"))).toHaveLength(1);
  });

  it("offers a start-window logo row with a row-unique remove label", () => {
    // Seed a SECOND branding image alongside startLogo (logo) so both Remove
    // buttons render together — a fixture carrying only one of the three image
    // rows can never exercise the "row-unique" claim below, since a single
    // Remove button cannot collide with itself.
    renderSection(
      {
        branding: {
          logo: "data:image/png;base64,QUJD",
          startLogo: "data:image/png;base64,QUJD",
        },
      },
      "custom", // fresh → Harbor (built-in) active, so the global branding block shows
    );
    expect(
      screen.getByRole("button", { name: t("en-US", "brandingStartLogoChoose") }),
    ).toBeInTheDocument();
    // Three branding image rows share one Remove verb, so each name is qualified
    // (WCAG 2.4.6 — axe reports MISSING names, never DUPLICATE ones).
    expect(
      screen.getByRole("button", {
        name: `${t("en-US", "remove")} – ${t("en-US", "brandingStartLogo")}`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `${t("en-US", "remove")} – ${t("en-US", "brandingLogo")}`,
      }),
    ).toBeInTheDocument();
    expectRowUniqueNames({ minRows: 2 });
  });

  it("keeps the start-logo row reachable under a USER scheme, where the other four hide", () => {
    // NO scheme can own startLogo (mergeAppliedBranding overwrites only the other
    // four), so this block is its ONLY editor. Gating it with the scheme-owned
    // rows made the field unreachable for anyone running a user scheme — the
    // other four merely MOVE to the scheme editor, this one vanished outright.
    addScheme("Draft", { "--ui-green": "#000000" }, {}); // user scheme active
    renderSection({ branding: { startLogo: "data:image/png;base64,QUJD" } }, "custom");
    expect(
      screen.getByRole("button", { name: t("en-US", "brandingStartLogoChoose") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `${t("en-US", "remove")} – ${t("en-US", "brandingStartLogo")}`,
      }),
    ).toBeInTheDocument();
    // The scheme-owned rows still behave as they did: hidden here, because the
    // editor renders them. Asserted on the two whose global inputs carry ids.
    expect(document.getElementById("branding-appname")).toBeNull();
    expect(document.getElementById("branding-footer-slogan")).toBeNull();
    expect(
      screen.queryByRole("button", { name: t("en-US", "brandingLogoChoose") }),
    ).toBeNull();
  });

  it("keeps the start logo when the sidebar logo is removed", () => {
    // setBranding's presence check drops the WHOLE blob when it thinks nothing
    // is left, so a startLogo missing from that check dies with the sidebar logo.
    const START = "data:image/png;base64,QUJD";
    const { onChange } = renderSection(
      { branding: { logo: "data:image/png;base64,WFla", startLogo: START } },
      "custom",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: `${t("en-US", "remove")} – ${t("en-US", "brandingLogo")}`,
      }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ branding: expect.objectContaining({ startLogo: START }) }),
    );
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
