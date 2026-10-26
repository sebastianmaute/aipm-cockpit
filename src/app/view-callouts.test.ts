import { describe, it, expect } from "vitest";
import { VIEW_CALLOUTS } from "./view-callouts";
import { HELP_ENTRIES } from "./help-content";
import { t } from "./i18n";
import { HELP_VIDEO_CATALOGUE } from "./help-videos";

describe("VIEW_CALLOUTS", () => {
  const conceptIds = new Set(HELP_ENTRIES.filter((e) => e.group === "concepts").map((e) => e.id));

  it("every conceptId resolves to a real concept entry", () => {
    for (const [view, callout] of Object.entries(VIEW_CALLOUTS)) {
      expect(conceptIds.has(callout.conceptId), `${view} → ${callout.conceptId}`).toBe(true);
    }
  });

  // Every banner links the video of its own view; a view added without one should be a decision, not an oversight.
  it("every callout links a published video guide", () => {
    for (const [view, callout] of Object.entries(VIEW_CALLOUTS)) {
      expect(callout.videoId, view).toBeDefined();
      expect(HELP_VIDEO_CATALOGUE[callout.videoId!], `${view} → ${callout.videoId}`).toBeDefined();
    }
  });

  it("every textKey resolves to non-empty EN text", () => {
    for (const [view, callout] of Object.entries(VIEW_CALLOUTS)) {
      expect(t("en-US", callout.textKey).length, `${view} → ${callout.textKey}`).toBeGreaterThan(0);
    }
  });
});
