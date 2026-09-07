import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The shared arrangement engine must not name a surface in its i18n keys.
 *
 * ★★★ WHY THIS IS A TEST AND NOT A CONVENTION. `arrangement-*` renders BOTH the
 * Dashboard and Reports, and until 0.290.x every string it read was called
 * `dashboardTile*` / `dashboardShelf*` — thirteen keys. Nothing was broken by
 * that, which is exactly the problem: someone reasonably editing a
 * "Dashboard-local" wording would have silently retitled Reports, in both
 * languages, with every gate green. tsc sees a valid key, the axe gate sees a
 * named control, and `docs:symbols:check` only proves a name exists somewhere.
 * A surface-named key in shared code is invisible to all of them.
 *
 * ★★ THE FILE SET IS DISCOVERED, NOT LISTED, AND THAT IS DELIBERATE. A
 * hardcoded path list does not follow a move: `table-head-sweep.test.ts` named
 * `reports.tsx`, the tables moved to `reports-blocks.tsx`, and CI went red with
 * every local gate green. A `readdirSync` prefix scan keeps working through a
 * rename of any individual module and picks up a NEW `arrangement-*` file for
 * free — which is the case that matters, since a new shared module is exactly
 * where this defect would reappear.
 * ★ The cost is that renaming the PREFIX itself (or moving the engine to a
 * subdirectory) silently empties the scan, so the floor below is load-bearing:
 * an empty sweep passes every assertion and reports success.
 */

const DIR = __dirname;

/** Surface prefixes that must never appear in a shared module's i18n keys. */
const SURFACE_PREFIXES = ["dashboard", "reports"];

/** Shared engine modules: every `arrangement-*` source that is not a test. */
function sharedModules(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.startsWith("arrangement-"))
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .filter((f) => !f.includes(".test.") && !f.includes(".property."))
    .sort();
}

/** Every `t(..., "someKey")` key literal in a source. */
function keyLiterals(src: string): string[] {
  return [...src.matchAll(/"([a-z][A-Za-z0-9]*)"/g)].map((m) => m[1]);
}

describe("the shared arrangement engine is surface-neutral in i18n", () => {
  // ★★★ THE ANTI-VACUITY FLOOR. Without it, a prefix rename or a move to a
  // subdirectory empties `sharedModules()` and every test below passes over
  // NOTHING. Named members rather than a bare count, so adding a module does not
  // require touching a number — the repo's "members, not a tally" rule.
  it("discovers the shared modules it claims to scan", () => {
    const found = sharedModules();
    expect(found.length).toBeGreaterThanOrEqual(5);
    for (const required of ["arrangement-block-menu.tsx", "arrangement-shelf.tsx", "arrangement-tile.tsx"]) {
      expect(found, `${required} must be in the scanned set`).toContain(required);
    }
  });

  it("reads real content from every discovered module", () => {
    // Guards the other direction: a scan that reads empty strings would find no
    // violations either. Every shared module must actually contain source.
    for (const f of sharedModules()) {
      const src = readFileSync(join(DIR, f), "utf8");
      expect(src.length, `${f} is empty`).toBeGreaterThan(200);
    }
  });

  it("names no surface in any i18n key it reads", () => {
    const offenders: string[] = [];
    for (const f of sharedModules()) {
      const src = readFileSync(join(DIR, f), "utf8");
      for (const key of keyLiterals(src)) {
        for (const prefix of SURFACE_PREFIXES) {
          // `dashboardTileWidth` offends; `dashboard` alone is a view id, not a
          // key, and never reaches `t()` from here.
          if (key.startsWith(prefix) && key.length > prefix.length) {
            offenders.push(`${f}: ${key}`);
          }
        }
      }
    }
    expect(offenders, "a shared module must not read a surface-named i18n key").toEqual([]);
  });

  // ★★ THE DETECTOR ITSELF, pinned. An `toEqual([])` assertion passes just as
  // well against a matcher that can never match anything, which is how a
  // narrowed key regex would go unnoticed. This proves the matcher fires on the
  // exact shape the thirteen renamed keys had.
  it("would catch a surface-named key if one came back", () => {
    const planted = 'const label = t(lang, "dashboardTileWidth");';
    const keys = keyLiterals(planted);
    expect(keys).toContain("dashboardTileWidth");
    const offends = keys.some((k) =>
      SURFACE_PREFIXES.some((p) => k.startsWith(p) && k.length > p.length),
    );
    expect(offends).toBe(true);
    // …and does not fire on the neutral name that replaced it.
    const neutral = keyLiterals('const label = t(lang, "arrangementTileWidth");');
    expect(
      neutral.some((k) => SURFACE_PREFIXES.some((p) => k.startsWith(p) && k.length > p.length)),
    ).toBe(false);
  });
});
