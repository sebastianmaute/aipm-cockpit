"use client";

import { type Lang, t } from "./i18n";
import { type Command } from "./voice";
import { VoiceCommandButton } from "./voice-button";

interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
}

interface ModalHeaderProps {
  lang: Lang;
  title: string;
  titleId?: string;
  onClose: () => void;
  /** Pointer handlers from useDraggable; the header acts as the drag handle. */
  dragHandleProps?: DragHandleProps;
  /** When provided, a voice-command mic is shown and routes to this handler. */
  onVoiceCommand?: (cmd: Command, originalText: string) => void;
  onVoiceError?: (msg: string) => void;
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
  onVoiceCommand,
  onVoiceError,
}: ModalHeaderProps) {
  return (
    <header
      {...dragHandleProps}
      className={`sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-AIPM-light-grey bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950 ${
        dragHandleProps ? "cursor-move touch-none select-none" : ""
      }`}
    >
      <h2 id={titleId} className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {title}
      </h2>
      <div className="flex items-center gap-1" onPointerDown={stopDrag}>
        {onVoiceCommand && (
          <VoiceCommandButton
            lang={lang}
            onCommand={onVoiceCommand}
            onError={onVoiceError ?? (() => {})}
          />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t(lang, "alertModalClose")}
          title={t(lang, "alertModalClose")}
          className="rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
            <path
              fillRule="evenodd"
              d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
