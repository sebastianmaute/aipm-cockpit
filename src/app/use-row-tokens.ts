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
