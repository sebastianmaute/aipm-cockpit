import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The shared arrangement engine must not name a surface in its i18n keys.
 *
 * ★★★ WHY THIS IS A TEST AND NOT A CONVENTION. `arrangement-*` renders BOTH the
 * Dashboard and Reports, and every string it read was called
 * `dashboardTile*` / `dashboardShelf*` — thirteen keys, which were renamed to
 * the `arrangement*` spellings used today. Nothing was broken by
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
 *
 * ★★★ IF YOU EVER ADD AN EXEMPTION HERE, ADD THE OPPOSITE ASSERTION WITH IT.
 * This scan has ZERO allowlisted keys today, which is why the floors below are
 * two separate, bolted-on guards. The moment an allowlist exists, assert BOTH
 * directions — no undocumented offender, AND no allowlisted key that has
 * stopped offending. The second is the one people skip, and skipping it is
 * worse than clutter: a stale exemption is a HOLE, because the next call site
 * to use that key is silently exempt for a reason that stopped being true. It
 * also subsumes the vacuity floor for free — if the walk ever empties, every
 * exemption reads as stale and the suite goes red on its own. That mechanism
 * is not available to a zero-exemption scan, so until then the floors stay.
 * ★ The pattern was measured independently, on the same day, by a plural-pairs
 * detector on a parallel branch. That file is deliberately NOT named here: it
 * does not exist in this tree and may never land, and a backticked name for a
 * file nobody can grep is the invented-identifier trap this repo keeps paying
 * for. The reasoning stands on its own.
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

/**
 * Every double-quoted camelCase string literal in a source — deliberately
 * BROADER than `t()` call sites, so a key reached indirectly is still scanned.
 *
 * ★★ IT IS ALSO NARROWER THAN `t()` IN THE OTHER DIRECTION, and an earlier
 * revision of this docstring claimed it matched exactly the key literals passed
 * to `t()`, which
 * is wrong both ways. It matches className fragments, test ids and prop values
 * too (harmless — they are not surface-prefixed), and it CANNOT see a key
 * passed as a variable or built from a template. The over-match is the safe
 * direction for a sweep; the under-match is the real limit.
 */
function keyLiterals(src: string): string[] {
  return [...src.matchAll(/"([a-z][A-Za-z0-9]*)"/g)].map((m) => m[1]);
}

/**
 * The two surfaces that bind the shared engine. Named because they ARE the
 * surfaces, not as a path list of modules — see the cross-surface test below.
 */
const SURFACE_FILES = ["reports.tsx", "dashboard-panel.tsx"];

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

  /**
   * ★★★ THE SCAN ABOVE IS NARROWER THAN THE DEFECT, WHICH A COLD REVIEW HAD TO
   * TELL ME. `sharedModules()` sees only `arrangement-*`, and THREE of the
   * thirteen keys renamed in this slice — `arrangementTileHidden`,
   * `arrangementTileMoved` and `arrangementTileResized` — are read by the
   * SURFACES directly, not by the engine. Reverting
   * exactly those three to `dashboardTile*` left the sweep above GREEN.
   *
   * This closes that: a key read by BOTH surfaces must not name either of them.
   * The reader set is discovered per key rather than listed, so it needs no
   * allowlist — measured 0 surface-prefixed keys among the 13 both surfaces
   * share today.
   *
   * ★★ THE RESIDUAL GAP, STATED RATHER THAN LEFT TO BE REDISCOVERED: shared
   * CHROME that neither surface file reads directly is still unscanned. That is
   * exactly how a fourteenth key was missed — `ResetLayoutButton`
   * (`task-manager-ui.tsx`) is rendered by `dashboard-panel.tsx` AND
   * `report-table.tsx`, so neither this test nor the one above could see it, and
   * it was found by review. It has been renamed, but the hole it came through is
   * still open. A one-hop import scan does NOT close it either: `reports.tsx`
   * imports `arrangement-*` five times and `dashboard-panel.tsx` imports it ZERO
   * times, reaching the engine through the `dashboard-*` adapters.
   */
  it("lets no surface-named key be shared by both surfaces", () => {
    const read = (f: string) =>
      new Set(keyLiterals(readFileSync(join(DIR, f), "utf8")));
    const [a, b] = SURFACE_FILES.map(read);

    // Floor: if either surface stops being readable or stops holding keys, the
    // intersection empties and the assertion below passes over nothing.
    // ★★ A NAMED MEMBER, NOT A TALLY. The first cut of this floor guessed
    // `> 20` and went red on the spot — `dashboard-panel.tsx` yields 19 key
    // literals — which is the invented-threshold trap in miniature. This member
    // is one of the three keys the test above cannot see, so it is exactly the
    // thing whose disappearance should break the floor.
    for (const [i, set] of [a, b].entries()) {
      expect(set, `${SURFACE_FILES[i]} yielded no arrangement key literals`)
        .toContain("arrangementTileMoved");
    }

    const shared = [...a].filter((k) => b.has(k));
    expect(shared.length, "the two surfaces share no keys at all — scan is vacuous")
      .toBeGreaterThan(5);

    const offenders = shared.filter((k) =>
      SURFACE_PREFIXES.some((p) => k.startsWith(p) && k.length > p.length),
    );
    expect(offenders, "a key both surfaces read must not name one of them").toEqual([]);
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
