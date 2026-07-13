"use client";

import { type ReactNode } from "react";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { useVoiceCommand } from "./voice-command-context";
import { VoiceCommandButton } from "./voice-button";

interface DragHandleProps {
  /** Captures the header element so useDraggable can reach the panel for a
   *  post-layout viewport re-clamp. */
  ref?: (el: HTMLElement | null) => void;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
}

interface ModalHeaderProps {
  lang: Lang;
  title: string;
  /** If set, the parent dialog should use aria-labelledby={titleId} to label itself. */
  titleId?: string;
  onClose: () => void;
  /** Pointer handlers from useDraggable; the header acts as the drag handle. */
  dragHandleProps?: DragHandleProps;
  /** Hide the ✕ close button (e.g. a non-dismissable empty-state header where
   *  the close gesture is a no-op and the button would be a dead control). */
  hideClose?: boolean;
  /** Extra controls rendered in the header's right cluster, before the close
   *  button (e.g. a reset-size button for a resizable modal panel). */
  headerExtra?: ReactNode;
  /** When set, render a "reset dialog layout" button (recenters + restores the
   *  default size) in the header's right cluster before the close button. */
  onResetLayout?: () => void;
  /** Optional branding rendered top-left, before the title (e.g. the Acme
   *  logo on the first-run empty-state). */
  logo?: ReactNode;
}

/** Stop a pointerdown on interactive controls from initiating a window drag. */
function stopDrag(e: React.PointerEvent) {
  e.stopPropagation();
}

export function ModalHeader({
  lang,
  title,
  titleId,
  onClose,
  dragHandleProps,
  hideClose = false,
  headerExtra,
  onResetLayout,
  logo,
}: ModalHeaderProps) {
  const voice = useVoiceCommand();
  return (
    <header
      {...dragHandleProps}
      className={`sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6 py-4 ${
        dragHandleProps ? "cursor-move touch-none select-none" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {logo}
        <h2 id={titleId} className="truncate text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {title}
        </h2>
      </div>
      <div className="flex items-center gap-1" onPointerDown={stopDrag}>
        {headerExtra}
        {voice && (
          <VoiceCommandButton lang={lang} onCommand={voice.onCommand} onError={voice.onError} />
        )}
        {onResetLayout && (
          <button
            type="button"
            onClick={onResetLayout}
            aria-label={t(lang, "modalResetSize")}
            title={t(lang, "modalResetSize")}
            className={`rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path d="M10 3a7 7 0 105.66 2.87V3.5a.75.75 0 00-1.5 0v1.06A7 7 0 0010 3zm0 1.5a5.5 5.5 0 11-4.2 1.95l1.02 1.02a.75.75 0 001.06-1.06L6.1 5.53A5.47 5.47 0 0110 4.5z" />
            </svg>
          </button>
        )}
        {!hideClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, "alertModalClose")}
            title={t(lang, "alertModalClose")}
            className="rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
