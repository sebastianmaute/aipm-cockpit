"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  hideBlock, moveBlock, reconcile, resizeBlock, restoreBlock,
  type ArrangementLayout, type BlockSpec,
} from "./arrangement-layout";
import { loadArrangement, saveArrangement } from "./arrangement-store";

/** Debounce before writing to localStorage, so a drag that reflows repeatedly
 *  does not write on every frame. */
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
 * ★ Popout is read-only — it never persists. `use-landing-delta` shares that
 * `isPopout` guard and NOTHING ELSE: its persist effect has `[]` deps, so on a
 * project switch it goes STALE (never re-runs, writes the mount-time project
 * once) rather than cross-writing. Do not read one as a model for the other.
 */
export function useArrangement<Id extends string>({
  catalogue,
  storageKey,
  fallback,
  projectId,
  isPopout = false,
  seed,
}: {
  catalogue: readonly BlockSpec<Id>[];
  storageKey: string;
  /** The surface's ONE default instance — returned by reference for a null blob. */
  fallback: ArrangementLayout<Id>;
  projectId: string;
  isPopout?: boolean;
  /**
   * ★ Optional one-time seed, used ONLY when storage holds nothing for this
   * project. A surface supplies it to carry a pre-existing preference forward;
   * the Dashboard passes nothing. It is reconciled like any stored blob, so a
   * stale or malformed seed cannot corrupt the board.
   *
   * ★★ "ONE-TIME" IS A PROPERTY OF STORAGE, NOT OF THIS HOOK, and the
   * difference is visible: `readLayout` consults the seed on BOTH reads, so a
   * project the user switches INTO with nothing stored is seeded too. What makes
   * it run once PER PROJECT is that the first mutation writes the key, after
   * which `loadArrangement` wins the `??`. A seed that must run at most once
   * globally has to carry that condition itself.
   */
  seed?: () => ArrangementLayout<Id> | null;
}): ArrangementApi<Id> {
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
    if (isPopout || !activeDirty) return;
    pending.current = { projectId: activeProjectId, layout: activeLayout };
    const id = window.setTimeout(flush, LAYOUT_PERSIST_MS);
    return () => window.clearTimeout(id);
  }, [activeProjectId, activeLayout, activeDirty, isPopout, flush]);

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
    readOnly: isPopout,
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
