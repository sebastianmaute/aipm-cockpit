import { describe, it, expect, vi } from "vitest";
import { sanitizeAiConfig, defaultAiConfig, sanitizeBranding, BRANDING_LOGO_MAX_LEN, sanitizeSelfResourceId, clampInsightRecInterval, DEFAULT_INSIGHT_REC_INTERVAL_MIN, aiAssistantOpener } from "./settings-types";

describe("sanitizeSelfResourceId", () => {
  it("keeps a positive integer id", () => {
    expect(sanitizeSelfResourceId(42)).toBe(42);
  });
  it("floors a fractional id", () => {
    expect(sanitizeSelfResourceId(42.7)).toBe(42);
  });
  it("returns undefined for zero / negative / non-number / NaN", () => {
    expect(sanitizeSelfResourceId(0)).toBeUndefined();
    expect(sanitizeSelfResourceId(-1)).toBeUndefined();
    expect(sanitizeSelfResourceId("5")).toBeUndefined();
    expect(sanitizeSelfResourceId(undefined)).toBeUndefined();
    expect(sanitizeSelfResourceId(Number.NaN)).toBeUndefined();
  });
});

describe("sanitizeBranding", () => {
  const pngUrl = "data:image/png;base64,iVBORw0KGgo=";
  it("accepts a raster data-image logo + trims/caps the slogan", () => {
    expect(sanitizeBranding({ logo: pngUrl, slogan: "  My Tool  " })).toEqual({ logo: pngUrl, slogan: "My Tool" });
  });
  it("rejects non-image / script data URLs (XSS guard), incl. svg", () => {
    expect(sanitizeBranding({ logo: "data:text/html;base64,PHNjcmlwdD4=" })).toBeUndefined();
    expect(sanitizeBranding({ logo: "javascript:alert(1)" })).toBeUndefined();
    expect(sanitizeBranding({ logo: "data:image/svg+xml;base64,PHN2Zz4=" })).toBeUndefined();
  });
  it("rejects an over-cap logo", () => {
    const huge = "data:image/png;base64," + "A".repeat(BRANDING_LOGO_MAX_LEN);
    expect(sanitizeBranding({ logo: huge })).toBeUndefined();
  });
  it("returns undefined when nothing valid remains", () => {
    expect(sanitizeBranding({})).toBeUndefined();
    expect(sanitizeBranding({ slogan: "   " })).toBeUndefined();
    expect(sanitizeBranding(null)).toBeUndefined();
  });
  it("caps the slogan length", () => {
    expect((sanitizeBranding({ slogan: "x".repeat(200) })?.slogan ?? "").length).toBe(60);
  });
  it("keeps + caps a footer slogan", () => {
    expect(sanitizeBranding({ footerSlogan: "  Best app ever  " })).toEqual({ footerSlogan: "Best app ever" });
    expect((sanitizeBranding({ footerSlogan: "y".repeat(300) })?.footerSlogan ?? "").length).toBe(120);
  });
  it("accepts a raster favicon and rejects non-image/script favicons (XSS guard)", () => {
    expect(sanitizeBranding({ favicon: pngUrl })).toEqual({ favicon: pngUrl });
    expect(sanitizeBranding({ favicon: "data:image/svg+xml;base64,PHN2Zz4=" })).toBeUndefined();
    expect(sanitizeBranding({ favicon: "javascript:alert(1)" })).toBeUndefined();
  });
  // A start-logo-only blob is the case that catches a missed `startLogo` in the
  // final presence check: the arm can populate `out` and the function still
  // return undefined, so the field never persists.
  it("keeps a raster startLogo", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(sanitizeBranding({ startLogo: png })).toEqual({ startLogo: png });
  });

  it("rejects an SVG startLogo (the data-URL XSS surface)", () => {
    expect(sanitizeBranding({ startLogo: "data:image/svg+xml;base64,PHN2Zz4=" })).toBeUndefined();
  });

  it("rejects an oversized startLogo", () => {
    const huge = "data:image/png;base64," + "A".repeat(BRANDING_LOGO_MAX_LEN);
    expect(sanitizeBranding({ startLogo: huge })).toBeUndefined();
  });
});

describe("sanitizeAiConfig groundInGuides", () => {
  it("defaults groundInGuides to true", () => {
    expect(defaultAiConfig.groundInGuides).toBe(true);
    expect(sanitizeAiConfig({}).groundInGuides).toBe(true);
  });
  it("respects an explicit false", () => {
    expect(sanitizeAiConfig({ groundInGuides: false }).groundInGuides).toBe(false);
  });
});

describe("sanitizeAiConfig maxChatTurns", () => {
  it("defaults to 12", () => {
    expect(defaultAiConfig.maxChatTurns).toBe(12);
    expect(sanitizeAiConfig({}).maxChatTurns).toBe(12);
  });
  it("rejects invalid / out-of-range values → 12", () => {
    expect(sanitizeAiConfig({ maxChatTurns: NaN }).maxChatTurns).toBe(12);
    expect(sanitizeAiConfig({ maxChatTurns: 0 }).maxChatTurns).toBe(12);
    expect(sanitizeAiConfig({ maxChatTurns: 999 }).maxChatTurns).toBe(12);
  });
  it("keeps an in-range integer", () => {
    expect(sanitizeAiConfig({ maxChatTurns: 20 }).maxChatTurns).toBe(20);
  });
});

describe("sanitizeAiConfig tokenMultiplier", () => {
  it("defaults to 5", () => {
    expect(defaultAiConfig.tokenMultiplier).toBe(5);
    expect(sanitizeAiConfig({}).tokenMultiplier).toBe(5);
  });
  it("rejects 0 / negative / NaN → 5", () => {
    expect(sanitizeAiConfig({ tokenMultiplier: 0 }).tokenMultiplier).toBe(5);
    expect(sanitizeAiConfig({ tokenMultiplier: -3 }).tokenMultiplier).toBe(5);
    expect(sanitizeAiConfig({ tokenMultiplier: NaN }).tokenMultiplier).toBe(5);
  });
  it("keeps a positive integer and a positive decimal", () => {
    expect(sanitizeAiConfig({ tokenMultiplier: 3 }).tokenMultiplier).toBe(3);
    expect(sanitizeAiConfig({ tokenMultiplier: 2.5 }).tokenMultiplier).toBe(2.5);
  });
});

describe("sanitizeAiConfig suggestAllNextActionThresholds", () => {
  it("defaults to false (opt-in)", () => {
    expect(defaultAiConfig.suggestAllNextActionThresholds).toBeUndefined();
    expect(sanitizeAiConfig({}).suggestAllNextActionThresholds).toBe(false);
  });
  it("coerces to true only for a literal true", () => {
    expect(sanitizeAiConfig({ suggestAllNextActionThresholds: true }).suggestAllNextActionThresholds).toBe(true);
  });
  it("treats non-true truthy values as false", () => {
    expect(sanitizeAiConfig({ suggestAllNextActionThresholds: "x" }).suggestAllNextActionThresholds).toBe(false);
    expect(sanitizeAiConfig({ suggestAllNextActionThresholds: 1 }).suggestAllNextActionThresholds).toBe(false);
  });
});

describe("clampInsightRecInterval", () => {
  it("defaults to 60 minutes", () => {
    expect(DEFAULT_INSIGHT_REC_INTERVAL_MIN).toBe(60);
    expect(clampInsightRecInterval(undefined)).toBe(60);
  });

  it("accepts a value inside the range", () => {
    expect(clampInsightRecInterval(15)).toBe(15);
    expect(clampInsightRecInterval(120)).toBe(120);
    expect(clampInsightRecInterval(1440)).toBe(1440);
  });

  it("rejects out-of-range and non-numeric values so billed calls stay bounded", () => {
    expect(clampInsightRecInterval(1)).toBe(60); // below the floor
    expect(clampInsightRecInterval(0)).toBe(60);
    expect(clampInsightRecInterval(-30)).toBe(60);
    expect(clampInsightRecInterval(5000)).toBe(60); // above the ceiling
    expect(clampInsightRecInterval("abc")).toBe(60);
    expect(clampInsightRecInterval(null)).toBe(60);
    expect(clampInsightRecInterval({})).toBe(60);
    expect(clampInsightRecInterval(Number.NaN)).toBe(60);
    expect(clampInsightRecInterval(Number.POSITIVE_INFINITY)).toBe(60);
  });

  it("rounds a fractional value to whole minutes", () => {
    expect(clampInsightRecInterval(59.6)).toBe(60);
    expect(clampInsightRecInterval(30.2)).toBe(30);
  });

  it("is applied by sanitizeAiConfig on load", () => {
    expect(sanitizeAiConfig({ insightRecommendationIntervalMinutes: 3 }).insightRecommendationIntervalMinutes).toBe(60);
    expect(sanitizeAiConfig({ insightRecommendationIntervalMinutes: 90 }).insightRecommendationIntervalMinutes).toBe(90);
    expect(sanitizeAiConfig({}).insightRecommendationIntervalMinutes).toBe(60);
  });
});

describe("sanitizeAiConfig insightRecommendations", () => {
  it("defaults off and only true enables", () => {
    expect(sanitizeAiConfig({}).insightRecommendations).toBeFalsy();
    expect(sanitizeAiConfig({ insightRecommendations: true }).insightRecommendations).toBe(true);
    expect(
      sanitizeAiConfig({ insightRecommendations: "yes" as unknown as boolean }).insightRecommendations,
    ).toBe(false);
  });
});

describe("aiAssistantOpener", () => {
  it("returns undefined when AI is disabled (master switch off)", () => {
    const open = vi.fn();
    expect(aiAssistantOpener(defaultAiConfig, open)).toBeUndefined();
  });

  it("returns undefined when the master switch is on but no API key is set", () => {
    const open = vi.fn();
    const ai = { ...defaultAiConfig, enabled: true, apiKey: "" };
    expect(aiAssistantOpener(ai, open)).toBeUndefined();
  });

  it("returns the opener when AI is enabled with a key", () => {
    const open = vi.fn();
    const ai = { ...defaultAiConfig, enabled: true, apiKey: "test-key" };
    const opener = aiAssistantOpener(ai, open);
    expect(opener).toBe(open);
  });
});

describe("AiConfig recall toggles", () => {
  const base = { apiKey: "", model: "claude-sonnet-4-6", consentAccepted: false, groundInGuides: false };

  it("defaults BOTH to ON when absent", () => {
    const ai = sanitizeAiConfig(base);
    // ★ ON by absence: search_history shipped ON in 0.241.0, so defaulting off
    //   would silently remove a live capability on upgrade.
    expect(ai.historySearch).not.toBe(false);
    expect(ai.activityRecap).not.toBe(false);
  });

  it("round-trips an explicit false", () => {
    const ai = sanitizeAiConfig({ ...base, historySearch: false, activityRecap: false });
    expect(ai.historySearch).toBe(false);
    expect(ai.activityRecap).toBe(false);
  });

  it("coerces a non-boolean to the ON default rather than storing garbage", () => {
    // ★ A stale string / number / null must read as ON, not as "off by accident".
    const ai = sanitizeAiConfig({ ...base, historySearch: "no", activityRecap: 0 });
    // ★★★ `toBeUndefined`, NOT `not.toBe(false)` — the loose form was VACUOUS
    //   here and passed on the very mutant it exists to catch. The sanitizer is
    //   `obj.historySearch === false ? false : undefined`, so a pass-through
    //   mutant (`obj.historySearch`) stores `"no"` and `0` VERBATIM — and
    //   `"no" !== false` and `0 !== false`, so the old assertions were green
    //   either way. `undefined` is the ONE value the ON default is spelled as
    //   (see the `historySearch?: boolean` field comment: undefined = on), so
    //   pinning it is what makes the mutant fail.
    expect(ai.historySearch).toBeUndefined();
    expect(ai.activityRecap).toBeUndefined();
  });

  // ★★★ REGRESSION PIN for open-followups §159. `actionSuggestions` is NOT a
  //   recall toggle — it predates this branch — but it is the third field with
  //   the same default-ON-by-absence contract, and it was MISSING from
  //   `sanitizeAiConfig`'s return literal entirely. Because the field is
  //   OPTIONAL, dropping it is typecheck-clean: `writeSettings` persisted the
  //   user's `false` correctly and the sanitizer discarded it on the next read,
  //   so the Action Center's "Analyze with AI" toggle re-ticked itself at every
  //   reload. It lives in THIS describe block because the bug is a property of
  //   the literal the block already covers, not of the feature it belongs to.
  //   ★★ The round-trip assertion is the load-bearing one — the absence case
  //   passed even with the key missing (a dropped key also reads `undefined`),
  //   so a test asserting ONLY the default would have been green throughout.
  it("round-trips an explicit false for actionSuggestions (§159)", () => {
    expect(sanitizeAiConfig({ ...base, actionSuggestions: false }).actionSuggestions).toBe(false);
    expect(sanitizeAiConfig(base).actionSuggestions).toBeUndefined();
    // A stale non-boolean reads as ON, same rule as the two toggles above.
    expect(sanitizeAiConfig({ ...base, actionSuggestions: "no" }).actionSuggestions).toBeUndefined();
  });
});
