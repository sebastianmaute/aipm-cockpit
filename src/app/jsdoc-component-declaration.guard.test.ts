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

const ROOT = join(__dirname, "..");

/** `@augments` and `@extends`, assembled so this file is not its own match. */
const NEEDLES = ["@" + "augments", "@" + "extends"];

const SELF = "jsdoc-component-declaration.guard.test.ts";

/** Every `.ts`/`.tsx` under `src/`, except this file. */
function sources(): string[] {
  const out: string[] = [];
  (function walk(dir: string): void {
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
  })(ROOT);
  return out.sort();
}

describe("no React component is declared by JSDoc alone", () => {
  // ★★★ ANTI-VACUITY FLOOR. Without it, a moved directory or a changed
  // extension empties the walk and every assertion below passes over NOTHING.
  // Named members alongside the count, so the set can grow without touching a
  // number, and a rename of any single module still leaves the floor meaningful.
  it("discovers the sources it claims to scan", () => {
    const found = sources();
    expect(found.length).toBeGreaterThanOrEqual(1500);
    const names = found.map((f) => relative(ROOT, f).split(/[\\/]/).join("/"));
    for (const required of ["app/error-boundary.tsx", "app/task-manager.tsx", "app/types.ts"]) {
      expect(names, `${required} must be in the scanned set`).toContain(required);
    }
  });

  it("reads real content from the sources it scans", () => {
    // Guards the other direction: a walk returning empty strings finds no
    // offender either. Sample rather than assert on every file, since plenty of
    // small modules are legitimately short.
    const src = readFileSync(join(ROOT, "app", "error-boundary.tsx"), "utf8");
    expect(src.length).toBeGreaterThan(200);
    expect(src).toContain("extends Component");
  });

  it("finds no JSDoc-only component declaration anywhere under src", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const src = readFileSync(file, "utf8");
      for (const needle of NEEDLES) {
        if (src.includes(needle)) {
          offenders.push(`${relative(ROOT, file).split(/[\\/]/).join("/")} contains ${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
