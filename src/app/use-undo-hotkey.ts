// src/app/use-undo-hotkey.ts
"use client";
import { useEffect, useRef } from "react";

/** Editable targets where the browser's native undo must win. */
function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Global undo/redo keyboard shortcuts, skipped inside a text field so native
 * field-undo is untouched. Mirrors the app's ⌘K search shortcut; both callbacks
 * are read via refs so the listener is attached once.
 *
 * - **Undo:** Ctrl/⌘+Z (no Shift) → `undo()` (stack top).
 * - **Redo:** Ctrl/⌘+Shift+Z OR Ctrl/⌘+Y → `redo()` (only when a `redo` cb is
 *   passed; otherwise the redo chords are inert and the browser default stands).
 */
export function useUndoHotkey(undo: () => void, redo?: () => void): void {
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  useEffect(() => { undoRef.current = undo; redoRef.current = redo; }, [undo, redo]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      // Redo: mod+Shift+Z or mod+Y.
      if ((e.shiftKey && key === "z") || (!e.shiftKey && key === "y")) {
        if (!redoRef.current) return;
        e.preventDefault();
        redoRef.current();
        return;
      }
      // Undo: mod+Z (no Shift).
      if (!e.shiftKey && key === "z") {
        e.preventDefault();
        undoRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
