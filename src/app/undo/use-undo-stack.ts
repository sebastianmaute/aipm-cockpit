// src/app/undo/use-undo-stack.ts
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { t, type Lang } from "../i18n";
import type { ActivityKind } from "../activity-log";
import type { ToastAction } from "../use-toast";
import {
  applyUndoRestoreWithRemap,
  applyUndoForward,
  buildBeforeImages,
  buildForwardImages,
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

/** One array's contribution to a composite (multi-array) undo — the same shape
 *  as `CaptureOpts` minus the entry-level `kind` (a composite op has one kind). */
export interface CapturePart<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  removed?: readonly T[];
  edited?: readonly T[];
  fromArray: readonly T[];
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

/** Compose N fragment runners into ONE runner: applying it runs every fragment
 *  (undo or redo) and returns a composed runner of their inverses. Pure structural. */
function composeRunners(runners: readonly Runner[]): Runner {
  const run: Runner = () => {
    const inverses = runners.map((r) => r());
    return composeRunners(inverses);
  };
  return run;
}

/**
 * Build an undo↔redo runner fragment for ONE array of a composite undo. Computes
 * the before-images eagerly from the PRE-op snapshots (so it's safe to build
 * after the mutating setter — `fromArray`/`removed`/`edited` are pre-mutation
 * values) and closes over the setter. Returns `null` when the array contributed
 * nothing so `captureComposite` can skip a no-op fragment. Generic per-call, so
 * each array's `T` stays precise; the returned runner is type-erased, letting a
 * composite mix heterogeneous arrays (roles + resources).
 */
export function capturePart<T extends { id: number }>(part: CapturePart<T>): Runner | null {
  const { setter, removed = [], edited = [], fromArray } = part;
  const images = buildBeforeImages(removed, edited, fromArray);
  if (images.length === 0) return null;
  return fragmentUndoRunner(setter, images);
}

/** A multi-array undo: one entry whose restore reverts a primary removal AND
 *  every cascade edit across N arrays (e.g. deleting a role also cleared
 *  resources' roleId → both are reverted by a single undo, and re-applied by a
 *  single redo).
 *  ★ Fragments do NOT coordinate re-mint across arrays: in the rare window where
 *  a removed row's id was reused by a new row before undo, the removal fragment
 *  re-mints the recovered row under a fresh id while an edit fragment reverts the
 *  FK to the original (now-reused) id — same single-array semantics, accepted. */
export interface CaptureCompositeOpts {
  kind: ActivityKind;
  /** User-facing count for the toast/badge — the PRIMARY rows the user acted
   *  on, never the incidental cascade dependents. */
  primaryCount: number;
  /** One fragment per affected array (build via `capturePart`); nulls (arrays
   *  that contributed nothing) are ignored. */
  parts: readonly (Runner | null)[];
}

export interface UndoStackApi {
  capture: <T extends { id: number }>(opts: CaptureOpts<T>) => void;
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

  const captureComposite = useCallback((opts: CaptureCompositeOpts) => {
    const fragments = opts.parts.filter((f): f is Runner => f !== null);
    if (fragments.length === 0) return;
    pushEntry(opts.kind, opts.primaryCount, composeRunners(fragments));
  }, [pushEntry]);

  const metas = useMemo(() => stack.map((e) => e.meta), [stack]);
  const redoMetas = useMemo(() => redoStack.map((e) => e.meta), [redoStack]);

  return {
    capture,
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
