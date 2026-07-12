import { describe, expect, it, test } from "vitest";
import {
  BUILTIN_SCHEMES,
  BUILTIN_SCHEME_IDS,
  DEFAULT_SCHEME_ID,
  activeSchemeOf,
  reconcileBuiltins,
  resolveActiveScheme,
  resolveActiveStructural,
  HARBOR_DARK,
  HARBOR_LIGHT,
} from "./builtin-schemes";
import type { ColorScheme, SchemeStore } from "./color-schemes";
import { CORE_TOKENS, ADVANCED_TOKENS, resolveSchemeColors } from "./scheme-tokens";
import { checkSchemePairs } from "./scheme-contrast";

// Pure-seed built-ins (exactly the 21 editable tokens, dark-capable, designed
// AA-clean). AIPM/Mockup add pinned AA variants + structural tokens and are
// handled separately.
const PURE_SEED_IDS = ["harbor", "meridian", "umber"] as const;
const isPureSeed = (s: ColorScheme) => (PURE_SEED_IDS as readonly string[]).includes(s.id);

const ALL_TOKENS = [...CORE_TOKENS, ...ADVANCED_TOKENS].map((t) => t.token);

const userScheme = (id: string, name: string): ColorScheme => ({
  id,
  name,
  supportsDark: false,
  light: { "--AIPM-green": "#123456" },
  branding: {},
});

describe("BUILTIN_SCHEMES", () => {
  it("ships AIPM, mockup, harbor, meridian, umber — all code-owned; harbor is default", () => {
    expect(BUILTIN_SCHEMES.map((s) => s.id)).toEqual(["AIPM", "mockup", "harbor", "meridian", "umber"]);
    for (const s of BUILTIN_SCHEMES) expect(s.builtIn).toBe(true);
    // Mockup is light-only; the other four are dark-capable with a dark map.
    expect(BUILTIN_SCHEMES.filter((s) => s.supportsDark).map((s) => s.id)).toEqual(["AIPM", "harbor", "meridian", "umber"]);
    for (const s of BUILTIN_SCHEMES) expect(Boolean(s.dark)).toBe(s.supportsDark);
    expect(DEFAULT_SCHEME_ID).toBe("harbor");
    expect([...BUILTIN_SCHEME_IDS].sort()).toEqual(["harbor", "AIPM", "meridian", "mockup", "umber"]);
  });

  it("every built-in map (light + dark where present) includes all 21 editable tokens", () => {
    for (const s of BUILTIN_SCHEMES) {
      for (const map of [s.light, ...(s.dark ? [s.dark] : [])]) {
        for (const token of ALL_TOKENS) {
          expect(map[token], `${s.id}:${token}`).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });

  it("harbor/meridian/umber maps contain EXACTLY the 21 editable tokens (no extras)", () => {
    for (const s of BUILTIN_SCHEMES.filter(isPureSeed)) {
      for (const map of [s.light, s.dark!]) {
        expect(Object.keys(map).sort()).toEqual([...ALL_TOKENS].sort());
      }
    }
  });

  it("harbor/meridian/umber maps (light AND dark) pass WCAG AA on all checked pairs", () => {
    // AIPM + Mockup are pinned to today's shipping look (a documented sub-AA
    // token exists on dark/mockup); their AA tuning is a later task, so the
    // blanket-AA guarantee applies only to the AA-clean pure-seed schemes.
    const failures: string[] = [];
    for (const s of BUILTIN_SCHEMES.filter(isPureSeed)) {
      for (const [mode, map] of [["light", s.light], ["dark", s.dark!]] as const) {
        for (const pair of checkSchemePairs(map)) {
          if (!pair.passesAa) failures.push(`${s.id}/${mode}/${pair.id}=${pair.ratio}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("reconcileBuiltins", () => {
  it("seeds all built-ins into an empty store and defaults activeId to harbor", () => {
    const out = reconcileBuiltins({ schemes: [], activeId: null });
    expect(out.schemes.map((s) => s.id)).toEqual(["AIPM", "mockup", "harbor", "meridian", "umber"]);
    expect(out.activeId).toBe("harbor");
  });

  it("keeps user schemes and preserves a still-valid user activeId", () => {
    const store: SchemeStore = { schemes: [userScheme("u-1", "Mine")], activeId: "u-1" };
    const out = reconcileBuiltins(store);
    expect(out.schemes.map((s) => s.id)).toEqual(["AIPM", "mockup", "harbor", "meridian", "umber", "u-1"]);
    expect(out.activeId).toBe("u-1");
  });

  it("preserves a built-in activeId", () => {
    const out = reconcileBuiltins({ schemes: [], activeId: "umber" });
    expect(out.activeId).toBe("umber");
  });

  it("falls back to harbor when activeId no longer resolves", () => {
    const out = reconcileBuiltins({ schemes: [], activeId: "u-99" });
    expect(out.activeId).toBe("harbor");
  });

  it("refreshes a stale persisted built-in copy from code (drops the stored one)", () => {
    const stale: ColorScheme = {
      id: "harbor",
      name: "Harbor OLD",
      builtIn: true,
      supportsDark: true,
      light: { "--AIPM-green": "#000000" },
      dark: { "--AIPM-green": "#ffffff" },
      branding: {},
    };
    const out = reconcileBuiltins({ schemes: [stale], activeId: "harbor" });
    const harbor = out.schemes.find((s) => s.id === "harbor")!;
    expect(harbor.name).toBe("Harbor");
    expect(harbor.light).toEqual(HARBOR_LIGHT);
    // exactly one harbor entry (no duplicate from the persisted copy)
    expect(out.schemes.filter((s) => s.id === "harbor")).toHaveLength(1);
  });

  it("does not mutate the shared built-in literal maps", () => {
    const out = reconcileBuiltins({ schemes: [], activeId: null });
    const harbor = out.schemes.find((s) => s.id === "harbor")!;
    harbor.light["--AIPM-green"] = "#deadbe";
    expect(HARBOR_LIGHT["--AIPM-green"]).toBe("#2bc4b6");
  });
});

describe("resolveActiveScheme / activeSchemeOf", () => {
  it("returns the dark sub-map for a dark-capable active scheme in dark mode", () => {
    const store = reconcileBuiltins({ schemes: [], activeId: "harbor" });
    expect(resolveActiveScheme(store, true)).toEqual(HARBOR_DARK);
    expect(resolveActiveScheme(store, false)).toEqual(HARBOR_LIGHT);
  });

  it("falls back to the light map for a light-only active scheme even in dark mode", () => {
    const store: SchemeStore = { schemes: [userScheme("u-1", "Mine")], activeId: "u-1" };
    expect(resolveActiveScheme(store, true)).toEqual({ "--AIPM-green": "#123456" });
  });

  it("falls back to Harbor when activeId is unknown", () => {
    const store: SchemeStore = { schemes: [...BUILTIN_SCHEMES], activeId: "nope" };
    expect(activeSchemeOf(store).id).toBe("harbor");
  });
});

describe("AIPM + Mockup built-ins", () => {
  test("AIPM and Mockup are built-ins (5 total, undeletable)", () => {
    const ids = BUILTIN_SCHEMES.map((s) => s.id);
    expect(ids).toEqual(["AIPM", "mockup", "harbor", "meridian", "umber"]);
    expect(BUILTIN_SCHEME_IDS.has("AIPM")).toBe(true);
  });
  test("AIPM light resolves to the shipped AIPM palette (pinned -strong survive)", () => {
    const store = reconcileBuiltins({ schemes: [], activeId: "AIPM" });
    const c = resolveSchemeColors(resolveActiveScheme(store, false));
    expect(c["--AIPM-green"]).toBe("#84bd00");
    expect(c["--AIPM-green-strong"]).toBe("#4d7000");
    expect(c["--rag-red-text"]).toBe("#c41e5a");
  });
  test("AIPM dark keeps dimmer muted-foreground + dark -strong", () => {
    const store = reconcileBuiltins({ schemes: [], activeId: "AIPM" });
    const c = resolveSchemeColors(resolveActiveScheme(store, true));
    expect(c["--surface"]).toBe("#121619");
    expect(c["--muted-foreground"]).toBe("#9ca3a9");
    expect(c["--AIPM-pink-strong"]).toBe("#e96089");
  });
  test("Mockup is light-only with structural shadows + gradient", () => {
    const m = BUILTIN_SCHEMES.find((s) => s.id === "mockup")!;
    expect(m.supportsDark).toBe(false);
    const store = reconcileBuiltins({ schemes: [], activeId: "mockup" });
    expect(resolveActiveStructural(store)["--shadow-card"]).toContain("rgba");
  });
  test("resolveActiveStructural for AIPM = all none", () => {
    const store = reconcileBuiltins({ schemes: [], activeId: "AIPM" });
    expect(resolveActiveStructural(store)["--shadow-card"]).toBe("none");
  });
});
