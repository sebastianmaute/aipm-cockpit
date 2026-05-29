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
