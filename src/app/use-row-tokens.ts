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
// ★ This extraction was motivated by drift: four panels had independently
// hand-rolled the identical `useMemo(() => buildRowTokens(...), [list])`
// block, and a fifth (`raid-panel-rows.tsx`) had already diverged by dropping
// the `useMemo` entirely and recomputing the map on every render. One hook
// closes both the duplication and the drift.
//
// ★ The per-row fallback (`tokens.get(id) ?? name`) deliberately stays INLINE
// at each call site rather than folding into this hook. Every call site's
// fallback carries its own "why this can't actually miss" comment (see commit
// 420a096f) — folding the fallback in here would bury the reasoning that
// comment exists to surface, for a one-line saving.
//
// ★★★ THE SAME DEFECT HAS NOW BEEN FOUND ON FOUR SURFACES, each time on the
// row's own most PROMINENT control: a name button with NO `aria-label` at
// all, so its accessible name falls back to its CONTENT. Two rows sharing a
// display name then render two identically-named buttons. Found while
// grounding the row-unique-names slice; neither §247 nor §248 named it —
// task-row.tsx, task-kanban-card.tsx, milestones-panel.tsx and
// stakeholders-panel.tsx each found it independently by reading the row
// render body, and each now carries only a pointer back to this comment.
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
// something 2.5.3 itself demands. A prefix framing was written into one of
// the four call sites after this distinction had already been corrected at
// an earlier one in the same branch; state it as containment, not prefix, so
// that mistake is not made a fifth time.
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
