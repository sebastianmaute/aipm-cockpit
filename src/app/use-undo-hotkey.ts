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
 * Global Ctrl/⌘+Z → `undo()` (stack top). Ignores Shift (redo is out of scope)
 * and any keystroke inside a text field so native field-undo is untouched.
 * Mirrors the app's ⌘K search shortcut. `undo` is read via a ref so the
 * listener is attached once.
 */
export function useUndoHotkey(undo: () => void): void {
  const undoRef = useRef(undo);
  useEffect(() => { undoRef.current = undo; }, [undo]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      if (e.key !== "z" && e.key !== "Z") return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      undoRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
