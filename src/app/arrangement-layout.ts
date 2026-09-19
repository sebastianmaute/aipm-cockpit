/**
 * The shared arrangement layout engine — pure, i18n-free, DOM-free, and
 * generic over the block id. The Dashboard and Reports each bind it to their
 * own catalogue; no FUNCTION in here knows which surface it is serving.
 *
 * ★★ THE SHAPE STILL CARRIES TWO DASHBOARD ASSUMPTIONS, AND EVERY BINDING MUST
 * ACCEPT THEM. An earlier revision of this line claimed outright that "nothing
 * in here knows which surface it is serving", which is true of the code and
 * false of the types:
 *   1. `BlockWidth` is `1|2|3|4` — a FOUR-COLUMN grid, baked in as a closed
 *      union. It is `xl:grid-cols-4` hardened into a type. ★ That class used to
 *      be the DASHBOARD's, in `dashboard-grid.tsx`; it is now the shared
 *      `ArrangementGrid`'s (`arrangement-grid.tsx`), so this is no longer one
 *      surface's assumption leaking into the engine — the grid, this union and
 *      `W_CLASS`'s clamp are three spellings of the same four columns and move
 *      together. A surface wanting 6 columns cannot express it here; widening
 *      the union is a change to all three and to every binding at once, so cost
 *      it as one rather than treating it as local.
 *   2. `defaultLayout` places EVERY catalogue member on the board, and
 *      `reconcile` step 2 re-inserts every absent one. So a block cannot be
 *      declared hidden-by-default in the CATALOGUE. ★ It CAN still be hidden by
 *      default — the `fallback` is a plain parameter, so a surface seeds its
 *      own default with ids already in `hidden` and `reconcile` honours them
 *      thereafter (pinned by "a surface may seed a block hidden by default").
 *      What is NOT reachable is hiding a NEWLY ADDED catalogue block for users
 *      who already have a stored layout: step 2 puts it on their board by
 *      design (see its own ★★ below). A migration that wants otherwise must
 *      write the `hidden` list itself.
 *
 * ★★ THE CATALOGUE IS A PARAMETER, NEVER A FREE VARIABLE. This file was
 * extracted from `dashboard-layout.ts`, where `reconcile` read `DASHBOARD_TILES`
 * from module scope three times and `restoreTile`/`resizeTile` reached it
 * through `tileById`. That is exactly what made it un-reusable. A future
 * "convenience" default for the catalogue argument would put it straight back.
 *
 * ★★ ORDER IS THE ENTIRE PLACEMENT MODEL. There are no coordinates: the grid
 * renders with `grid-auto-flow: row dense`, which resolves an ordered list into
 * cells. That is what keeps every operation here an array operation, and it is
 * also why a user cannot leave a deliberate hole — dense backfills.
 *
 * ★★ THE FOUR MUTATORS RETURN THE SAME OBJECT REFERENCE ON A NO-OP, so callers
 * can skip a persist cheaply — `moveBlock` · `hideBlock` · `restoreBlock` ·
 * `resizeBlock`, each pinned by its own "returns the same object" test.
 * **`reconcile` IS NOT ONE OF THEM** and never has been: it allocates a fresh
 * `{v, board, hidden}` on EVERY non-null input, identical content or not. That
 * costs nothing today because every production call site is a LOAD — a
 * `readLayout` that discards the input anyway.
 * ★ The TWO call sites belong to `readLayout`, not to this function: the lazy
 * `useState` initialiser and the project-switch render reconcile. An earlier
 * revision of this docstring attributed both to `reconcile`, which sends a
 * reader looking for a second caller that does not exist. Enumerate today's
 * callers rather than trusting this line — the set moves with every surface
 * that binds the engine, and each binds under its own local name:
 * `grep -rn "reconcile(\|reconcileWith(" src/app --include=*.ts --include=*.tsx | grep -v '\.test\.'`
 * ★ That grep matches PROSE too, this docstring included, so read the hits and
 * do not count them — prose is the MAJORITY of them. The CODE hits are the
 * Dashboard adapter's `reconcileWith(...)` in `dashboard-layout.ts`, and
 * `reconcile(...)` inside `readLayout` in `use-arrangement.ts`.
 * ★★ TWO CLAIMS THAT SAT HERE WERE FALSE, both re-staled by later commits on
 * the branch that wrote them. The second call site was attributed to
 * `use-dashboard-layout.ts`, which has held no `readLayout` since the hook was
 * extracted; and "Reports adds a third when it binds" did not happen — Reports
 * binds through the shared `use-arrangement.ts`, so a new surface adds NO call
 * site here, which is the point of the shared hook. Expect that set to stay at
 * two however many surfaces bind.
 * A persist-skip built on `next !== stored` would fire on every load, so do not
 * build one, and do not read the mutators' contract as covering it.
 *
 * ★ `reconcile`'s `fallback` is returned BY REFERENCE for a null blob and is
 * used for NOTHING else. Each surface must therefore hold ONE memoized default
 * — see `dashboard-layout.ts` — because `reset()` returns that same object and
 * the no-op contract above is reference equality. A caller passing a freshly
 * built `defaultLayout(...)` per call silently defeats it.
 */
import { reorderIds } from "./list-reorder";
import type { TranslationKey } from "./i18n";

/** A block spans 1-4 grid COLUMNS. A CLOSED union on purpose: `number` would
 *  let an un-clamped value through the type system into storage.
 *  ★★ WIDTH AND HEIGHT ARE SEPARATE TYPES SINCE SPEC C (decision 10). They were
 *  one `1|2|3|4` union; heights 5–8 had to exist for the Dashboard's tall Budget
 *  burn tile, and widening a shared union would have let an 8-WIDE block
 *  type-check — `W_CLASS` has no entry for it, so it would render one column
 *  wide with nothing able to see it. */
export type BlockWidth = 1 | 2 | 3 | 4;

/** A block spans 1-8 grid ROWS. Rows are not a grid dimension, so nothing but a
 *  catalogue's own `maxH` bounds a surface: the Dashboard reaches 8, Reports
 *  caps itself at 4 (`report-blocks.test.ts` pins it). */
export type BlockHeight = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * One block's declaration: what it is, how big it is by default, and how far a
 * user may resize it.
 *
 * ★★ NO `gate` FIELD, DELIBERATELY. A gate decides what RENDERS, never what is
 * STORED, so it is the surface catalogue's business and not the engine's — see
 * `reconcile` below. A surface's own spec type may carry one; it stays
 * structurally assignable to this, which is how `TileSpec` binds with no cast.
 */
export interface BlockSpec<Id extends string> {
  id: Id;
  /**
   * i18n KEY, never a string — a typo is then a build error, and this file
   * stays importable from a bare node process (the import is type-only).
   *
   * ★ THIS ENGINE NEVER READS IT, and that is not a reason to drop it. It is
   * part of the CATALOGUE contract the generic RENDER layer consumes: the
   * shared block menu and the hidden-block shelf both title a block from its
   * catalogue entry, for whichever surface. Removing it here would only move
   * the field to a second parallel type those layers would then have to join
   * against.
   */
  labelKey: TranslationKey;
  w: BlockWidth;
  h: BlockHeight;
  minW: BlockWidth;
  maxW: BlockWidth;
  minH: BlockHeight;
  maxH: BlockHeight;
}

export interface PlacedBlock<Id extends string> {
  id: Id;
  w: BlockWidth;
  h: BlockHeight;
}

export interface ArrangementLayout<Id extends string> {
  v: 1;
  board: PlacedBlock<Id>[];
  hidden: Id[];
  /**
   * Ids of one-time upgrades already applied to this stored layout (spec C
   * decision 11) — how a surface migrates its stored arrangement WITHOUT a
   * version bump, which would be a lockstep decision across every surface
   * (`arrangement-store.ts` says why). Optional: absent on every layout written
   * before it existed and on every surface with no upgrade (Reports).
   * ★★ `readArrangement` sanitises it and `isArrangementLayout` ignores it, so
   * junk here is dropped and never rejects — i.e. never resets — a layout.
   * `reconcile` carries it through. ★ An OLDER build's `reconcile` rebuilds
   * `{v, board, hidden}` and drops it; a layout an older build rewrites is
   * therefore upgraded once more. Accepted in the spec.
   */
  upgrades?: readonly string[];
}

/**
 * Every block in the catalogue, in catalogue order, at its default size.
 *
 * ★ A FRESH OBJECT PER CALL. Callers must memoize ONE per surface at module
 * level — `reconcile(null)` and `reset()` both hand it back by reference, and
 * the mutators' no-op contract is reference equality.
 */
export function defaultLayout<Id extends string>(
  catalogue: readonly BlockSpec<Id>[],
): ArrangementLayout<Id> {
  return {
    v: 1,
    board: catalogue.map((s) => ({ id: s.id, w: s.w, h: s.h })),
    hidden: [],
  };
}

/**
 * The catalogue entry for `id`, or undefined when the catalogue has dropped it.
 *
 * ★ GENERIC OVER THE SPEC TYPE, not just the id, so it hands back the CALLER'S
 * spec rather than narrowing it to `BlockSpec`. A surface's catalogue routinely
 * carries more than the engine needs — the Dashboard's `TileSpec` adds `gate`,
 * which `tileById`'s callers read — and returning `BlockSpec<Id>` would strip
 * exactly that on the way out, making this un-adoptable by the very catalogues
 * it exists for.
 */
export function specById<Id extends string, S extends BlockSpec<Id>>(
  catalogue: readonly S[],
  id: Id,
): S | undefined {
  return catalogue.find((s) => s.id === id);
}

export function moveBlock<Id extends string>(
  layout: ArrangementLayout<Id>,
  dragId: Id,
  targetId: Id,
): ArrangementLayout<Id> {
  const ids = layout.board.map((b) => b.id);
  const next = reorderIds(ids, dragId, targetId);
  if (next === ids) return layout;
  const byId = new Map(layout.board.map((b) => [b.id, b]));
  return { ...layout, board: next.map((id) => byId.get(id)!) };
}

export function hideBlock<Id extends string>(
  layout: ArrangementLayout<Id>,
  id: Id,
): ArrangementLayout<Id> {
  if (!layout.board.some((b) => b.id === id)) return layout;
  return {
    ...layout,
    board: layout.board.filter((b) => b.id !== id),
    hidden: [...layout.hidden, id],
  };
}

export function restoreBlock<Id extends string>(
  catalogue: readonly BlockSpec<Id>[],
  layout: ArrangementLayout<Id>,
  id: Id,
  index?: number,
): ArrangementLayout<Id> {
  if (!layout.hidden.includes(id)) return layout;
  const spec = specById(catalogue, id);
  if (!spec) return layout;
  const board = [...layout.board];
  const at = index === undefined ? board.length : Math.max(0, Math.min(board.length, index));
  board.splice(at, 0, { id, w: spec.w, h: spec.h });
  return { ...layout, board, hidden: layout.hidden.filter((h) => h !== id) };
}

/** Clamp `v` into `[lo, hi]`, keeping the axis's own span type — a width
 *  clamps to a `BlockWidth`, a height to a `BlockHeight`. */
function clampSpan<S extends number>(v: number, lo: S, hi: S): S {
  return Math.max(lo, Math.min(hi, Math.round(v))) as S;
}

/**
 * Set one axis of one block, clamped to that block's own limits.
 *
 * ★ The axes are INDEPENDENT by design. A single named-preset list conflated
 * them, so "taller, same width" was only expressible where the table happened
 * to hold that combination.
 */
export function resizeBlock<Id extends string>(
  catalogue: readonly BlockSpec<Id>[],
  layout: ArrangementLayout<Id>,
  id: Id,
  axis: "w" | "h",
  value: number,
): ArrangementLayout<Id> {
  const i = layout.board.findIndex((b) => b.id === id);
  if (i < 0) return layout;
  const spec = specById(catalogue, id);
  if (!spec) return layout;
  // ★ Two branches, not a computed `[axis]` key: a computed key of type
  // `"w" | "h"` is not checked per axis, so it would let a height value into
  // `w` with no type error now that the two axes have different types.
  const board = [...layout.board];
  if (axis === "w") {
    const next = clampSpan(value, spec.minW, spec.maxW);
    if (layout.board[i].w === next) return layout;
    board[i] = { ...board[i], w: next };
  } else {
    const next = clampSpan(value, spec.minH, spec.maxH);
    if (layout.board[i].h === next) return layout;
    board[i] = { ...board[i], h: next };
  }
  return { ...layout, board };
}

/**
 * Bring a stored layout up to date with the current catalogue.
 *
 * ★★★ PRECONDITION: `stored` MUST ALREADY HAVE PASSED A SHAPE-AND-VERSION
 * CHECK. The `ArrangementLayout<Id> | null` parameter type is a promise the
 * CALLER makes, and a blob off localStorage cannot keep it. This function does
 * no validation of its own, so a malformed blob is not degraded — it is acted
 * on: `board: null` / `hidden: null` / `board: [null]` / `{}` all THROW out of
 * here, and because the Dashboard calls this from a lazy `useState` initialiser
 * and a render-phase reconcile, that throw surfaces as a panel that fails to
 * RENDER rather than one that degrades. Quieter and worse, a non-numeric `w`
 * clamps to NaN, serialises as `null`, and is rejected on the NEXT load —
 * silently resetting the user's whole arrangement.
 * ★ THE GUARD IS `isArrangementLayout` IN `arrangement-store.ts` — one
 * implementation, generic over the id, narrowing to `ArrangementLayout<string>`.
 * A new surface does NOT port a copy: read through `loadArrangement`, which
 * applies it, or call it directly if the blob comes from somewhere else.
 * Binding `reconcile` to an unvalidated read is the whole defect above.
 *
 * ★★ A GATED-OFF BLOCK IS KEPT, NOT DROPPED, AND THAT IS WHY THIS TAKES NO
 * GATE INPUT. The engine-level rule, which every binding owes: a gate decides
 * what RENDERS, never what is STORED, so EVERY surface filters gated blocks in
 * its own render layer and this function stores them regardless. Drop them here
 * instead and switching a module off and on again loses those blocks' positions
 * permanently.
 * ★ The Dashboard is the worked example, not the rule: `dashboard-panel.tsx`
 * tests each placed tile's own `spec.gate(gate)`, and that filter is INLINE in
 * the panel — there is no shared helper for it. A catalogue-order
 * `liveTiles(gate)` export briefly existed in the pre-extraction engine and was
 * DELETED unused: the panel filters PLACEMENTS in board order and also requires
 * a rendered body, so a catalogue-order list is not the same function and
 * cannot be substituted for it. Do NOT reintroduce one.
 * The plan carried a `_gate` parameter to document that; eslint rejects it
 * (this repo has no `argsIgnorePattern`, and CI runs `--max-warnings=0`), so
 * the absence of the parameter carries the point instead.
 *
 * ★★ A NEW BLOCK LANDS AFTER ITS NEAREST PRESENT CATALOGUE PREDECESSOR, not at
 * the end. Appending would dump every newly shipped block at the bottom of every
 * existing user's board, where its author's intended priority is lost.
 *
 * ★ Sizes are clamped PER AXIS, never reset to the default: a stored height
 * that is still legal survives a width that is not.
 */
export function reconcile<Id extends string>(
  catalogue: readonly BlockSpec<Id>[],
  stored: ArrangementLayout<Id> | null,
  fallback: ArrangementLayout<Id>,
): ArrangementLayout<Id> {
  if (!stored) return fallback;

  const known = new Map(catalogue.map((s) => [s.id, s]));
  // ★★ `hidden` NEEDS ITS OWN DE-DUPLICATION, not just the board's. The board
  // loop below collapses a repeated id because it checks what it has already
  // pushed; nothing did the same for the shelf, so a stored `["kpi","kpi"]`
  // — which `hideBlock` cannot produce but a merged/hand-edited/older blob can —
  // came straight back out and the shelf rendered the same block twice, with
  // duplicate React keys. Found by the "exactly once" property test, not by
  // review. Set preserves insertion order, so the shelf order survives.
  const hiddenSet = new Set(stored.hidden.filter((id) => known.has(id)));
  const hidden = [...hiddenSet];

  // 1. keep what still exists, clamped, minus anything also marked hidden
  const board: PlacedBlock<Id>[] = [];
  for (const p of stored.board) {
    const spec = known.get(p.id);
    if (!spec || hiddenSet.has(p.id)) continue;
    if (board.some((b) => b.id === p.id)) continue;          // storage held a duplicate
    board.push({
      id: p.id,
      w: clampSpan(p.w, spec.minW, spec.maxW),
      h: clampSpan(p.h, spec.minH, spec.maxH),
    });
  }

  // 2. insert anything the catalogue has that storage did not
  const present = new Set(board.map((b) => b.id));
  catalogue.forEach((spec, catIdx) => {
    if (present.has(spec.id) || hiddenSet.has(spec.id)) return;
    // nearest preceding catalogue neighbour that IS on the board
    let at = 0;
    for (let i = catIdx - 1; i >= 0; i--) {
      const j = board.findIndex((b) => b.id === catalogue[i].id);
      if (j >= 0) { at = j + 1; break; }
    }
    board.splice(at, 0, { id: spec.id, w: spec.w, h: spec.h });
    present.add(spec.id);
  });

  // ★ Spec C: carry the applied-upgrades list through, and add NO key when the
  // stored layout had none, so a layout without one stays byte-identical.
  return stored.upgrades ? { v: 1, board, hidden, upgrades: stored.upgrades } : { v: 1, board, hidden };
}
