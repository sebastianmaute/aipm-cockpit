import { describe, it, expect, beforeEach } from "vitest";
import {
  ACTIVE_SCHEME_COLORS_KEY,
  SCHEME_SUPPORTS_DARK_KEY,
  applySchemeColors,
  isSafeRawCssValue,
  readActiveSchemeColors,
  readActiveSchemeStructural,
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

  it("readActiveSchemeColors drops non-hex values and non-token keys (CSS-injection guard)", () => {
    localStorage.setItem(
      ACTIVE_SCHEME_COLORS_KEY,
      JSON.stringify({
        "--AIPM-green": "#123456", // valid → kept
        "--surface": "url(https://evil/x)", // non-hex → dropped
        "background:red;--x": "#ffffff", // non-token key → dropped
        "--line": "not-a-hex", // non-hex → dropped
      }),
    );
    expect(readActiveSchemeColors()).toEqual({ "--AIPM-green": "#123456" });
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

  it("isSafeRawCssValue accepts shadows/gradients/lengths/keywords", () => {
    for (const v of [
      "none",
      "transparent",
      "0",
      "0.125rem 0.375rem",
      "var(--AIPM-green)",
      "linear-gradient(90deg, var(--rag-red), var(--rag-amber), var(--rag-green))",
      "0 1px 3px rgba(0, 65, 89, 0.12), 0 1px 2px rgba(0, 65, 89, 0.08)",
      "#e6f2d8",
    ])
      expect(isSafeRawCssValue(v)).toBe(true);
  });

  it("isSafeRawCssValue rejects injection vectors", () => {
    for (const v of ["url(evil)", "red; }", "a{b}", "expression(alert(1))", "x@import", "<script>"])
      expect(isSafeRawCssValue(v)).toBe(false);
  });

  it("isSafeRawCssValue rejects an over-length value (>256 chars)", () => {
    expect(isSafeRawCssValue("a".repeat(300))).toBe(false);
    // Exactly at the cap is still allowed.
    expect(isSafeRawCssValue("a".repeat(256))).toBe(true);
  });

  it("isSafeRawCssValue rejects url with whitespace before the paren (denylist parity)", () => {
    for (const v of ["url ( x )", "url  (evil)", "URL\t(evil)"]) expect(isSafeRawCssValue(v)).toBe(false);
  });

  it("readActiveSchemeStructural drops unsafe values", () => {
    localStorage.setItem(
      "lop-active-scheme-structural",
      JSON.stringify({ "--shadow-card": "none", "--x": "url(bad)", notatoken: "none" }),
    );
    expect(readActiveSchemeStructural()).toEqual({ "--shadow-card": "none" });
  });
});
