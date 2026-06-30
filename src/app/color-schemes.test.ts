import { describe, it, expect, beforeEach } from "vitest";
import {
  loadSchemes, addScheme, removeScheme,
  exportScheme, importScheme, mergeAppliedBranding, type ColorScheme,
} from "./color-schemes";

function sample(name = "Acme"): ColorScheme {
  return { id: 1, name, colors: { "--AIPM-green": "#123456" }, branding: { slogan: "Hi" } };
}

describe("mergeAppliedBranding", () => {
  it("replaces slogan/footerSlogan (clearing stale) and leaves logo/favicon global", () => {
    const current = { slogan: "Alpha", footerSlogan: "Foot", logo: "data:image/png;base64,AAA" };
    const merged = mergeAppliedBranding(current, {}); // scheme with no branding
    expect(merged.slogan).toBeUndefined();   // stale slogan cleared
    expect(merged.footerSlogan).toBeUndefined();
    expect(merged.logo).toBe("data:image/png;base64,AAA"); // global logo preserved
  });

  it("takes the scheme's slogan + footerSlogan and never touches logo/favicon", () => {
    const current = { logo: "data:image/png;base64,AAA" };
    const merged = mergeAppliedBranding(current, { slogan: "Beta", footerSlogan: "Bee", logo: "data:image/png;base64,ZZZ" });
    expect(merged.slogan).toBe("Beta");
    expect(merged.footerSlogan).toBe("Bee");
    expect(merged.logo).toBe("data:image/png;base64,AAA"); // scheme logo IGNORED (global owns logo)
  });

  it("handles an undefined current branding", () => {
    expect(mergeAppliedBranding(undefined, { slogan: "X" }).slogan).toBe("X");
  });
});

describe("color-schemes store", () => {
  beforeEach(() => localStorage.clear());

  it("adds with id=max+1 and round-trips through localStorage", () => {
    const a = addScheme("First", { "--AIPM-green": "#111111" }, {});
    const b = addScheme("Second", { "--AIPM-green": "#222222" }, {});
    expect(b.activeId).toBe(b.schemes[b.schemes.length - 1].id);
    expect(b.schemes[1].id).toBe(a.schemes[0].id + 1);
    expect(loadSchemes().schemes).toHaveLength(2);
  });

  it("removes a scheme and clears activeId when it was active", () => {
    let st = addScheme("Only", {}, {});
    const id = st.schemes[0].id;
    st = removeScheme(id);
    expect(st.schemes).toHaveLength(0);
    expect(st.activeId).toBeNull();
  });

  it("exports JSON and imports it back", () => {
    const json = exportScheme(sample());
    const imported = importScheme(json);
    expect(imported?.name).toBe("Acme");
    expect(imported?.colors["--AIPM-green"]).toBe("#123456");
  });

  it("import rejects non-hex color values and drops unknown keys", () => {
    const bad = JSON.stringify({ name: "X", colors: { "--AIPM-green": "red;}html{}", "--bogus": "#fff" }, branding: {} });
    const imported = importScheme(bad);
    expect(imported).not.toBeNull();
    expect(imported!.colors["--AIPM-green"]).toBeUndefined();
    expect(imported!.colors["--bogus"]).toBeUndefined();
  });

  it("import returns null on garbage", () => {
    expect(importScheme("not json")).toBeNull();
    expect(importScheme("[]")).toBeNull();
  });
});
