import { describe, it, expect } from "vitest";
import { VIEW_CALLOUTS } from "./view-callouts";
import { HELP_ENTRIES } from "./help-content";
import { t } from "./i18n";

describe("VIEW_CALLOUTS", () => {
  const conceptIds = new Set(HELP_ENTRIES.filter((e) => e.group === "concepts").map((e) => e.id));

  it("every conceptId resolves to a real concept entry", () => {
    for (const [view, callout] of Object.entries(VIEW_CALLOUTS)) {
      expect(conceptIds.has(callout.conceptId), `${view} → ${callout.conceptId}`).toBe(true);
    }
  });

  it("every textKey resolves to non-empty EN text", () => {
    for (const [view, callout] of Object.entries(VIEW_CALLOUTS)) {
      expect(t("en-US", callout.textKey).length, `${view} → ${callout.textKey}`).toBeGreaterThan(0);
    }
  });
});
