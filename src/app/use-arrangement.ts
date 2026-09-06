"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  hideBlock, moveBlock, reconcile, resizeBlock, restoreBlock,
  type ArrangementLayout, type BlockSpec,
} from "./arrangement-layout";
import { loadArrangement, saveArrangement } from "./arrangement-store";

/** Debounce before writing to localStorage, so a drag that reflows repeatedly
 *  does not write on every frame.
 *
 *  ★ ONE SHARED NUMBER FOR EVERY SURFACE, deliberately not a parameter — the
 *  same shape as `arrangement-store.ts`'s shared `MAX_PROJECTS`, and for the
 *  same reason: no surface has wanted its own, and making it injectable before
 *  one does is speculative generality. It is a one-line change if that day
 *  comes. Read this as "every binding debounces at 400ms", never as "each
 *  surface sets its own". */
export const LAYOUT_PERSIST_MS = 400;

export interface ArrangementApi<Id extends string> {
  layout: ArrangementLayout<Id>;
  move: (dragId: Id, targetId: Id) => void;
  hide: (id: Id) => void;
  restore: (id: Id, index?: number) => void;
  resize: (id: Id, axis: "w" | "h", value: number) => void;
  reset: () => void;
  /** Arrangement is read-only here (popout). Render no grips, menus or shelf. */
  readOnly: boolean;
}

/**
 * Everything a surface injects.
 *
 * ★ A NAMED interface rather than an inline type literal on the hook, for two
 * reasons. A binding can name the shape it is constructing; and Next's
 * `client-boundary` tsserver rule walks `ts.isTypeLiteralNode` looking for
 * function-typed properties in a `"use client"` module, so an inline literal
 * makes `seed` raise a spurious "Props must be serializable" diagnostic in the
 * editor. ★★ That diagnostic could never have failed CI — it is emitted as a
 * Warning, and it lives in a language-service plugin `tsc` does not load, which
 * is why `npx tsc --noEmit` exits 0 either way — so this is tidiness, not a fix.
 * ★★★ Do NOT silence it instead by renaming `seed` to something ending in
 * `Action`: that spelling asserts it IS a Server Action, which is false, and the
 * next reader would build on it.
 */
export interface ArrangementOptions<Id extends string> {
  /**
   * The surface's block catalogue.
   *
   * ★★ MUST BE A STABLE REFERENCE. It rides every returned mutator's dependency
   * array, so a fresh array per render re-mints all five. That is a performance
   * concern only — see `fallback` for the one that is a correctness contract.
   */
  catalogue: readonly BlockSpec<Id>[];
  /**
   * This surface's own localStorage key.
   *
   * ★ It must start `aipm-cockpit:` so `clearAppConfig`'s prefix sweep clears
   * it; `arrangement-store.ts` owns that rule. ★★ It must also be UNIQUE per
   * surface — two surfaces sharing a key would break the render-body read's
   * idempotence argument below, and nothing would say so.
   */
  storageKey: string;
  /**
   * The surface's ONE default instance — returned by reference for a null blob.
   *
   * ★★★ MUST BE A STABLE REFERENCE, and unlike `catalogue` this is a CONTRACT
   * rather than a performance note. `reconcile(…, null, fallback)` and `reset()`
   * both hand it straight back, and the engine's four mutators signal "no
   * change" by returning their input by reference. Build it per render and
   * `reset()` stops being detectable as a reset — pinned by "reset returns the
   * surface's OWN fallback BY REFERENCE", which was the FIRST test to cover that
   * contract at all (the Dashboard suite is green with `reset` spreading a copy).
   */
  fallback: ArrangementLayout<Id>;
  projectId: string;
  /**
   * Suppress every write, and tell the surface to render no grips, menus or
   * shelf.
   *
   * ★ NAMED FOR WHAT IT MEANS, not for the one feature that sets it. The
   * Dashboard's popout is what motivated it and `useDashboardLayout` keeps
   * `isPopout` as its public spelling, but nothing in this file knows what a
   * popout is, and the returned `readOnly` was already named this way.
   */
  readOnly?: boolean;
  /**
   * ★ Optional seed, consulted when storage holds nothing USABLE for this
   * project. A surface supplies it to carry a pre-existing preference forward —
   * Reports builds one from `settings.reports.extra`, putting every addable
   * report absent from that list into `hidden`; the Dashboard passes nothing. It
   * is reconciled like any stored blob, so a stale or malformed seed cannot
   * corrupt the board.
   *
   * ★★★ "NOTHING USABLE" IS MORE THAN A MISSING KEY, and an earlier revision of
   * this line said "ONLY when storage holds nothing for this project", which is
   * measurably false. `loadArrangement` returns `null` for a missing key and for
   * a blob `isArrangementLayout` REJECTS alike — it cannot distinguish them —
   * and `readLayout`'s `stored ?? seed?.() ?? null` therefore reaches the seed in
   * both. Pinned by "runs the seed when the stored blob is REJECTED".
   * ★★ THE CONSEQUENCE IS A DOWNGRADE ROUND TRIP, compounding the one
   * `arrangement-store.ts` already documents: a user on a future `v: 2` build who
   * downgrades has their blob rejected, so a legacy-preference seed runs AGAIN
   * and silently reverts them to the migrated legacy layout — and the next
   * mutation writes `v: 1` over the `v: 2` blob. A seed that must not do that has
   * to carry its own marker rather than lean on this `??`.
   *
   * ★★★ IT RUNS DURING RENDER, SO IT MUST BE PURE. Both `readLayout` call sites
   * are the lazy `useState` initialiser and the render-body project-switch
   * reconcile, so a "one-time migration" that DELETES or REWRITES the legacy key
   * inside `seed` is a render-phase side effect — the exact class the hook's own
   * ★★★ block is careful about for the READ, which is accepted there only
   * because it is idempotent, and a delete is not. StrictMode also
   * double-invokes a lazy initialiser, so in dev it can run twice on one mount.
   * Do that cleanup from an effect, or not at all.
   *
   * ★★ "ONE-TIME" IS A PROPERTY OF STORAGE, NOT OF THIS HOOK, and the
   * difference is visible: `readLayout` consults the seed on BOTH reads, so a
   * project the user switches INTO with nothing stored is seeded too. What makes
   * it run once PER PROJECT is that the first mutation writes the key, after
   * which `loadArrangement` wins the `??`. Measured call counts: 1 on mount, 1
   * still after a same-project re-render, 2 after a project switch — once per
   * READ, never per render, pinned by "consults the seed once per READ". A seed
   * that must run at most once globally has to carry that condition itself.
   */
  seed?: () => ArrangementLayout<Id> | null;
}

/**
 * Owns a surface's arrangement: load → reconcile → mutate → debounced persist.
 * Generic over the block id; the catalogue, the storage key and the default
 * layout are all parameters, so the Dashboard and Reports share this one hook.
 *
 * ★★ THE CATALOGUE AND THE FALLBACK MUST BE STABLE REFERENCES — a module-level
 * constant per surface, never an array or object literal built in the caller's
 * render body. Two separate reasons, and only the first is a mere performance
 * concern: every returned mutator lists `catalogue` in its dependency array, so
 * a fresh array re-mints all five each render; and `fallback` is handed back BY
 * REFERENCE by `reconcile(…, null, fallback)` and by `reset()`, which is a
 * CONTRACT the rest of this subsystem reads (`arrangement-layout.ts` says so at
 * `defaultLayout` and at `reconcile`). `dashboard-layout.ts` holds exactly one
 * `DEFAULT_LAYOUT` for that reason; a new binding owes the same.
 * ★★★ NOTHING TYPECHECKS THAT, WHICH IS WHY THERE IS A DEV-ONLY DETECTOR BELOW.
 * An adapter building `fallback` inline per render breaks `reset()` and EVERY
 * TEST STAYS GREEN — the Dashboard binding uses module constants, so no existing
 * suite can see a second binding's mistake, and the engine's own no-op tests
 * pass their own object in. The `console.warn` follows the existing precedent in
 * `use-resource-directory.ts` (same `process.env.NODE_ENV !== "production"`
 * guard, same purpose: a developer error a type cannot express). It fires from
 * an EFFECT, not the render body — `react-hooks/refs` makes writing a ref during
 * render fatal, and that ref is what makes the warning fire once per change
 * rather than once per render.
 *
 * ★★ THE INITIAL READ IS A LAZY `useState`, not an effect. A `useEffect` that
 * called `setState` would violate the repo's banned `react-hooks/
 * set-state-in-effect` rule.
 *
 * ★★★ THERE IS A SECOND STORAGE READ AND IT IS IN THE **RENDER BODY** — this
 * paragraph used to end "a lazy initialiser is the one shape that satisfies both
 * that rule and the purity rule", which the project-switch reconcile below
 * falsifies: it calls `readLayout(projectId)` → `loadArrangement` →
 * `localStorage` straight from render. That is ACCEPTED here, deliberately, and
 * the argument is not "no gate complains" — `eslint-plugin-react-hooks` (7.1.1
 * here; check with
 * `node -e "console.log(require('eslint-plugin-react-hooks/package.json').version)"`)
 * bans `Date.now()`, `Math.random()` and `new Date()` in a render body and has
 * no idea what `localStorage` is, so no gate will EVER flag this. The argument is
 * that the read is IDEMPOTENT and CONDITIONAL: it runs only on the render where
 * `projectId` actually changed, and the only writer of that key is
 * `saveArrangement`, which runs from an effect — so React discarding and
 * re-running this render yields the same layout, which is exactly what the
 * purity rule protects.
 * ★★ THE IDEMPOTENCE ARGUMENT NOW SPANS EVERY BINDING, not one surface. It
 * holds because `arrangement-store.ts` reads and writes ONE `{[projectId]:
 * layout}` map per KEY and each surface passes its own key, so two surfaces
 * mounted at once cannot write each other's map. A future binding that shared a
 * key with another surface would break this without a gate saying so.
 * ★★ The alternative is not a lazy initialiser (that shape cannot see a CHANGED
 * prop at all) but an effect, which is the banned rule and would additionally
 * render one frame of the OLD project's arrangement before correcting itself.
 * ★ Do not generalise this into licence for storage reads in render elsewhere:
 * an UNCONDITIONAL one would re-read on every render, and one whose key another
 * render-phase writer touches would not be idempotent.
 *
 * ★★★ THE PROJECT ID AND THE LAYOUT ARE **ONE** STATE OBJECT, and that is the
 * whole fix for a real cross-write. The rule is general — it applies to any
 * surface this hook binds — but it was MEASURED on the Dashboard, and that
 * remains the worked example: `DashboardPanel` is NOT remounted on a project
 * switch (`task-manager.tsx` passes no `key` to `WorkspaceSection`,
 * `workspace-section.tsx` mounts the panel while `activeTab === "dashboard"`,
 * and `switchToProject` never resets `activeTab`), so a seeded-once `layout`
 * beside a live `projectId` prop meant the persist effect re-ran with the NEW id
 * and the OLD layout and, 400ms later, replaced the new project's stored
 * arrangement with the previous project's. Holding the pair atomically makes
 * that state unrepresentable: every write names the id the layout was loaded
 * for. ★ A binding whose surface IS remounted per project would not have hit
 * that bug, and still inherits the fix at no cost. The sync itself is the repo's
 * sanctioned RENDER-TIME RECONCILE (compare the prop against the last-handled
 * value in the render body, `setState` there), because
 * `react-hooks/set-state-in-effect` is banned and fatal.
 *
 * ★★ THERE IS NO `gate` OPTION, and that is deliberate rather than an omission.
 * `reconcile` takes no gate because a gate decides what RENDERS, never what is
 * STORED — a gated-off block keeps its stored position so switching a module off
 * and on again does not lose it. The render layer filters (`dashboard-panel.tsx`
 * owns one `isRenderable` predicate shared by its board and its shelf); this
 * hook does not, so a `gate` option would be unused here, and an unused option
 * is fatal at `--max-warnings=0`.
 *
 * ★ `readOnly` suppresses every write. ★★ THE PARAMETER IS NAMED FOR THE
 * BEHAVIOUR, NOT THE FEATURE: the Dashboard's popout is what sets it and
 * `useDashboardLayout` keeps `isPopout` as its own public spelling, so a reader
 * coming from `use-landing-delta` will see the older name there. That hook
 * shares the guard and NOTHING ELSE: its persist effect has `[]` deps, so on a
 * project switch it goes STALE (never re-runs, writes the mount-time project
 * once) rather than cross-writing. Do not read one as a model for the other.
 */
export function useArrangement<Id extends string>({
  catalogue,
  storageKey,
  fallback,
  projectId,
  readOnly = false,
  seed,
}: ArrangementOptions<Id>): ArrangementApi<Id> {
  /**
   * The stored arrangement for `pid`, reconciled. SSR-safe.
   *
   * ★ DECLARED INSIDE THE HOOK, unlike the module-scope `readLayout` this was
   * extracted from: it closes over `catalogue`, `storageKey`, `fallback` and
   * `seed`, none of which exist at module scope any more.
   * ★★ The cast is the same one `dashboard-layout-store.ts` states in the
   * open: the store validates SHAPE, never MEMBERSHIP — `isArrangementLayout`
   * can prove `id` is a string, never that it is one of this surface's ids — and
   * `reconcile` is what makes the narrowing true, because it drops every id the
   * catalogue does not know. So the cast must stay on THIS side of `reconcile`,
   * never be pushed into the store.
   * ★★★ `loadArrangement` MUST STAY THE READ PATH. It is what applies
   * `isArrangementLayout`, and `reconcile` validates nothing (its own ★★★
   * precondition block says so): a hand-edited blob reaches it as `board: null`
   * or `board: [null]` and THROWS. Both call sites here are a lazy `useState`
   * initialiser and a render-phase reconcile, so that throw is a surface that
   * fails to RENDER, not one that degrades.
   */
  const readLayout = (pid: string): ArrangementLayout<Id> => {
    if (typeof window === "undefined") return fallback;
    const stored = loadArrangement(storageKey, pid) as ArrangementLayout<Id> | null;
    return reconcile(catalogue, stored ?? seed?.() ?? null, fallback);
  };

  // ★★ `dirty` IS STATE, NOT A REF, and it lives INSIDE this object rather than
  // beside it. It gates the FIRST persist run: without it, merely mounting would
  // write the reconciled default back over storage for a project the user never
  // touched. It must also RESET on a switch, or the new project looks dirty the
  // moment it loads — and `dirty.current = false` in the render body is a FATAL
  // `react-hooks/refs` error ("Cannot update ref during render"), caught by the
  // gate, not by review. Carried in the same object the reset is structural: a
  // new project gets a new object whose `dirty` is false, and there is no way to
  // swap one of the three without the other two.
  const [state, setState] = useState<{
    projectId: string; layout: ArrangementLayout<Id>; dirty: boolean;
  }>(() => ({ projectId, layout: readLayout(projectId), dirty: false }));

  // Render-time reconcile — NOT an effect (`set-state-in-effect` is banned).
  if (state.projectId !== projectId) {
    setState({ projectId, layout: readLayout(projectId), dirty: false });
  }

  // Hoisted to locals: `react-hooks/exhaustive-deps` rejects an `obj.member` dep.
  const activeProjectId = state.projectId;
  const activeLayout = state.layout;
  const activeDirty = state.dirty;

  // The dev-only stability detector for the ★★★ block above. `catalogue` and
  // `fallback` are contractually module-level constants; nothing in the type
  // system can say so, and a binding that gets it wrong is silent everywhere.
  // ★ It lives in an EFFECT because `react-hooks/refs` makes a render-body ref
  // write fatal, and the ref is what keeps this to one warning per change.
  const firstSeen = useRef<{ catalogue: unknown; fallback: unknown } | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const prev = firstSeen.current;
    firstSeen.current = { catalogue, fallback };
    if (!prev) return;
    if (prev.catalogue !== catalogue) {
      console.warn("[useArrangement] `catalogue` changed identity — hold ONE module-level constant per surface; every mutator re-mints each render otherwise.");
    }
    if (prev.fallback !== fallback) {
      console.warn("[useArrangement] `fallback` changed identity — hold ONE module-level constant per surface, or `reset()` stops returning it by reference.");
    }
  }, [catalogue, fallback]);

  // ★★ THE PENDING WRITE IS HELD WITH ITS OWN `projectId`, so a flush can never
  // land on the wrong project no matter when it fires.
  const pending = useRef<{ projectId: string; layout: ArrangementLayout<Id> } | null>(null);
  const flush = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    saveArrangement(storageKey, p.projectId, p.layout);
  }, [storageKey]);

  // Persist on change, debounced. A side effect only — no setState here.
  useEffect(() => {
    if (readOnly || !activeDirty) return;
    pending.current = { projectId: activeProjectId, layout: activeLayout };
    const id = window.setTimeout(flush, LAYOUT_PERSIST_MS);
    return () => window.clearTimeout(id);
  }, [activeProjectId, activeLayout, activeDirty, readOnly, flush]);

  // ★★ FLUSH ON UNMOUNT **AND** ON A PROJECT SWITCH. A surface binding this hook
  // may be conditionally mounted (`DashboardPanel` is), so navigating away
  // inside the debounce window used to discard the write silently. It must be
  // its OWN effect: putting the flush in the debounce effect's cleanup would
  // fire on every `activeLayout` change and so write once per drag frame — the
  // exact thing the debounce exists to avoid. Declaration order matters:
  // cleanups run top-down, so the timer above is cleared before this runs, and
  // `flush` nulls `pending` so a timer that already fired cannot double-write.
  useEffect(() => flush, [activeProjectId, flush]);

  const mutate = useCallback((fn: (l: ArrangementLayout<Id>) => ArrangementLayout<Id>) => {
    setState((prev) => {
      const next = fn(prev.layout);
      if (next === prev.layout) return prev;
      return { projectId: prev.projectId, layout: next, dirty: true };
    });
  }, []);

  return {
    layout: activeLayout,
    readOnly,
    move: useCallback(
      (dragId: Id, targetId: Id) => mutate((l) => moveBlock(l, dragId, targetId)),
      [mutate],
    ),
    hide: useCallback((id: Id) => mutate((l) => hideBlock(l, id)), [mutate]),
    restore: useCallback(
      (id: Id, index?: number) => mutate((l) => restoreBlock(catalogue, l, id, index)),
      [mutate, catalogue],
    ),
    resize: useCallback(
      (id: Id, axis: "w" | "h", value: number) => mutate((l) => resizeBlock(catalogue, l, id, axis, value)),
      [mutate, catalogue],
    ),
    reset: useCallback(() => mutate(() => fallback), [mutate, fallback]),
  };
}
