import { describe, expect, it } from "vitest";
import {
  BUILTIN_SCHEMES,
  BUILTIN_SCHEME_IDS,
  DEFAULT_SCHEME_ID,
  activeSchemeOf,
  reconcileBuiltins,
  resolveActiveScheme,
  HARBOR_DARK,
  HARBOR_LIGHT,
} from "./builtin-schemes";
import type { ColorScheme, SchemeStore } from "./color-schemes";
import { CORE_TOKENS, ADVANCED_TOKENS } from "./scheme-tokens";
import { checkSchemePairs } from "./scheme-contrast";

// The three code-owned built-ins are pure-seed (exactly the 21 editable tokens,
// dark-capable, designed AA-clean). AIPM/Mockup are no longer code built-ins —
// they ship as importable theme files.
const BUILTIN_IDS = ["harbor", "meridian", "umber"] as const;

const ALL_TOKENS = [...CORE_TOKENS, ...ADVANCED_TOKENS].map((t) => t.token);

const userScheme = (id: string, name: string): ColorScheme => ({
  id,
  name,
  supportsDark: false,
  light: { "--ui-green": "#123456" },
  branding: {},
});

describe("BUILTIN_SCHEMES", () => {
  it("ships harbor, meridian, umber — all code-owned, dark-capable; harbor is default", () => {
    expect(BUILTIN_SCHEMES.map((s) => s.id)).toEqual(["harbor", "meridian", "umber"]);
    for (const s of BUILTIN_SCHEMES) expect(s.builtIn).toBe(true);
    for (const s of BUILTIN_SCHEMES) expect(s.supportsDark).toBe(true);
    for (const s of BUILTIN_SCHEMES) expect(Boolean(s.dark)).toBe(true);
    expect(DEFAULT_SCHEME_ID).toBe("harbor");
    expect([...BUILTIN_SCHEME_IDS].sort()).toEqual(["harbor", "meridian", "umber"]);
    // AIPM / Mockup are no longer code built-ins.
    expect(BUILTIN_SCHEME_IDS.has("AIPM")).toBe(false);
    expect(BUILTIN_SCHEME_IDS.has("mockup")).toBe(false);
  });

  it("every built-in map (light + dark) includes all 21 editable tokens", () => {
    for (const s of BUILTIN_SCHEMES) {
      for (const map of [s.light, ...(s.dark ? [s.dark] : [])]) {
        for (const token of ALL_TOKENS) {
          expect(map[token], `${s.id}:${token}`).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });

  it("built-in maps contain EXACTLY the 21 editable tokens (no extras)", () => {
    for (const s of BUILTIN_SCHEMES) {
      for (const map of [s.light, s.dark!]) {
        expect(Object.keys(map).sort()).toEqual([...ALL_TOKENS].sort());
      }
    }
  });

  it("built-in maps (light AND dark) pass WCAG AA on all checked pairs", () => {
    const failures: string[] = [];
    for (const s of BUILTIN_SCHEMES) {
      for (const [mode, map] of [["light", s.light], ["dark", s.dark!]] as const) {
        for (const pair of checkSchemePairs(map)) {
          if (!pair.passesAa) failures.push(`${s.id}/${mode}/${pair.id}=${pair.ratio}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("BUILTIN_IDS matches the shipped built-in ids", () => {
    expect(BUILTIN_SCHEMES.map((s) => s.id)).toEqual([...BUILTIN_IDS]);
  });
});

describe("reconcileBuiltins", () => {
  it("seeds all built-ins into an empty store and defaults activeId to harbor", () => {
    const out = reconcileBuiltins({ schemes: [], activeId: null });
    expect(out.schemes.map((s) => s.id)).toEqual(["harbor", "meridian", "umber"]);
    expect(out.activeId).toBe("harbor");
  });

  it("keeps user schemes and preserves a still-valid user activeId", () => {
    const store: SchemeStore = { schemes: [userScheme("u-1", "Mine")], activeId: "u-1" };
    const out = reconcileBuiltins(store);
    expect(out.schemes.map((s) => s.id)).toEqual(["harbor", "meridian", "umber", "u-1"]);
    expect(out.activeId).toBe("u-1");
  });

  it("preserves a built-in activeId", () => {
    const out = reconcileBuiltins({ schemes: [], activeId: "umber" });
    expect(out.activeId).toBe("umber");
  });

  it("falls back to harbor for an orphaned AIPM activeId", () => {
    const out = reconcileBuiltins({ schemes: [], activeId: "AIPM" });
    expect(out.activeId).toBe("harbor");
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
      light: { "--ui-green": "#000000" },
      dark: { "--ui-green": "#ffffff" },
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
    harbor.light["--ui-green"] = "#deadbe";
    expect(HARBOR_LIGHT["--ui-green"]).toBe("#2bc4b6");
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
    expect(resolveActiveScheme(store, true)).toEqual({ "--ui-green": "#123456" });
  });

  it("falls back to Harbor when activeId is unknown", () => {
    const store: SchemeStore = { schemes: [...BUILTIN_SCHEMES], activeId: "nope" };
    expect(activeSchemeOf(store).id).toBe("harbor");
  });
});
