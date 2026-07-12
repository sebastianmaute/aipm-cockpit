import { describe, it, expect, beforeEach } from "vitest";
import {
  loadSchemes, saveSchemes, addScheme, updateScheme, removeScheme, nextUserId, setActive,
  exportScheme, importScheme, mergeAppliedBranding, type ColorScheme,
} from "./color-schemes";

function sample(name = "Acme"): ColorScheme {
  return {
    id: "u-1",
    name,
    supportsDark: false,
    light: { "--AIPM-green": "#123456" },
    branding: { slogan: "Hi" },
  };
}

function scheme(id: string): ColorScheme {
  return { id, name: id, supportsDark: false, light: {}, branding: {} };
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

describe("nextUserId", () => {
  it("returns u-1 for an empty list", () => {
    expect(nextUserId([])).toBe("u-1");
  });

  it("increments the max numeric suffix among u-<n> ids, ignoring non-user ids", () => {
    expect(nextUserId([scheme("u-3"), scheme("builtin-AIPM"), scheme("u-7")])).toBe("u-8");
  });
});

describe("color-schemes store", () => {
  beforeEach(() => localStorage.clear());

  it("adds with string ids (u-1, u-2) and round-trips through localStorage", () => {
    const a = addScheme("First", { "--AIPM-green": "#111111" }, {});
    const b = addScheme("Second", { "--AIPM-green": "#222222" }, {});
    expect(b.activeId).toBe(b.schemes[b.schemes.length - 1].id);
    expect(a.schemes[0].id).toBe("u-1");
    expect(b.schemes[1].id).toBe("u-2");
    expect(loadSchemes().schemes).toHaveLength(2);
  });

  it("stores added schemes as light maps with supportsDark=false", () => {
    const st = addScheme("First", { "--AIPM-green": "#111111" }, {});
    expect(st.schemes[0].light["--AIPM-green"]).toBe("#111111");
    expect(st.schemes[0].supportsDark).toBe(false);
    expect(st.schemes[0].dark).toBeUndefined();
  });

  it("removes a scheme and clears activeId when it was active", () => {
    let st = addScheme("Only", {}, {});
    const id = st.schemes[0].id;
    st = removeScheme(id);
    expect(st.schemes).toHaveLength(0);
    expect(st.activeId).toBeNull();
  });

  it("removeScheme on a builtIn scheme is a no-op (undeletable)", () => {
    saveSchemes({
      schemes: [{ id: "builtin-AIPM", name: "AIPM", builtIn: true, supportsDark: false, light: { "--AIPM-green": "#111111" }, branding: {} }],
      activeId: null,
    });
    const st = removeScheme("builtin-AIPM");
    expect(st.schemes).toHaveLength(1);
    expect(st.schemes[0].id).toBe("builtin-AIPM");
  });

  it("updateScheme on a builtIn is unchanged (code-owned)", () => {
    saveSchemes({
      schemes: [{ id: "builtin-AIPM", name: "AIPM", builtIn: true, supportsDark: false, light: { "--AIPM-green": "#111111" }, branding: {} }],
      activeId: null,
    });
    const st = updateScheme("builtin-AIPM", { name: "Hacked", light: { "--AIPM-green": "#999999" } });
    expect(st.schemes[0].name).toBe("AIPM");
    expect(st.schemes[0].light["--AIPM-green"]).toBe("#111111");
  });

  it("updateScheme applies light/dark/supportsDark/name to a user scheme", () => {
    let st = addScheme("First", { "--AIPM-green": "#111111" }, {});
    const id = st.schemes[0].id;
    st = updateScheme(id, { name: "Renamed", supportsDark: true, dark: { "--AIPM-green": "#eeeeee" } });
    expect(st.schemes[0].name).toBe("Renamed");
    expect(st.schemes[0].supportsDark).toBe(true);
    expect(st.schemes[0].dark!["--AIPM-green"]).toBe("#eeeeee");
  });

  it("migrates a legacy flat {colors} scheme to light with supportsDark=false", () => {
    const json = JSON.stringify({ id: 1, name: "Legacy", colors: { "--AIPM-green": "#123456" }, branding: {} });
    const imported = importScheme(json);
    expect(imported).not.toBeNull();
    expect(imported!.light["--AIPM-green"]).toBe("#123456");
    expect(imported!.supportsDark).toBe(false);
    expect(imported!.dark).toBeUndefined();
  });

  it("round-trips a new light+dark scheme, dropping invalid hexes in both maps", () => {
    const json = JSON.stringify({
      name: "Dual",
      supportsDark: true,
      light: { "--AIPM-green": "#111111", "--bogus": "#fff" },
      dark: { "--AIPM-green": "#eeeeee", "--AIPM-green-bad": "nothex" },
    });
    const imported = importScheme(json);
    expect(imported).not.toBeNull();
    expect(imported!.supportsDark).toBe(true);
    expect(imported!.light["--AIPM-green"]).toBe("#111111");
    expect(imported!.light["--bogus"]).toBeUndefined();
    expect(imported!.dark!["--AIPM-green"]).toBe("#eeeeee");
    expect(imported!.dark!["--AIPM-green-bad"]).toBeUndefined();
  });

  it("collapses supportsDark to false when the dark map ends up empty", () => {
    const json = JSON.stringify({ name: "NoDark", supportsDark: true, light: { "--AIPM-green": "#111111" }, dark: { "--bogus": "nothex" } });
    const imported = importScheme(json);
    expect(imported!.supportsDark).toBe(false);
    expect(imported!.dark).toBeUndefined();
  });

  it("exports JSON that omits id/builtIn and includes light + supportsDark", () => {
    const json = exportScheme(sample());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.id).toBeUndefined();
    expect(parsed.builtIn).toBeUndefined();
    expect((parsed.light as Record<string, string>)["--AIPM-green"]).toBe("#123456");
    expect(parsed.supportsDark).toBe(false);
  });

  it("exports JSON and imports it back (no data loss)", () => {
    const imported = importScheme(exportScheme(sample()));
    expect(imported?.name).toBe("Acme");
    expect(imported?.light["--AIPM-green"]).toBe("#123456");
    expect(imported?.supportsDark).toBe(false);
  });

  it("import rejects non-hex color values and drops unknown keys", () => {
    const bad = JSON.stringify({ name: "X", light: { "--AIPM-green": "red;}html{}", "--bogus": "#fff" }, branding: {} });
    const imported = importScheme(bad);
    expect(imported).not.toBeNull();
    expect(imported!.light["--AIPM-green"]).toBeUndefined();
    expect(imported!.light["--bogus"]).toBeUndefined();
  });

  it("import returns null on garbage", () => {
    expect(importScheme("not json")).toBeNull();
    expect(importScheme("[]")).toBeNull();
  });

  it("setActive accepts a built-in id (not present in the raw store) and persists it", () => {
    // Regression: a built-in id must be valid even though built-ins are merged
    // in only by reconcileBuiltins, never persisted to lop-app:color-schemes.
    expect(setActive("meridian").activeId).toBe("meridian");
    expect(loadSchemes().activeId).toBe("meridian");
    expect(setActive("umber").activeId).toBe("umber");
  });

  it("ColorScheme.structural is optional and user schemes round-trip without it", () => {
    const st = addScheme("Draft", { "--AIPM-green": "#84bd00" }, {});
    expect(st.schemes[0].structural).toBeUndefined();
  });

  it("setActive persists a user id or null; an unknown id is left to reconcileBuiltins", () => {
    addScheme("Mine", { "--AIPM-green": "#123456" }, {}); // → u-1
    expect(setActive("u-1").activeId).toBe("u-1");
    expect(setActive(null).activeId).toBeNull();
    // An unknown id is persisted as-is here (reconcileBuiltins maps it to Harbor),
    // not nulled — otherwise a built-in id would be stripped the same way.
    expect(setActive("nope").activeId).toBe("nope");
  });
});
