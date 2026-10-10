"use client";

import { type ReactNode } from "react";
import { ArrowsPointingInIcon, XMarkIcon } from "./icons";
import { type HelpEntryId } from "./help-content";
import { HelpIconButton } from "./help-icon-button";
import { type Lang, t } from "./i18n";
import { IconButton } from "./icon-button";
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
  /** Render the ✕ DISABLED (native `disabled`, so it is announced as unavailable and takes no
   *  click) while the host refuses to close, e.g. during a run the dialog must stay open for.
   *  Defaults to false, and only a disabled ✕ gains the disabled classes, so every other call site
   *  renders byte-identically. */
  closeDisabled?: boolean;
  /** Accessible name AND `title` for the ✕. Defaults to the shared
   *  `alertModalClose` string, so every call site that omits it is unchanged.
   *  ★ PASS IT WHENEVER THIS HEADER CAN BE OPEN ON TOP OF ANOTHER MODAL. Every
   *  ModalHeader otherwise names its ✕ identically; screen readers scope
   *  announcements by `aria-modal`, but SPEECH INPUT DOES NOT — "click Close"
   *  with two Closes rendered picks one arbitrarily, and the wrong one can
   *  discard the work in the layer beneath. Qualify with the repo's en-dash
   *  convention: `${t(lang, "alertModalClose")} – ${dialogTitle}`. NOT defaulted
   *  to include the title, which would rename every ✕ in the app at once. */
  closeLabel?: string;
  /** Suppress the voice-command mic in this header.
   *
   *  ★ PASS IT ON A STACKED DIALOG'S HEADER, for the same reason `closeLabel`
   *  exists one prop up. This component renders the mic whenever a
   *  `VoiceCommandProvider` is in scope, and `VoiceCommandButton` names itself
   *  with the fixed, unqualified `voiceCommand` string — so two stacked headers
   *  put TWO controls named "Voice command" in one document. Speech input does
   *  not scope by `aria-modal` ("click Voice command" then picks one
   *  arbitrarily), and axe has no rule that flags two controls sharing an
   *  accessible name, so a unit test is the only detector that can exist.
   *  SUPPRESSED rather than qualified: a nested dialog does not need a second
   *  global voice trigger, and the one on the layer beneath stays reachable —
   *  this removes the control AND the collision. Defaults to false, so every
   *  existing call site renders byte-identically. */
  hideVoiceCommand?: boolean;
  /** When set, render a help icon opening this Help entry in a popover over
   *  the dialog. Absent ⇒ no icon, which is how confirmations and gates stay
   *  clean without an exclusion list.
   *
   *  ★ The popover opens IN PLACE rather than deep-linking the Help view,
   *  because `requestHelpConcept` sets activeTab = "help" and would switch the
   *  view BEHIND the still-open dialog (docs/open-followups.md §424). */
  helpConceptId?: HelpEntryId;
  /** Qualifies the help icon's accessible name. Pass the modal's own title.
   *  ★ SAME REASON AS `closeLabel` TWO PROPS UP: two stacked headers otherwise
   *  put two controls named "Help" in one document, speech input does not
   *  scope by aria-modal, and axe has no rule that flags it. */
  helpTitle?: string;
  /** Extra controls rendered in the header's right cluster, before the close
   *  button (e.g. a reset-size button for a resizable modal panel). */
  headerExtra?: ReactNode;
  /** When set, render a "reset dialog layout" button (recenters + restores the
   *  default size) in the header's right cluster before the close button. */
  onResetLayout?: () => void;
  /** Optional branding rendered top-left, before the title (e.g. the app
   *  banner on the first-run empty-state). */
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
  closeDisabled = false,
  closeLabel,
  hideVoiceCommand = false,
  helpConceptId,
  helpTitle,
  headerExtra,
  onResetLayout,
  logo,
}: ModalHeaderProps) {
  const voice = useVoiceCommand();
  const closeName = closeLabel ?? t(lang, "alertModalClose");
  return (
    <header
      {...dragHandleProps}
      className={`sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6 py-4 ${
        dragHandleProps ? "cursor-move touch-none select-none" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {logo}
        <h2 id={titleId} className="truncate text-lg font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {title}
        </h2>
      </div>
      <div className="flex items-center gap-1" onPointerDown={stopDrag}>
        {headerExtra}
        {helpConceptId && (
          <HelpIconButton lang={lang} conceptId={helpConceptId} dialogTitle={helpTitle ?? title} />
        )}
        {voice && !hideVoiceCommand && (
          <VoiceCommandButton lang={lang} onCommand={voice.onCommand} onError={voice.onError} />
        )}
        {onResetLayout && (
          // §688: the help trigger beside it is IconButton md, so these two are too —
          // one size (28px) and one hover style across the header row.
          <IconButton
            size="md"
            onClick={onResetLayout}
            label={t(lang, "modalResetSize")}
            title={t(lang, "modalResetSize")}
          >
            <ArrowsPointingInIcon aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        )}
        {!hideClose && (
          <IconButton
            size="md"
            onClick={onClose}
            disabled={closeDisabled}
            label={closeName}
            title={closeName}
          >
            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        )}
      </div>
    </header>
  );
}
