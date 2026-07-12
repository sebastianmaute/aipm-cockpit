import { describe, it, expect, beforeEach } from "vitest";
import {
  ACTIVE_SCHEME_COLORS_KEY,
  SCHEME_SUPPORTS_DARK_KEY,
  applySchemeColors,
  readActiveSchemeColors,
  readSchemeSupportsDark,
  writeActiveSchemeColors,
  writeSchemeSupportsDark,
} from "./scheme-apply";

describe("scheme-apply", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  it("sets inline CSS vars for each token and clears them with null", () => {
    applySchemeColors({ "--AIPM-green": "#123456", "--background": "#abcdef" });
    expect(document.documentElement.style.getPropertyValue("--AIPM-green")).toBe("#123456");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#abcdef");

    applySchemeColors(null);
    expect(document.documentElement.style.getPropertyValue("--AIPM-green")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("");
  });

  it("round-trips the active color map through localStorage", () => {
    writeActiveSchemeColors({ "--AIPM-green": "#123456" });
    expect(localStorage.getItem(ACTIVE_SCHEME_COLORS_KEY)).toContain("--AIPM-green");
    expect(readActiveSchemeColors()).toEqual({ "--AIPM-green": "#123456" });
  });

  it("readActiveSchemeColors returns null on missing/garbage", () => {
    expect(readActiveSchemeColors()).toBeNull();
    localStorage.setItem(ACTIVE_SCHEME_COLORS_KEY, "not json");
    expect(readActiveSchemeColors()).toBeNull();
  });

  it("round-trips the dark-capable boot flag and clears it when false", () => {
    expect(readSchemeSupportsDark()).toBe(false);
    writeSchemeSupportsDark(true);
    expect(localStorage.getItem(SCHEME_SUPPORTS_DARK_KEY)).toBe("1");
    expect(readSchemeSupportsDark()).toBe(true);
    writeSchemeSupportsDark(false);
    expect(localStorage.getItem(SCHEME_SUPPORTS_DARK_KEY)).toBeNull();
    expect(readSchemeSupportsDark()).toBe(false);
  });

  it("clearing replaces the previous inline override set (no stale tokens)", () => {
    applySchemeColors({ "--AIPM-green": "#111111", "--line": "#222222" });
    applySchemeColors({ "--AIPM-green": "#333333" });
    expect(document.documentElement.style.getPropertyValue("--AIPM-green")).toBe("#333333");
    expect(document.documentElement.style.getPropertyValue("--line")).toBe("");
  });
});
