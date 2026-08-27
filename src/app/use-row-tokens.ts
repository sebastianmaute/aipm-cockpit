// One row-token map per rendered list. See `row-tokens.ts` for the tokeniser
// (`buildRowTokens`/`rowLabel`) this hook wraps in a `useMemo`.
//
// ★★★ CALLERS MUST PASS A MODULE-LEVEL ACCESSOR, NEVER AN INLINE ARROW. An
// inline `(x) => x.name` is a fresh closure every render: it defeats the
// `useMemo` (the dep array never sees the same function twice, so the map is
// rebuilt on every render regardless of whether `list` changed) AND it trips
// `react-hooks/exhaustive-deps`, which is FATAL in this repo
// (`--max-warnings=0`). Declare the accessor at module scope instead, e.g.
//
//   const nameOfMilestone = (m: Milestone) => m.name;
//   const tokens = useRowTokens(sorted, nameOfMilestone);
//
// ★ This extraction was motivated by drift: several panels had independently
// hand-rolled the identical `useMemo(() => buildRowTokens(...), [list])`
// block, and one (`raid-panel-rows.tsx`) called `buildRowTokens` bare,
// recomputing the map on every render. One hook closes both the duplication
// and the drift. ★ NO COUNT IS QUOTED — the extraction converted only some of
// them and the rest still hand-roll it, so a number here rots on the next
// conversion (same reason as the ★ NO COUNT note further down). Read today's
// set with:
//   git grep -l buildRowTokens -- 'src/app/*.tsx' | grep -v test
//
// ★ The per-row fallback (`tokens.get(id) ?? name`) deliberately stays INLINE
// at each call site so each site can carry its own "why this can't actually
// miss" comment next to the code it is about — folding the fallback in here
// would bury that reasoning for a one-line saving.
//
// ★★ THAT IS THE DESIGN RULE, NOT A CLAIM OF COVERAGE. This comment used to
// say "Every call site's fallback carries its own … comment", and that was
// false when written — several sites are bare. A false coverage claim is
// worse than none: it tells a contributor who wants to fold the fallback in
// here that the reasoning is already documented everywhere, so they decline
// on a premise nothing checks. Add the comment when you touch a site that
// lacks one; do not restore a universal.
//
// ★★★ THE SAME DEFECT RECURS on every surface where a row's own most
// PROMINENT control — a name/title button — carries NO `aria-label` at
// all, so its accessible name falls back to its CONTENT, and two rows
// sharing a display name render two identically-named buttons. Found
// while grounding the row-unique-names slice; neither §247 nor §248
// named it, and each surface that hit it found it independently by
// reading its own row render body — each now carries only a pointer
// back to this comment.
//
// ★ NO COUNT IS QUOTED HERE — one was accurate for exactly one commit
// before the next task fixed another surface, and no gate can see a
// count rot (AGENTS.md records the same class: "the 20 lazy panels"
// passing every run while the number was 23). Read today's set instead:
//   grep -rln "aria-label={rowToken}\|aria-label={token}" src/app --include=*.tsx | grep -v test
// `documents-list.tsx` is in that set and predates this slice — this is
// the set of surfaces USING the fix, not a tally of what this slice found.
//
// The fix is `aria-label={rowToken}` (the local token/`?? name` fallback),
// set UNCONDITIONALLY on the button — not only when a collision is present.
// With no collision the token IS the bare name, so this restates the visible
// content rather than changing behaviour for the common case.
//
// ★ WCAG 2.5.3 holds by CONTAINMENT, not by PREFIX: the visible name (e.g.
// "Alpha") sits somewhere INSIDE the accessible name (e.g. "Alpha (1)"), and
// that is all 2.5.3 requires. Do NOT read this as "the token must START WITH
// the visible name" — prefix is a STRICTER rule than the SC and flags
// perfectly conformant code elsewhere in this app (see the `rowLabel`
// docstring in row-tokens.ts and the matching AGENTS.md landmine). It holds
// here only because `buildRowTokens` APPENDS the occurrence suffix rather
// than prepending it — an implementation detail of this module, not
// something 2.5.3 itself demands. A prefix framing was written into one call
// site after this distinction had already been corrected at another one in
// the same branch; state it as containment, not prefix, so that mistake is
// not repeated.
import { useMemo } from "react";
import { buildRowTokens } from "./row-tokens";

export function useRowTokens<T extends { id: number }>(
  list: readonly T[],
  nameOf: (item: T) => string,
): ReadonlyMap<number, string> {
  return useMemo(
    () => buildRowTokens(list.map((item) => ({ id: item.id, name: nameOf(item) }))),
    [list, nameOf],
  );
}
