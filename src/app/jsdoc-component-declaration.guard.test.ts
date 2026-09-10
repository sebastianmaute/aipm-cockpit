import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * No source may declare a React component by JSDoc alone.
 *
 * ★★★ WHY THIS IS A TEST AND NOT A CONVENTION. Under ESLint 10,
 * `eslint-plugin-react`'s `componentUtil.isExplicitComponent` calls
 * `sourceCode.getJSDocComment`, which ESLint 10 removed. The call sits inside a
 * pre-existing try/catch that swallows the resulting TypeError and treats the
 * node as having no comment — so a class whose ONLY claim to being a component
 * is a JSDoc augments/extends tag stops being detected, and every react/* rule
 * that depends on component detection silently stops applying to it. There is
 * no crash, no warning and no gate: lint exits 0, the axe gate sees nothing,
 * and `docs:symbols:check` only proves that names exist.
 *
 * The repo has zero such declarations today, which is what made the ESLint 10
 * upgrade safe. This test is what keeps that true. If it goes red, the fix is
 * NOT to relax it — make the class extend the component syntactically, which is
 * what the rest of the codebase already does.
 *
 * ★★ THE NEEDLES ARE BUILT BY CONCATENATION so this file cannot match itself.
 * A comment quoting the literal tag would make the scan find its own docstring
 * and go permanently red for the wrong reason.
 *
 * ★★ THE FILE SET IS DISCOVERED, NOT LISTED. A hardcoded path list does not
 * follow a move, and a move is exactly when a new declaration would slip in.
 * The floor below is therefore load-bearing: an empty walk passes every
 * assertion beneath it and reports success.
 */

const REPO = join(__dirname, "..", "..");

/**
 * ★★ SCOPE MUST MATCH LINT'S, and it did not until 0.301.x. `npm run lint` takes no path
 * argument, so it covers the whole repo; this scan covered `src/` alone, leaving every
 * `.ts`/`.tsx` under `e2e/`, `scripts/` and the root configs unscanned beneath a heading
 * that claims to cover every source. A tree missing from here is invisible, not loud —
 * which is why each tree below has a named member in the floor test.
 */
const TREES = ["src", "e2e", "scripts"];

/** `@augments` and `@extends`, assembled so this file is not its own match. */
const NEEDLES = ["@" + "augments", "@" + "extends"];

const SELF = "jsdoc-component-declaration.guard.test.ts";

/** Every `.ts`/`.tsx` in the scanned trees plus the root configs, except this file. */
function sources(): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (entry.name === SELF) continue;
      out.push(full);
    }
  }
  for (const tree of TREES) walk(join(REPO, tree));
  // Root-level configs (next.config.ts, vitest.config.ts, …) are linted too. Non-recursive
  // on purpose — recursing the repo root would descend into node_modules.
  for (const entry of readdirSync(REPO, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (!/\.tsx?$/.test(entry.name)) continue;
    out.push(join(REPO, entry.name));
  }
  return out.sort();
}

/**
 * The offender predicate, shared by the scan and by its own positive control. Extracted
 * so the needle set cannot be narrowed without a test going red — narrowing NEEDLES to a
 * single entry once left the whole suite green WITH a live offender in the tree.
 */
function offendersIn(src: string, label: string): string[] {
  const hits: string[] = [];
  for (const needle of NEEDLES) {
    if (src.includes(needle)) hits.push(`${label} contains ${needle}`);
  }
  return hits;
}

describe("no React component is declared by JSDoc alone", () => {
  // ★★★ ANTI-VACUITY FLOOR. Without it, a moved directory or a changed
  // extension empties the walk and every assertion below passes over NOTHING.
  // Named members alongside the count, so the set can grow without touching a
  // number, and a rename of any single module still leaves the floor meaningful.
  it("discovers the sources it claims to scan", () => {
    const found = sources();
    expect(found.length).toBeGreaterThanOrEqual(1500);
    const names = found.map((f) => relative(REPO, f).split(/[\\/]/).join("/"));
    // ★★ THE FLOOR IS A BACKSTOP; THESE MEMBERS ARE THE DETECTOR. At ~2080 discovered the
    // floor tolerates losing a quarter of the tree, so it only catches a walk that empties
    // (or nearly does). One member per scanned tree — and two from NESTED directories —
    // is what catches a tree silently dropped or a walk that stops descending.
    for (const required of [
      "src/app/error-boundary.tsx",
      "src/app/next-actions/group.ts",
      "src/test/row-unique-names.ts",
      "e2e/a11y.spec.ts",
      "scripts/ai-eval.ts",
      "next.config.ts",
    ]) {
      expect(names, `${required} must be in the scanned set`).toContain(required);
    }
  });

  it("reads real content from the sources it scans", () => {
    // ★ WHAT THIS ACTUALLY GUARDS. The comment here used to claim it covered "a walk
    // returning empty strings" — it never could: sources() returns PATHS, and the offender
    // scan does its own readFileSync. What it pins is that a file the scan will read has
    // real content at this location. Sample rather than assert on every file, since plenty
    // of small modules are legitimately short.
    const src = readFileSync(join(REPO, "src", "app", "error-boundary.tsx"), "utf8");
    expect(src.length).toBeGreaterThan(200);
    // Loose on purpose: pinning the exact spelling would red this test if the class were
    // refactored to `extends React.Component`, which is the same syntactic declaration.
    expect(src).toMatch(/extends\s+(React\.)?(Pure)?Component/);
  });

  it("fires on every needle it claims to scan for", () => {
    // ★★★ THE POSITIVE CONTROL FOR THE NEEDLE SET. Without it the set is unpinned:
    // narrowing NEEDLES to a single entry was measured to leave all other assertions green
    // even with a live offender planted in the tree — a mutation that survives is a missing
    // test, and this is it. A negative result ("no offenders") is worth nothing unless the
    // detector is shown to fire.
    expect(NEEDLES.length).toBeGreaterThanOrEqual(2);
    for (const needle of NEEDLES) {
      const synthetic = `/** ${needle} React.Component */\nclass X {}\n`;
      expect(offendersIn(synthetic, "synthetic"), `${needle} must be detected`).toEqual([
        `synthetic contains ${needle}`,
      ]);
    }
    // And the other direction — a clean source must produce nothing, or the scan would
    // report every file and the empty-offenders assertion below would be unfalsifiable.
    expect(offendersIn("class X extends Component {}\n", "clean")).toEqual([]);
  });

  it("finds no JSDoc-only component declaration anywhere in the linted trees", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const label = relative(REPO, file).split(/[\\/]/).join("/");
      offenders.push(...offendersIn(readFileSync(file, "utf8"), label));
    }
    expect(offenders).toEqual([]);
  });
});
