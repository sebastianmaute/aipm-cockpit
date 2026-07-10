// src/app/undo/use-undo-stack.ts
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { t, type Lang } from "../i18n";
import type { ActivityKind } from "../activity-log";
import type { ToastAction } from "../use-toast";
import {
  applyUndoRestore,
  pushUndo,
  popUndo,
  dropEntry,
  type BeforeImage,
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

export interface UndoStackApi {
  capture: <T extends { id: number }>(opts: CaptureOpts<T>) => void;
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

  const capture = useCallback(<T extends { id: number }>(opts: CaptureOpts<T>) => {
    const { setter, kind, removed = [], edited = [], fromArray } = opts;
    const at = (item: T) => Math.max(0, fromArray.findIndex((r) => r.id === item.id));
    const images: BeforeImage<T>[] = [
      ...removed.map((item) => ({ index: at(item), item, op: "delete" as const })),
      ...edited.map((item) => ({ index: at(item), item, op: "edit" as const })),
    ];
    if (images.length === 0) return;
    // Toast/count reflect the PRIMARY op (the rows the user acted on), not the
    // incidental dependents an edit-cascade also captured.
    const primaryCount = removed.length > 0 ? removed.length : edited.length;
    const id = (idRef.current += 1);
    const meta: UndoMeta = { id, kind, count: primaryCount, timestamp: new Date().toISOString() };
    const restore = () => setter((prev) => applyUndoRestore(prev, images));
    setStack((s) => pushUndo(s, { meta, restore }, UNDO_CAP));
    const { lang, showToastAction } = depsRef.current;
    const isDelete = kind.endsWith(".deleted");
    const text = t(lang, isDelete ? "undoToastDelete" : "undoToastEdit", primaryCount);
    showToastAction("info", text, { labelKey: "undo", run: () => undoById(id) });
  }, [undoById]);

  const metas = useMemo(() => stack.map((e) => e.meta), [stack]);

  return { capture, undo, undoById, stack: metas, canUndo: stack.length > 0 };
}
