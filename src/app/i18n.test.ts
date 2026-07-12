import { describe, expect, it } from "vitest";
import { t, type TranslationKey } from "./i18n";
import { de } from "./i18n.de";

const NEW_KEYS: TranslationKey[] = [
  "navGroupOverview", "navGroupPlan", "navGroupRegisters", "navGroupSystem",
  "navOpenPoints",
  "layout", "layoutModern", "layoutClassic", "layoutTooltip",
  "sidebarBrandSubtitle", "sidebarCollapse", "sidebarExpand",
];

describe("modern-layout i18n keys", () => {
  it("resolve in en-US", () => {
    for (const k of NEW_KEYS) expect(t("en-US", k)).toBeTruthy();
  });
  it("exist in the German dictionary", () => {
    for (const k of NEW_KEYS) expect(de[k]).toBeTruthy();
  });
});

describe("settings-section rail labels", () => {
  it("exposes the 8 settings section labels in en-US", () => {
    for (const k of [
      "settingsSectionAppearance","settingsSectionLocalization","settingsSectionGeneral",
      "settingsSectionNotifications","settingsSectionAi","settingsSectionJira",
      "settingsSectionStorage","settingsSectionIntegrations",
    ] as const) {
      expect(t("en-US", k)).toBeTruthy();
    }
  });
});

describe("RACI legend", () => {
  it("RACI legend uses the parenthesized-initial style", () => {
    expect(t("en-US", "raciLegend")).toBe(
      "(R)esponsible, (A)ccountable, (C)onsulted, (I)nformed",
    );
    expect(t("de", "raciLegend")).toContain("(R)");
    expect(t("de", "raciLegend")).toContain("(A)");
  });
});

describe("tabChat rename", () => {
  it("tabChat is 'AI Assistant' in en-US", () => {
    expect(t("en-US", "tabChat")).toBe("AI Assistant");
  });
  it("tabChat is 'KI-Assistent' in the German dictionary", () => {
    expect(de["tabChat"]).toBe("KI-Assistent");
  });
});

describe("brand name", () => {
  it("uses the AIPM Cockpit brand name", () => {
    expect(t("en-US", "appTitle")).toBe("AIPM Cockpit");
    expect(t("en-US", "sidebarBrandSubtitle")).toBe("PROJECT MANAGEMENT TRACKER");
    expect(t("de", "appTitle")).toBe("AIPM Cockpit");
    expect(t("de", "sidebarBrandSubtitle")).toBe("PROJECT MANAGEMENT TRACKER");
  });

  it("has no remaining 'List of Open Points' brand strings", () => {
    for (const lang of ["en-US", "en-GB", "de"] as const) {
      expect(t(lang, "appTitle")).not.toMatch(/list of open points/i);
      expect(t(lang, "appSubtitle")).not.toMatch(/list of open points/i);
    }
  });
});
