import { describe, it, expect } from "vitest";
import { sanitizeAiConfig, defaultAiConfig, sanitizeBranding, BRANDING_LOGO_MAX_LEN, sanitizeSelfResourceId } from "./settings-types";

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

describe("sanitizeAiConfig insightRecommendations", () => {
  it("defaults off and only true enables", () => {
    expect(sanitizeAiConfig({}).insightRecommendations).toBeFalsy();
    expect(sanitizeAiConfig({ insightRecommendations: true }).insightRecommendations).toBe(true);
    expect(
      sanitizeAiConfig({ insightRecommendations: "yes" as unknown as boolean }).insightRecommendations,
    ).toBe(false);
  });
});
