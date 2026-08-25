// Shared assertion: no two controls in a scope share an accessible name.
//
// ★★★ WHY THIS EXISTS. axe has NO rule that flags two controls sharing an
// accessible name, under any tag `e2e/a11y.spec.ts` requests, at any seed size.
// A unit test is the only detector that can exist for WCAG 2.4.6 here — so a
// VACUOUS one is worse than none, because it reads as coverage.
//
// ★★ `minRows` is REQUIRED and THROWS when unmet. A fixture rendering one row
// cannot express a collision and would pass against defective code. Making that
// a throw rather than a pass is the difference between a detector and a decoration.
import { expect } from "vitest";
import { controlNames } from "./toolbar-order";

export interface RowUniqueOptions {
  /** Minimum controls the scope must render. Throws below this — never passes. */
  readonly minRows: number;
  /** Container to scope to. Defaults to the whole document. */
  readonly scope?: HTMLElement;
  /** Roles to check. Defaults to buttons. */
  readonly roles?: readonly string[];
}

export function expectRowUniqueNames(opts: RowUniqueOptions): void {
  const { minRows, scope, roles = ["button"] } = opts;
  const names = controlNames(roles, scope);

  if (names.length < minRows) {
    throw new Error(
      `expectRowUniqueNames: minRows is ${minRows} but the scope rendered ${names.length} ` +
        `control(s) of role(s) [${roles.join(", ")}]. A fixture too small to express a ` +
        `collision would pass against defective code, so this is a hard failure. ` +
        `Seed more rows. Rendered: [${names.join(" | ")}]`,
    );
  }

  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const dupes = [...counts.entries()].filter(([, c]) => c > 1);

  expect(
    dupes,
    dupes.length === 0
      ? ""
      : `WCAG 2.4.6: ${dupes.length} accessible name(s) are shared by more than one control — ` +
        dupes.map(([n, c]) => `"${n}" x${c}`).join(", "),
  ).toEqual([]);
}
