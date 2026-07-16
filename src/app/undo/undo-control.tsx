"use client";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { t, type Lang, type TranslationKey } from "../i18n";
import { INTERACTIVE } from "../interaction-styles";
import { PopoverPanel } from "../popover-panel";

const BUTTON_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm text-muted-foreground hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey";

/**
 * A top-bar undo/redo control: the action button plus an Excel-style caret that
 * previews (visualization only) the label of the NEXT entry to be reverted. The
 * caret opens a `PopoverPanel` (portaled, escapes top-bar clipping); the action
 * button still performs exactly ONE undo/redo. Self-hides on an empty stack.
 * Wired into BOTH header mounts; in the top bar → axe-scanned every view, so both
 * the action button and the caret carry explicit aria-labels. Not in popouts.
 */
function UndoRedoControl({
  depth,
  onActivate,
  actionLabel,
  labelKey,
  showNextKey,
  nextHeadingKey,
  nextLabel,
  lang,
  icon,
}: {
  depth: number;
  onActivate: () => void;
  actionLabel: string;
  labelKey: TranslationKey;
  showNextKey: TranslationKey;
  nextHeadingKey: TranslationKey;
  nextLabel?: string;
  lang: Lang;
  icon: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const caretRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  if (depth <= 0) return null;
  const hasPreview = !!nextLabel;
  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        onClick={onActivate}
        aria-label={actionLabel}
        title={actionLabel}
        className={`${BUTTON_CLASS} ${hasPreview ? "rounded-r-none border-r-0" : ""} ${INTERACTIVE}`}
      >
        {icon}
        <span>{t(lang, labelKey)}</span>
        <span className="rounded-full bg-AIPM-medium-grey px-1.5 text-xs text-white">{depth}</span>
      </button>
      {hasPreview && (
        <>
          <button
            ref={caretRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={t(lang, showNextKey)}
            title={t(lang, showNextKey)}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={`${BUTTON_CLASS} rounded-l-none px-1 ${INTERACTIVE}`}
          >
            {/* Chevron (decorative — aria-label carries the name) */}
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <PopoverPanel
            open={open}
            anchorRef={caretRef}
            onClose={close}
            role="dialog"
            ariaLabel={t(lang, showNextKey)}
            className="w-64 p-2"
          >
            <p className="text-xs font-medium text-muted-foreground">{t(lang, nextHeadingKey)}</p>
            <p className="mt-1 text-sm text-AIPM-dark-blue dark:text-AIPM-light-grey">{nextLabel}</p>
          </PopoverPanel>
        </>
      )}
    </span>
  );
}

interface UndoControlProps {
  lang: Lang;
  /** Undo-stack depth; 0 → control renders nothing. */
  depth: number;
  onUndo: () => void;
  /** Label of the NEXT entry to undo (stack top) — powers the caret preview. */
  nextLabel?: string;
}

/** Top-bar undo button + next-entry caret preview. See {@link UndoRedoControl}. */
export function UndoControl({ lang, depth, onUndo, nextLabel }: UndoControlProps) {
  return (
    <UndoRedoControl
      depth={depth}
      onActivate={onUndo}
      actionLabel={t(lang, "undoTooltip")}
      labelKey="undo"
      showNextKey="undoShowNext"
      nextHeadingKey="undoNextLabel"
      nextLabel={nextLabel}
      lang={lang}
      icon={
        // Undo arrow (decorative — aria-label carries the name)
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
        </svg>
      }
    />
  );
}

interface RedoControlProps {
  lang: Lang;
  /** Redo-stack depth; 0 → control renders nothing. */
  depth: number;
  onRedo: () => void;
  /** Label of the NEXT entry to redo (redo-stack top) — powers the caret preview. */
  nextLabel?: string;
}

/** Top-bar redo button + next-entry caret preview — mirror of {@link UndoControl}. */
export function RedoControl({ lang, depth, onRedo, nextLabel }: RedoControlProps) {
  return (
    <UndoRedoControl
      depth={depth}
      onActivate={onRedo}
      actionLabel={t(lang, "redoTooltip")}
      labelKey="redo"
      showNextKey="redoShowNext"
      nextHeadingKey="redoNextLabel"
      nextLabel={nextLabel}
      lang={lang}
      icon={
        // Redo arrow — horizontal mirror of the undo arrow (decorative; aria-label carries the name)
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 14l5-5-5-5" />
          <path d="M20 9H9a5 5 0 0 0 0 10h1" />
        </svg>
      }
    />
  );
}
