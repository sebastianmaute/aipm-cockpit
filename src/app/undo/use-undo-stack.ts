// src/app/undo/use-undo-stack.ts
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { t, type Lang } from "../i18n";
import type { ActivityKind } from "../activity-log";
import type { ToastAction } from "../use-toast";
import {
  applyUndoRestore,
  buildBeforeImages,
  pushUndo,
  popUndo,
  dropEntry,
  type UndoEntry,
  type UndoMeta,
} from "./undo-stack";

const UNDO_CAP = 10;

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

/** A pre-computed, type-erased restore for ONE array of a composite undo. */
export type RestoreFragment = () => void;

/**
 * Build a restore fragment for ONE array of a composite undo. Computes the
 * before-images eagerly from the PRE-op snapshots (so it's safe to call after
 * the mutating setter — `fromArray`/`removed`/`edited` are pre-mutation values)
 * and closes over the setter. Returns `null` when the array contributed nothing
 * (no removed/edited rows) so `captureComposite` can skip a no-op re-render.
 * Generic per-call, so each array's `T` stays precise; the returned thunk is
 * type-erased, letting a composite mix heterogeneous arrays (roles + resources).
 */
export function capturePart<T extends { id: number }>(part: CapturePart<T>): RestoreFragment | null {
  const { setter, removed = [], edited = [], fromArray } = part;
  const images = buildBeforeImages(removed, edited, fromArray);
  if (images.length === 0) return null;
  return () => setter((prev) => applyUndoRestore(prev, images));
}

/** A multi-array undo: one entry whose restore reverts a primary removal AND
 *  every cascade edit across N arrays (e.g. deleting a role also cleared
 *  resources' roleId → both are reverted by a single undo). */
export interface CaptureCompositeOpts {
  kind: ActivityKind;
  /** User-facing count for the toast/badge — the PRIMARY rows the user acted
   *  on, never the incidental cascade dependents. */
  primaryCount: number;
  /** One fragment per affected array (build via `capturePart`); nulls (arrays
   *  that contributed nothing) are ignored. */
  parts: readonly (RestoreFragment | null)[];
}

export interface UndoStackApi {
  capture: <T extends { id: number }>(opts: CaptureOpts<T>) => void;
  captureComposite: (opts: CaptureCompositeOpts) => void;
  undo: () => void;
  undoById: (id: number) => void;
  stack: readonly UndoMeta[];
  canUndo: boolean;
}

export interface UseUndoStackDeps {
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  showToastAction: (kind: "info" | "error", text: string, action: ToastAction) => void;
}

export function useUndoStack(deps: UseUndoStackDeps): UndoStackApi {
  const [stack, setStack] = useState<readonly UndoEntry[]>([]);
  const stackRef = useRef(stack);
  useEffect(() => { stackRef.current = stack; }, [stack]);
  const depsRef = useRef(deps);
  useEffect(() => { depsRef.current = deps; }, [deps]);
  const idRef = useRef(0);

  // Run an entry's restore + side effects OUTSIDE any setState updater (strict
  // mode double-invokes updaters → double restore). Caller passes the new stack.
  const commitRestore = useCallback((entry: UndoEntry, nextStack: readonly UndoEntry[]) => {
    entry.restore();
    const { lang, logActivity, showToast } = depsRef.current;
    logActivity("undo", entry.meta.count);
    showToast("info", t(lang, "undoRestored", entry.meta.count));
    setStack(nextStack);
  }, []);

  const undoById = useCallback((id: number) => {
    const s = stackRef.current;
    const entry = s.find((e) => e.meta.id === id);
    if (!entry) return;
    commitRestore(entry, dropEntry(s, id));
  }, [commitRestore]);

  const undo = useCallback(() => {
    const popped = popUndo(stackRef.current);
    if (!popped) return;
    commitRestore(popped.entry, popped.rest);
  }, [commitRestore]);

  // Shared tail: push one entry + fire its action toast. `restore` is the entry's
  // impure thunk (single- or multi-array). Keeps capture/captureComposite DRY.
  const pushEntry = useCallback((kind: ActivityKind, primaryCount: number, restore: () => void) => {
    const id = (idRef.current += 1);
    const meta: UndoMeta = { id, kind, count: primaryCount, timestamp: new Date().toISOString() };
    setStack((s) => pushUndo(s, { meta, restore }, UNDO_CAP));
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
    pushEntry(kind, primaryCount, () => setter((prev) => applyUndoRestore(prev, images)));
  }, [pushEntry]);

  const captureComposite = useCallback((opts: CaptureCompositeOpts) => {
    const fragments = opts.parts.filter((f): f is RestoreFragment => f !== null);
    if (fragments.length === 0) return;
    pushEntry(opts.kind, opts.primaryCount, () => { for (const f of fragments) f(); });
  }, [pushEntry]);

  const metas = useMemo(() => stack.map((e) => e.meta), [stack]);

  return { capture, captureComposite, undo, undoById, stack: metas, canUndo: stack.length > 0 };
}
