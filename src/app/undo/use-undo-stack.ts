// src/app/undo/use-undo-stack.ts
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { flushSync } from "react-dom";
import { t, type Lang } from "../i18n";
import type { ActivityKind } from "../activity-log";
import type { ToastAction } from "../use-toast";
import {
  applyUndoRestoreWithRemap,
  applyUndoForward,
  buildBeforeImages,
  buildForwardImages,
  remapImageField,
  pushUndo,
  popUndo,
  dropEntry,
  type BeforeImage,
  type UndoMeta,
} from "./undo-stack";

// Retention: how many destructive ops stay undoable/redoable at once.
const UNDO_CAP = 25;

export interface CaptureOpts<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  kind: ActivityKind;
  /** Rows REMOVED by the op (delete / clear-all). Restored by re-insertion;
   *  re-minted if their id was reused by a live row since (no clobber). */
  removed?: readonly T[];
  /** Rows EDITED in place (bulk-edit, or a delete's dependency-stripped
   *  dependents). Restored by reverting the same id in place. */
  edited?: readonly T[];
  /** The array as it was BEFORE the op — used to resolve each row's index. */
  fromArray: readonly T[];
}

/** A single-field-group edit: revert by MERGING `before`/`after` onto the live
 *  row by id (not a whole-row replace), so independent per-field entries compose
 *  and undo in any LIFO order. `stampField` is re-stamped on undo AND redo. */
export interface CaptureFieldEditOpts<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  kind: ActivityKind;
  id: number;
  before: Partial<T>;
  after: Partial<T>;
  stampField?: keyof T & string;
}

/** One array's contribution to a composite (multi-array) undo — the same shape
 *  as `CaptureOpts` minus the entry-level `kind` (a composite op has one kind). */
export interface CapturePart<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  removed?: readonly T[];
  edited?: readonly T[];
  fromArray: readonly T[];
  /** The field on THIS fragment's rows that references the PRIMARY-deleted entity
   *  (the composite's FIRST fragment). When set, on undo each of this fragment's
   *  before-images has `item[fkRemapField]` remapped through the primary delete's
   *  id-remap BEFORE restore — so a cascade FK follows the primary's re-mint
   *  instead of pointing at the stale original id (now a live unrelated row).
   *  Applies to edit-images (a re-set FK) AND delete-images (a re-inserted row
   *  carrying the FK). Omit on the primary fragment (it has no self-FK). */
  fkRemapField?: keyof T & string;
  /** Marks THIS fragment as the composite's PRIMARY delete — the one whose
   *  id-remap the cascades' `fkRemapField` follow. Exactly one part sets it; if
   *  none does, the first fragment is assumed primary (back-compat). Making it
   *  explicit removes the fragile positional "fragments[0] = primary" convention. */
  isPrimary?: boolean;
}

/**
 * A directional runner: applying it mutates state (undo OR redo) via its
 * captured setter(s) and RETURNS the inverse runner (redo after undo, undo after
 * redo). Alternating between the two thunks gives multi-level undo↔redo, and it
 * is fully reusable so a redone op can be undone again (and vice-versa). The
 * top-level entry stores one runner; a composite entry stores a composed runner.
 */
export type Runner = () => Runner;

/**
 * Build a REUSABLE undo↔redo runner for ONE array. The stable `before`-images
 * drive undo (restore); the redo re-applies FORWARD images captured at undo time
 * from the live post-op array.
 *
 * ★ The forward-images are computed INSIDE the setter updater from `prev` (the
 * current/post-op state) and stashed to a closure var. This is idempotent —
 * React strict-mode double-invokes the updater with the SAME `prev`, yielding
 * the same forward-images — so it does NOT violate the "no side-effects in an
 * updater" rule the way a toast/log would. `prev` is read lazily, so the
 * returned redo thunk sees the populated `forward` only when the user later
 * invokes it (after the updater has committed).
 */
function fragmentUndoRunner<T extends { id: number }>(
  setter: Dispatch<SetStateAction<readonly T[]>>,
  before: readonly BeforeImage<T>[],
): Runner {
  const runUndo: Runner = () => {
    let forward: BeforeImage<T>[] = [];
    setter((prev) => {
      const { result, remap } = applyUndoRestoreWithRemap(prev, before);
      // Build the redo images from the SAME prev + the remap, so a re-minted
      // delete removes the recovered row on redo, not the live reused-id row.
      forward = buildForwardImages(before, prev, remap);
      return result;
    });
    const runRedo: Runner = () => {
      setter((prev) => applyUndoForward(prev, forward));
      return runUndo;
    };
    return runRedo;
  };
  return runUndo;
}

/** A shared, empty primary-remap so the box starts with no re-mint until the
 *  primary fragment's updater publishes one. */
const EMPTY_REMAP: ReadonlyMap<number, number> = new Map();

/**
 * A type-erased composite fragment (one affected array). `restore` reverts THIS
 * array and returns its redo thunk. The shared `primaryRemap` box carries the
 * PRIMARY delete's id-remap: the PRIMARY fragment (`isPrimary`) publishes its own
 * remap into it inside its updater; a fragment with an `fkRemapField` reads it to
 * follow the primary's re-mint. Heterogeneous arrays compose because the generic
 * `T` is captured inside `capturePart`'s closure and erased at this boundary.
 */
export interface CompositeFragment {
  /** Whether this fragment is the PRIMARY delete (its id-remap drives cascades). */
  isPrimary: boolean;
  restore: (primaryRemap: { current: ReadonlyMap<number, number> }, isPrimary: boolean) => () => void;
}

/**
 * Build a REUSABLE undo↔redo runner for a composite (multi-array) op, threading
 * the PRIMARY delete's id-remap to every cascade fragment so a re-minted primary
 * row's FK references follow it (see `remapImageField`). The FIRST fragment is
 * the primary delete (holds at every call site); it publishes its remap into a
 * fresh per-invocation box, then the cascades restore reading it.
 *
 * REDO needs no cross-fragment remap: each fragment's redo re-applies its own op
 * from FORWARD images captured at undo time (the primary redo already removes the
 * re-minted row by its correct id via `buildForwardImages`). Re-undo re-runs
 * `runUndo`, re-orchestrating from the fixed before-images — fully reusable.
 */
function compositeUndoRunner(fragments: readonly CompositeFragment[]): Runner {
  // The PRIMARY (remap source) is the explicitly-flagged fragment; fall back to
  // index 0 for back-compat. Explicit beats the fragile positional convention.
  const primaryIdx = Math.max(0, fragments.findIndex((f) => f.isPrimary));
  const runUndo: Runner = () => {
    // Fresh box each undo so a re-undo (after redo) re-derives the remap from
    // live state rather than a stale one.
    const primaryRemap = { current: EMPTY_REMAP };
    const redos: (() => void)[] = new Array(fragments.length);
    const runPrimary = () => { redos[primaryIdx] = fragments[primaryIdx].restore(primaryRemap, true); };
    // ★★ Flush the PRIMARY synchronously so its published remap is populated
    // BEFORE the cascade updaters run — `undo()` fires from an event handler, so
    // under React-18 auto-batching the separate setters would otherwise flush in
    // fiber (hook-declaration) order, not call order, and a cascade could read the
    // still-empty box. Only when there ARE cascades: a lone fragment needs no
    // cross-fragment sync, so flushSync would just force a needless extra commit.
    if (fragments.length > 1) flushSync(runPrimary); else runPrimary();
    fragments.forEach((f, i) => { if (i !== primaryIdx) redos[i] = f.restore(primaryRemap, false); });
    const runRedo: Runner = () => {
      for (const redo of redos) redo();
      return runUndo;
    };
    return runRedo;
  };
  return runUndo;
}

/**
 * Build one composite fragment for ONE array. Computes the before-images eagerly
 * from the PRE-op snapshots (so it's safe to build after the mutating setter —
 * `fromArray`/`removed`/`edited` are pre-mutation values) and closes over the
 * setter. Returns `null` when the array contributed nothing so `captureComposite`
 * can skip a no-op fragment. Generic per-call so each array's `T` stays precise;
 * the returned fragment is type-erased, letting a composite mix heterogeneous
 * arrays (e.g. roles + resources).
 *
 * ★ The forward-images AND (for the primary) the published remap are stashed out
 * of the setter updater — idempotent under strict-mode double-invoke (same `prev`
 * ⇒ same result), exactly like the single-array `fragmentUndoRunner`.
 */
export function capturePart<T extends { id: number }>(part: CapturePart<T>): CompositeFragment | null {
  const { setter, removed = [], edited = [], fromArray, fkRemapField, isPrimary } = part;
  const images = buildBeforeImages(removed, edited, fromArray);
  if (images.length === 0) return null;
  const restore = (
    primaryRemap: { current: ReadonlyMap<number, number> },
    isPrimary: boolean,
  ): (() => void) => {
    let forward: BeforeImage<T>[] = [];
    setter((prev) => {
      // Follow the primary re-mint for this fragment's FK (no-op when the box is
      // still empty or the field is unset). The primary itself has no self-FK.
      const restoreImages = fkRemapField
        ? remapImageField(images, fkRemapField, primaryRemap.current)
        : images;
      const { result, remap } = applyUndoRestoreWithRemap(prev, restoreImages);
      if (isPrimary) primaryRemap.current = remap; // publish for cascades (idempotent)
      // Redo images from the SAME prev + this fragment's own remap, so a re-minted
      // delete removes the recovered row on redo, not a live reused-id row.
      forward = buildForwardImages(restoreImages, prev, remap);
      return result;
    });
    return () => { setter((prev) => applyUndoForward(prev, forward)); };
  };
  return { isPrimary: isPrimary === true, restore };
}

/** A multi-array undo: one entry whose restore reverts a primary removal AND
 *  every cascade edit across N arrays (e.g. deleting a role also cleared
 *  resources' roleId → both are reverted by a single undo, and re-applied by a
 *  single redo).
 *  ★ Fragments DO coordinate re-mint across arrays: if a removed primary row's id
 *  was reused by a new row before undo, the primary fragment re-mints the
 *  recovered row under a fresh id and publishes that remap; each cascade fragment
 *  declaring an `fkRemapField` follows it so its FK points at the recovered row,
 *  never the unrelated live reused-id row. */
export interface CaptureCompositeOpts {
  kind: ActivityKind;
  /** User-facing count for the toast/badge — the PRIMARY rows the user acted
   *  on, never the incidental cascade dependents. */
  primaryCount: number;
  /** One fragment per affected array (build via `capturePart`); nulls (arrays
   *  that contributed nothing) are ignored. The FIRST non-null fragment is the
   *  PRIMARY delete — its id-remap drives every cascade's `fkRemapField`. */
  parts: readonly (CompositeFragment | null)[];
}

export interface UndoStackApi {
  capture: <T extends { id: number }>(opts: CaptureOpts<T>) => void;
  captureFieldEdit: <T extends { id: number }>(opts: CaptureFieldEditOpts<T>) => void;
  captureComposite: (opts: CaptureCompositeOpts) => void;
  undo: () => void;
  undoById: (id: number) => void;
  redo: () => void;
  stack: readonly UndoMeta[];
  redoStack: readonly UndoMeta[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface UseUndoStackDeps {
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  showToastAction: (kind: "info" | "error", text: string, action: ToastAction) => void;
}

/** One entry on either stack: display meta + the impure directional runner. */
interface StackEntry {
  meta: UndoMeta;
  run: Runner;
}

export function useUndoStack(deps: UseUndoStackDeps): UndoStackApi {
  const [stack, setStack] = useState<readonly StackEntry[]>([]);
  const stackRef = useRef(stack);
  useEffect(() => { stackRef.current = stack; }, [stack]);
  const [redoStack, setRedoStack] = useState<readonly StackEntry[]>([]);
  const redoStackRef = useRef(redoStack);
  useEffect(() => { redoStackRef.current = redoStack; }, [redoStack]);
  const depsRef = useRef(deps);
  useEffect(() => { depsRef.current = deps; }, [deps]);
  const idRef = useRef(0);

  // Run an entry's undo + side effects OUTSIDE any setState updater (strict mode
  // double-invokes updaters → double restore). `entry.run()` applies the undo
  // and returns the redo runner. `pushRedo` is false for an out-of-order undo of
  // a non-top entry, whose redo can't stay coherent → clear the redo stack.
  const commitUndo = useCallback((entry: StackEntry, nextStack: readonly StackEntry[], pushRedo: boolean) => {
    const redoRun = entry.run();
    const { lang, logActivity, showToast } = depsRef.current;
    logActivity("undo", entry.meta.count);
    showToast("info", t(lang, "undoRestored", entry.meta.count));
    setStack(nextStack);
    if (pushRedo) {
      setRedoStack((rs) => pushUndo(rs, { meta: entry.meta, run: redoRun }, UNDO_CAP));
    } else {
      setRedoStack([]);
    }
  }, []);

  const undoById = useCallback((id: number) => {
    const s = stackRef.current;
    const entry = s.find((e) => e.meta.id === id);
    if (!entry) return;
    const isTop = s.length > 0 && s[s.length - 1].meta.id === id;
    commitUndo(entry, dropEntry(s, id), isTop);
  }, [commitUndo]);

  const undo = useCallback(() => {
    const popped = popUndo(stackRef.current);
    if (!popped) return;
    commitUndo(popped.entry, popped.rest, true);
  }, [commitUndo]);

  // Redo the last undone op: apply its forward runner (which returns a fresh undo
  // runner so redo→undo round-trips), and push the re-undoable entry back on top.
  const redo = useCallback(() => {
    const popped = popUndo(redoStackRef.current);
    if (!popped) return;
    const undoRun = popped.entry.run();
    const { lang, logActivity, showToast } = depsRef.current;
    logActivity("redo", popped.entry.meta.count);
    showToast("info", t(lang, "redoRestored", popped.entry.meta.count));
    setRedoStack(popped.rest);
    setStack((s) => pushUndo(s, { meta: popped.entry.meta, run: undoRun }, UNDO_CAP));
  }, []);

  // Shared tail: push one undo entry, invalidate any pending redo (a fresh
  // destructive op breaks redo coherence), and fire its action toast. `run` is
  // the entry's directional runner (single- or multi-array).
  const pushEntry = useCallback((kind: ActivityKind, primaryCount: number, run: Runner) => {
    const id = (idRef.current += 1);
    const meta: UndoMeta = { id, kind, count: primaryCount, timestamp: new Date().toISOString() };
    setStack((s) => pushUndo(s, { meta, run }, UNDO_CAP));
    setRedoStack([]);
    const { lang, showToastAction } = depsRef.current;
    const isDelete = kind.endsWith(".deleted");
    const text = t(lang, isDelete ? "undoToastDelete" : "undoToastEdit", primaryCount);
    showToastAction("info", text, { labelKey: "undo", run: () => undoById(id) });
  }, [undoById]);

  const capture = useCallback(<T extends { id: number }>(opts: CaptureOpts<T>) => {
    const { setter, kind, removed = [], edited = [], fromArray } = opts;
    const images = buildBeforeImages(removed, edited, fromArray);
    if (images.length === 0) return;
    // Toast/count reflect the PRIMARY op (the rows the user acted on), not the
    // incidental dependents an edit-cascade also captured.
    const primaryCount = removed.length > 0 ? removed.length : edited.length;
    pushEntry(kind, primaryCount, fragmentUndoRunner(setter, images));
  }, [pushEntry]);

  const captureFieldEdit = useCallback(<T extends { id: number }>(opts: CaptureFieldEditOpts<T>) => {
    const { setter, kind, id, before, after, stampField } = opts;
    const stamp = (row: T): T =>
      stampField ? ({ ...row, [stampField]: new Date().toISOString() } as T) : row;
    const merge = (patch: Partial<T>) =>
      setter((prev) => prev.map((r) => (r.id === id ? stamp({ ...r, ...patch }) : r)));
    // Mutually-recursive, reusable undo↔redo runners (function decls hoist).
    function runUndo(): Runner { merge(before); return runRedo; }
    function runRedo(): Runner { merge(after); return runUndo; }
    pushEntry(kind, 1, runUndo);
  }, [pushEntry]);

  const captureComposite = useCallback((opts: CaptureCompositeOpts) => {
    const fragments = opts.parts.filter((f): f is CompositeFragment => f !== null);
    if (fragments.length === 0) return;
    pushEntry(opts.kind, opts.primaryCount, compositeUndoRunner(fragments));
  }, [pushEntry]);

  const metas = useMemo(() => stack.map((e) => e.meta), [stack]);
  const redoMetas = useMemo(() => redoStack.map((e) => e.meta), [redoStack]);

  return {
    capture,
    captureFieldEdit,
    captureComposite,
    undo,
    undoById,
    redo,
    stack: metas,
    redoStack: redoMetas,
    canUndo: stack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
