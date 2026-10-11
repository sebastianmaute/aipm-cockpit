import { describe, expect, it } from "vitest";
import { t, tPlural, type TranslationKey } from "./i18n";
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
  it("uses the AI PM Cockpit brand name", () => {
    expect(t("en-US", "appTitle")).toBe("AI PM Cockpit");
    expect(t("en-US", "sidebarBrandSubtitle")).toBe("PROJECT MANAGEMENT TRACKER");
    expect(t("de", "appTitle")).toBe("AI PM Cockpit");
    expect(t("de", "sidebarBrandSubtitle")).toBe("PROJECT MANAGEMENT TRACKER");
  });

  it("has no remaining 'List of Open Points' brand strings", () => {
    for (const lang of ["en-US", "en-GB", "de"] as const) {
      expect(t(lang, "appTitle")).not.toMatch(/list of open points/i);
      expect(t(lang, "appSubtitle")).not.toMatch(/list of open points/i);
    }
  });
});

// §466: the "Health ratings & forecasts" Help entry used to promise a
// burn-down FORECAST ("along with a burn-down forecast" / "sowie eine
// Burn-down-Prognose") that `burndown-chart.tsx` never draws -- it renders a
// planned line, an actual line and a today marker only, per
// `computeBurndownSeries` in budget-burndown.ts. Pin the absence of that
// promise, in both languages, and a positive observable (the corrected
// wording) so this cannot pass on an emptied string.
//
// Review follow-up on d1eab4aa: the reworded body then claimed the chart
// "tracks planned spend against actual spend to date", but
// `computeBurndownSeries` plots plannedRemaining/actualRemaining -- REMAINING
// budget, not cumulative spend. Pin the absence of that spend framing too,
// and a positive observable for the remaining-budget wording.
describe("help — burn-down health entry (§466)", () => {
  it("EN body no longer promises a burn-down forecast", () => {
    const body = t("en-US", "helpAutomatedHealthBody");
    expect(body).not.toMatch(/burn-down forecast/i);
    expect(body).toContain("burn-down chart");
  });

  it("EN body describes the burn-down as remaining budget, not spend", () => {
    const body = t("en-US", "helpAutomatedHealthBody");
    expect(body).not.toMatch(/tracks planned spend against actual spend/i);
    expect(body).toMatch(/remaining budget/i);
  });

  it("DE body no longer promises a Burn-down-Prognose", () => {
    // Read the DE dict directly -- `t("de", ...)` silently falls back to
    // en-US unless `loadI18n("de")` has resolved first, which would let a
    // reverted/untranslated DE string pass by reading the English body.
    const body = de["helpAutomatedHealthBody"];
    expect(body).not.toMatch(/Burn-down-Prognose/i);
    expect(body).toContain("Burn-down-Diagramm");
  });

  it("DE body describes the burn-down as remaining budget, not spend", () => {
    const body = de["helpAutomatedHealthBody"];
    expect(body).not.toMatch(/geplanten Verbrauch dem bisherigen Ist-Verbrauch/i);
    expect(body).toMatch(/Restbudget/i);
  });
});

describe("t() placeholder substitution", () => {
  it("does not substitute a placeholder that an earlier argument brought in", () => {
    expect(t("en-US", "wbsPlanPieceNamed", "Phase {1}", 2, "Build API")).toBe("Phase {1} (piece 2 of Build API)");
  });

  it("keeps $ patterns in an argument literal", () => {
    expect(t("en-US", "wbsPlanPieceNamed", "A $& $` $' $1", 2, "B")).toBe("A $& $` $' $1 (piece 2 of B)");
  });

  // The most likely real input, in a one-value message and in a last slot:
  // the old string replacement turned "$$" into "$" in any slot.
  it("keeps $$ in an argument literal, in any slot", () => {
    expect(t("en-US", "wbsPlanMinutes", "US$$5")).toBe("US$$5 min");
    expect(t("en-US", "wbsPlanPieceNamed", "A", 2, "Cost $$")).toBe("A (piece 2 of Cost $$)");
  });

  it("leaves a placeholder that has no argument as written", () => {
    expect(t("en-US", "wbsPlanPieceNamed", "A")).toBe("A (piece {1} of {2})");
    expect(t("en-US", "wbsPlanPieceNamed")).toBe("{0} (piece {1} of {2})");
  });

  // Kept from the sequential version: a kanban card renders `priorityLabel`
  // for a priority value outside the dictionary.
  it("returns the lookup unchanged when called without arguments, even for an unknown key", () => {
    expect(t("en-US", "noSuchKeyForThisTest" as TranslationKey)).toBeUndefined();
  });

  it("renders numbers and ignores extra arguments", () => {
    expect(t("en-US", "wbsPlanMinutes", 0, "extra")).toBe("0 min");
  });
});

describe("work-breakdown notices name their real cause (§3)", () => {
  // A link on unchanged rows can go stale through a cycle via a third row, and
  // the load hold also closes the instruction dialog, before any proposal. The
  // stale text avoids "depend on": the preview calls links "Dependencies".
  it("EN", () => {
    expect(t("en-US", "wbsPlanStaleSkipped", 2)).toBe("2 changes were skipped because tasks they would change were edited in the meantime.");
    expect(t("en-US", "wbsPlanStaleSkippedOne")).toBe("1 change was skipped because tasks it would change were edited in the meantime.");
    expect(t("en-US", "wbsPlanClosedByLoad")).toBe("The project is loading, so Optimize with AI was closed.");
  });

  it("DE", () => {
    expect(de.wbsPlanStaleSkipped).toBe(
      "{0} Änderungen wurden übersprungen, weil sich Aufgaben, die sie ändern würden, inzwischen geändert haben.",
    );
    expect(de.wbsPlanStaleSkippedOne).toBe(
      "1 Änderung wurde übersprungen, weil sich Aufgaben, die sie ändern würde, inzwischen geändert haben.",
    );
    expect(de.wbsPlanClosedByLoad).toBe("Das Projekt wird geladen, daher wurde „Mit KI optimieren“ geschlossen.");
  });
});

describe("the allocation plan's combined applied-and-skipped notice", () => {
  it("has a plural and a singular form in EN and DE", () => {
    expect(tPlural("en-US", "allocPlanAppliedSkipped", 2, 3, 2)).toBe(
      "Allocation changes applied: 3. 2 changes were skipped because the plan changed.",
    );
    expect(tPlural("en-US", "allocPlanAppliedSkipped", 1, 3, 1)).toBe(
      "Allocation changes applied: 3. 1 change was skipped because the plan changed.",
    );
    expect(de.allocPlanAppliedSkipped).toBe(
      "Angewendete Planungsänderungen: {0}. {1} Änderungen wurden übersprungen, weil sich die Planung geändert hat.",
    );
    expect(de.allocPlanAppliedSkippedOne).toBe(
      "Angewendete Planungsänderungen: {0}. 1 Änderung wurde übersprungen, weil sich die Planung geändert hat.",
    );
  });
});
