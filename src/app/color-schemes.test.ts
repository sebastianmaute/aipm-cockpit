import { describe, it, test, expect, beforeEach } from "vitest";
import {
  loadSchemes, saveSchemes, addScheme, updateScheme, removeScheme, nextUserId, setActive,
  exportScheme, importScheme, mergeAppliedBranding, cleanScheme, type ColorScheme,
} from "./color-schemes";

function sample(name = "Acme"): ColorScheme {
  return {
    id: "u-1",
    name,
    supportsDark: false,
    light: { "--ui-green": "#123456" },
    branding: { slogan: "Hi" },
  };
}

function scheme(id: string): ColorScheme {
  return { id, name: id, supportsDark: false, light: {}, branding: {} };
}

describe("mergeAppliedBranding", () => {
  it("clears all four branding fields when the scheme has none", () => {
    const current = { slogan: "Alpha", footerSlogan: "Foot", logo: "data:image/png;base64,AAA" };
    const merged = mergeAppliedBranding(current, {}); // scheme with no branding
    expect(merged.slogan).toBeUndefined();   // stale slogan cleared
    expect(merged.footerSlogan).toBeUndefined();
    expect(merged.logo).toBeUndefined();     // scheme owns logo now — cleared
    expect(merged.favicon).toBeUndefined();
  });

  it("takes the scheme's logo/favicon/slogan/footerSlogan (scheme owns all four)", () => {
    const current = { logo: "data:image/png;base64,AAA" };
    const merged = mergeAppliedBranding(current, { slogan: "Beta", footerSlogan: "Bee", logo: "data:image/png;base64,ZZZ" });
    expect(merged.slogan).toBe("Beta");
    expect(merged.footerSlogan).toBe("Bee");
    expect(merged.logo).toBe("data:image/png;base64,ZZZ"); // scheme logo now wins (scheme owns logo)
  });

  it("handles an undefined current branding", () => {
    expect(mergeAppliedBranding(undefined, { slogan: "X" }).slogan).toBe("X");
  });

  it("leaves startLogo alone — schemes own the other four, not the start window", () => {
    const START = "data:image/png;base64,SSS";
    // Neither set (a scheme carrying one must not apply it) nor cleared (applying
    // a scheme must not destroy the user's start-window logo).
    expect(mergeAppliedBranding({ startLogo: START }, {}).startLogo).toBe(START);
    expect(
      mergeAppliedBranding({ startLogo: START }, { startLogo: "data:image/png;base64,ZZZ" })
        .startLogo,
    ).toBe(START);
  });
});

describe("mergeAppliedBranding: logo + favicon (Phase 3)", () => {
  it("replaces logo/favicon/slogan/footerSlogan from the scheme", () => {
    const current = { logo: "data:image/png;base64,OLD", slogan: "old" };
    const scheme = {
      logo: "data:image/png;base64,NEW",
      favicon: "data:image/png;base64,FAV",
      slogan: "new",
      footerSlogan: "foot",
    };
    expect(mergeAppliedBranding(current, scheme)).toEqual({
      logo: "data:image/png;base64,NEW",
      favicon: "data:image/png;base64,FAV",
      slogan: "new",
      footerSlogan: "foot",
    });
  });

  it("clears logo/favicon when the scheme has none (branded scheme owns all four)", () => {
    const current = { logo: "data:image/png;base64,OLD", favicon: "data:image/png;base64,OLD" };
    expect(mergeAppliedBranding(current, { slogan: "x" })).toEqual({
      logo: undefined,
      favicon: undefined,
      slogan: "x",
      footerSlogan: undefined,
    });
  });
});

describe("export/import round-trip: logo + favicon (Phase 3)", () => {
  it("preserves a raster logo + favicon through export→import", () => {
    const scheme = {
      id: "u-1", name: "Mine", supportsDark: false,
      light: { "--ui-green": "#4d7000" },
      branding: {
        logo: "data:image/png;base64,AAAA",
        favicon: "data:image/png;base64,BBBB",
        slogan: "s",
      },
    } as const;
    const back = importScheme(exportScheme(scheme as never));
    expect(back?.branding.logo).toBe("data:image/png;base64,AAAA");
    expect(back?.branding.favicon).toBe("data:image/png;base64,BBBB");
    expect(back?.branding.slogan).toBe("s");
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
    const a = addScheme("First", { "--ui-green": "#111111" }, {});
    const b = addScheme("Second", { "--ui-green": "#222222" }, {});
    expect(b.activeId).toBe(b.schemes[b.schemes.length - 1].id);
    expect(a.schemes[0].id).toBe("u-1");
    expect(b.schemes[1].id).toBe("u-2");
    expect(loadSchemes().schemes).toHaveLength(2);
  });

  it("stores added schemes as light maps with supportsDark=false", () => {
    const st = addScheme("First", { "--ui-green": "#111111" }, {});
    expect(st.schemes[0].light["--ui-green"]).toBe("#111111");
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
      schemes: [{ id: "builtin-AIPM", name: "AIPM", builtIn: true, supportsDark: false, light: { "--ui-green": "#111111" }, branding: {} }],
      activeId: null,
    });
    const st = removeScheme("builtin-AIPM");
    expect(st.schemes).toHaveLength(1);
    expect(st.schemes[0].id).toBe("builtin-AIPM");
  });

  it("updateScheme on a builtIn is unchanged (code-owned)", () => {
    saveSchemes({
      schemes: [{ id: "builtin-AIPM", name: "AIPM", builtIn: true, supportsDark: false, light: { "--ui-green": "#111111" }, branding: {} }],
      activeId: null,
    });
    const st = updateScheme("builtin-AIPM", { name: "Hacked", light: { "--ui-green": "#999999" } });
    expect(st.schemes[0].name).toBe("AIPM");
    expect(st.schemes[0].light["--ui-green"]).toBe("#111111");
  });

  it("updateScheme applies light/dark/supportsDark/name to a user scheme", () => {
    let st = addScheme("First", { "--ui-green": "#111111" }, {});
    const id = st.schemes[0].id;
    st = updateScheme(id, { name: "Renamed", supportsDark: true, dark: { "--ui-green": "#eeeeee" } });
    expect(st.schemes[0].name).toBe("Renamed");
    expect(st.schemes[0].supportsDark).toBe(true);
    expect(st.schemes[0].dark!["--ui-green"]).toBe("#eeeeee");
  });

  it("migrates a legacy flat {colors} scheme to light with supportsDark=false", () => {
    const json = JSON.stringify({ id: 1, name: "Legacy", colors: { "--ui-green": "#123456" }, branding: {} });
    const imported = importScheme(json);
    expect(imported).not.toBeNull();
    expect(imported!.light["--ui-green"]).toBe("#123456");
    expect(imported!.supportsDark).toBe(false);
    expect(imported!.dark).toBeUndefined();
  });

  it("round-trips a new light+dark scheme, dropping invalid hexes in both maps", () => {
    const json = JSON.stringify({
      name: "Dual",
      supportsDark: true,
      light: { "--ui-green": "#111111", "--bogus": "#fff" },
      dark: { "--ui-green": "#eeeeee", "--ui-green-bad": "nothex" },
    });
    const imported = importScheme(json);
    expect(imported).not.toBeNull();
    expect(imported!.supportsDark).toBe(true);
    expect(imported!.light["--ui-green"]).toBe("#111111");
    expect(imported!.light["--bogus"]).toBeUndefined();
    expect(imported!.dark!["--ui-green"]).toBe("#eeeeee");
    expect(imported!.dark!["--ui-green-bad"]).toBeUndefined();
  });

  it("collapses supportsDark to false when the dark map ends up empty", () => {
    const json = JSON.stringify({ name: "NoDark", supportsDark: true, light: { "--ui-green": "#111111" }, dark: { "--bogus": "nothex" } });
    const imported = importScheme(json);
    expect(imported!.supportsDark).toBe(false);
    expect(imported!.dark).toBeUndefined();
  });

  it("exports JSON that omits id/builtIn and includes light + supportsDark", () => {
    const json = exportScheme(sample());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.id).toBeUndefined();
    expect(parsed.builtIn).toBeUndefined();
    expect((parsed.light as Record<string, string>)["--ui-green"]).toBe("#123456");
    expect(parsed.supportsDark).toBe(false);
  });

  it("exports JSON and imports it back (no data loss)", () => {
    const imported = importScheme(exportScheme(sample()));
    expect(imported?.name).toBe("Acme");
    expect(imported?.light["--ui-green"]).toBe("#123456");
    expect(imported?.supportsDark).toBe(false);
  });

  it("import rejects non-hex color values and drops unknown keys", () => {
    const bad = JSON.stringify({ name: "X", light: { "--ui-green": "red;}html{}", "--bogus": "#fff" }, branding: {} });
    const imported = importScheme(bad);
    expect(imported).not.toBeNull();
    expect(imported!.light["--ui-green"]).toBeUndefined();
    expect(imported!.light["--bogus"]).toBeUndefined();
  });

  it("import returns null on garbage", () => {
    expect(importScheme("not json")).toBeNull();
    expect(importScheme("[]")).toBeNull();
  });

  it("setActive accepts a built-in id (not present in the raw store) and persists it", () => {
    // Regression: a built-in id must be valid even though built-ins are merged
    // in only by reconcileBuiltins, never persisted to aipm-cockpit:color-schemes.
    expect(setActive("meridian").activeId).toBe("meridian");
    expect(loadSchemes().activeId).toBe("meridian");
    expect(setActive("umber").activeId).toBe("umber");
  });

  it("ColorScheme.structural is optional and user schemes round-trip without it", () => {
    const st = addScheme("Draft", { "--ui-green": "#84bd00" }, {});
    expect(st.schemes[0].structural).toBeUndefined();
  });

  it("setActive persists a user id or null; an unknown id is left to reconcileBuiltins", () => {
    addScheme("Mine", { "--ui-green": "#123456" }, {}); // → u-1
    expect(setActive("u-1").activeId).toBe("u-1");
    expect(setActive(null).activeId).toBeNull();
    // An unknown id is persisted as-is here (reconcileBuiltins maps it to Harbor),
    // not nulled — otherwise a built-in id would be stripped the same way.
    expect(setActive("nope").activeId).toBe("nope");
  });
});

describe("portable theme format (structural + pins)", () => {
  const themeJson = JSON.stringify({
    name: "Test",
    supportsDark: false,
    light: {
      "--ui-dark-blue": "#004159",
      "--ui-green": "#84bd00",
      "--ui-green-strong": "#4d7000",
      "--rag-red-text": "#c41e5a",
    },
    structural: {
      "--shadow-card": "0 1px 3px rgba(0,65,89,0.12)",
      "--gradient-kpi": "linear-gradient(90deg, var(--rag-red), var(--rag-green))",
      "--bogus": "x",
    },
    branding: {},
  });
  test("import preserves pinned AA tokens + valid structural, drops unknown", () => {
    const s = cleanScheme(JSON.parse(themeJson), "u-1");
    expect(s).not.toBeNull();
    expect(s!.light["--ui-green-strong"]).toBe("#4d7000");
    expect(s!.light["--rag-red-text"]).toBe("#c41e5a");
    expect(s!.structural?.["--shadow-card"]).toBe("0 1px 3px rgba(0,65,89,0.12)");
    expect(s!.structural?.["--gradient-kpi"]).toContain("linear-gradient");
    expect(s!.structural?.["--bogus"]).toBeUndefined();
  });
  test("import rejects dangerous structural value", () => {
    const evil = JSON.parse(themeJson);
    evil.structural = { "--shadow-card": "url(http://x)" };
    const s = cleanScheme(evil, "u-2");
    expect(s!.structural?.["--shadow-card"]).toBeUndefined();
  });
  test("export round-trips structural", () => {
    const s = cleanScheme(JSON.parse(themeJson), "u-3")!;
    const round = cleanScheme(JSON.parse(exportScheme(s)), "u-4")!;
    expect(round.structural?.["--shadow-card"]).toBe("0 1px 3px rgba(0,65,89,0.12)");
  });
});
