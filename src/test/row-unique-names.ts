// Shared assertion: no two controls in a scope share an accessible name.
//
// ★★★ WHY THIS EXISTS. axe has NO rule that flags two controls sharing an
// accessible name, under any tag `e2e/a11y.spec.ts` requests, at any seed size.
// A unit test is the only detector that can exist for WCAG 2.4.6 here — so a
// VACUOUS one is worse than none, because it reads as coverage.
//
// ★★★ THE TWO OPTIONS GUARD DIFFERENT THINGS, AND CONFLATING THEM IS HOW THIS
// HELPER SHIPPED WITH A FALSE PROMISE. `minControls` was originally spelled
// minRows (deliberately un-backticked — it is a RETIRED name, kept here only to
// explain the rename) and was documented here as making a one-row fixture
// unreachable. It never did.
// It is compared against the number of CONTROLS of the requested roles, in a
// scope that DEFAULTS TO THE WHOLE DOCUMENT — so a panel's toolbar alone can
// satisfy any plausible floor, and the field has nothing to do with rows.
// Measured, not reasoned: at `documents-panel.test.tsx`'s "keeps every per-row
// control distinct when two documents share a title" (floor 2), reducing the
// fixture to ONE document still PASSED, and reducing it to ZERO
// (`renderLive([])`) still PASSED — one documents row renders six buttons and
// the panel toolbar renders five. The old name promised a property it never
// had.
//
// ★★ SO, PRECISELY:
//   `minControls` guarantees the scope is NON-EMPTY — that it rendered at
//     least that many controls of the requested roles, so a query typo or a
//     panel that silently rendered nothing cannot read as a pass. That is ALL
//     it guarantees. It is NOT a row count, and it does NOT guarantee the
//     fixture can express a collision.
//   `requireCollisionSeed` THROWS unless two rendered names are identical once
//     the occurrence suffix is stripped and whitespace collapsed. LIMITATION:
//     that is not the same as "the fixture seeded a shared display name" — two
//     rows genuinely titled "Q3 report (1)" and "Q3 report (2)" strip to the
//     same string, and a single row plus any other control can satisfy it too.
//     ★ It does not discriminate by CONTROL either — it is satisfied by ANY
//     two names colliding within the requested `roles`, so an unrelated
//     control's genuine collision can mask a broken one elsewhere in scope.
//     The only automatic guard against that, given a narrowed `roles` list,
//     is a `minControls` floor kept at its exact measured value.
//
// ★★ `requireCollisionSeed` is OPT-IN, and that is deliberate rather than
// laziness. Most adopting tests are regression pins over DISTINCT-name
// fixtures ("all four row verbs are qualified, and the toolbar does not
// collide with them") — a legitimate but different assertion. Turning the
// guard on there would throw at fixtures that are seeding exactly what they
// mean to seed. Turn it on wherever the test's own name or comment claims to
// cover a shared-name collision.
//
// ★ SCOPE CHOICE: default to whole-container scope. Narrow to a sub-tree only
// when a specific, named collision with unrelated chrome has been confirmed
// in that panel — and say which one, in a comment at the narrowing.
// `change-panel.test.tsx` is the worked example: it narrows to `tbody`
// because that panel reuses one translation string across a toolbar filter
// select and a sortable-header button, a collision unrelated to row identity.
// `milestones-panel.test.tsx` uses whole-container because its Status column
// is a plain non-sortable `<th>` with no such collision to dodge.
import { expect } from "vitest";
import { controlNames } from "./toolbar-order";

/**
 * The occurrence index `buildRowTokens` (`src/app/row-tokens.ts`) appends to
 * every row whose display name collides: a space, then `(N)` with N one or
 * more digits, at the END of the token — and `rowLabel` puts the token last,
 * so it is at the end of the accessible name too. Both the ordinary branch
 * (`${row.name} (${occurrence})`) and the escalation branch
 * (`${row.name} (${bump})`) emit exactly this shape.
 *
 * ★ A surface that disambiguates some OTHER way — `documents-deleted-section.tsx`
 * appends ` · #${id}` — does not produce a stripped pair, so
 * `requireCollisionSeed` refuses to certify it.
 */
const OCCURRENCE_SUFFIX = / \(\d+\)$/;

export interface RowUniqueOptions {
  /**
   * Minimum controls of `roles` the scope must render. Throws below this.
   *
   * ★ CONTROLS, NOT ROWS, and the scope defaults to the whole document — this
   * only proves the scope is non-empty. Use `requireCollisionSeed` to prove
   * the fixture can express a collision at all.
   */
  readonly minControls: number;
  /** Container to scope to. Defaults to the whole document. */
  readonly scope?: HTMLElement;
  /** Roles to check. Defaults to buttons. */
  readonly roles?: readonly string[];
  /**
   * THROW unless two rendered names are identical once the occurrence suffix
   * is stripped and whitespace collapsed. Turn this on wherever the test
   * claims to cover a collision.
   */
  readonly requireCollisionSeed?: boolean;
}

export function expectRowUniqueNames(opts: RowUniqueOptions): void {
  const { minControls, scope, roles = ["button"], requireCollisionSeed = false } = opts;
  const names = controlNames(roles, scope);

  if (names.length < minControls) {
    throw new Error(
      `expectRowUniqueNames: minControls is ${minControls} but the scope rendered ${names.length} ` +
        `control(s) of role(s) [${roles.join(", ")}]. An empty or near-empty scope says nothing ` +
        `about uniqueness, so this is a hard failure rather than a pass. Note this counts ` +
        `CONTROLS, not rows, over the whole document unless \`scope\` was given. ` +
        `Rendered: [${names.join(" | ")}]`,
    );
  }

  if (requireCollisionSeed) {
    // ★★ COLLAPSE BEFORE COMPARING, exactly as `buildRowTokens` does. It keys its
    // collision counts on a whitespace-collapsed name because an accessible name
    // compares that way, so a fixture seeding "Risk  A" against "Risk A" IS
    // collision-bearing and the tokeniser correctly qualifies both. Comparing the
    // stripped names RAW here would make this guard THROW at that fixture — the
    // guard rejecting the very case it exists to certify. Found by reading, not by
    // a failing run.
    const stripped = names.map((n) => n.replace(OCCURRENCE_SUFFIX, "").replace(/\s+/g, " "));
    const strippedCounts = new Map<string, number>();
    for (const n of stripped) strippedCounts.set(n, (strippedCounts.get(n) ?? 0) + 1);
    if (![...strippedCounts.values()].some((c) => c > 1)) {
      throw new Error(
        `expectRowUniqueNames: requireCollisionSeed is on, but no two of the ${names.length} ` +
          `rendered name(s) match once the "(N)" occurrence suffix is stripped — so the fixture ` +
          `seeded no two rows sharing a display name, and this assertion cannot fail against ` +
          `defective code. Seed two rows with the SAME display name, or drop ` +
          `requireCollisionSeed if this test is a distinct-name regression pin. ` +
          `Rendered: [${names.join(" | ")}]`,
      );
    }
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
