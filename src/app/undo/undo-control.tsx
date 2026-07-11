// src/app/undo/undo-control.tsx
"use client";
import { t, type Lang } from "../i18n";
import { INTERACTIVE } from "../interaction-styles";

interface UndoControlProps {
  lang: Lang;
  /** Undo-stack depth; 0 → control renders nothing. */
  depth: number;
  onUndo: () => void;
}

/**
 * Top-bar undo button. Self-hides on an empty stack. Wired into BOTH header
 * mounts (buildShellChrome + AppHeader). In the top bar → axe-scanned every
 * view, so it carries an explicit aria-label. Not rendered in popouts (the
 * caller gates on !isPopout).
 */
export function UndoControl({ lang, depth, onUndo }: UndoControlProps) {
  if (depth <= 0) return null;
  return (
    <button
      type="button"
      onClick={onUndo}
      aria-label={t(lang, "undoTooltip")}
      title={t(lang, "undoTooltip")}
      className={`inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm text-muted-foreground hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
    >
      {/* Undo arrow (decorative — aria-label carries the name) */}
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 14L4 9l5-5" />
        <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
      </svg>
      <span>{t(lang, "undo")}</span>
      <span className="rounded-full bg-AIPM-medium-grey px-1.5 text-xs text-white">{depth}</span>
    </button>
  );
}

interface RedoControlProps {
  lang: Lang;
  /** Redo-stack depth; 0 → control renders nothing. */
  depth: number;
  onRedo: () => void;
}

/**
 * Top-bar redo button — mirror of {@link UndoControl}. Self-hides on an empty
 * redo stack. Wired into BOTH header mounts beside Undo; carries an explicit
 * aria-label (axe-scanned every view). Not rendered in popouts.
 */
export function RedoControl({ lang, depth, onRedo }: RedoControlProps) {
  if (depth <= 0) return null;
  return (
    <button
      type="button"
      onClick={onRedo}
      aria-label={t(lang, "redoTooltip")}
      title={t(lang, "redoTooltip")}
      className={`inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm text-muted-foreground hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
    >
      {/* Redo arrow — horizontal mirror of the undo arrow (decorative; aria-label carries the name) */}
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M15 14l5-5-5-5" />
        <path d="M20 9H9a5 5 0 0 0 0 10h1" />
      </svg>
      <span>{t(lang, "redo")}</span>
      <span className="rounded-full bg-AIPM-medium-grey px-1.5 text-xs text-white">{depth}</span>
    </button>
  );
}
