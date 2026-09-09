"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowsPointingInIcon, QuestionMarkCircleIcon, XMarkIcon } from "./icons";
import { HELP_ENTRIES, type HelpEntryId } from "./help-content";
import { HelpBodyText } from "./help-body-text";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { usePopoverDismiss } from "./use-popover-dismiss";
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
  /** Suppress the help icon in this header even though `helpConceptId` is set.
   *
   *  ★ PASS IT WHERE ONE COMPONENT HARDCODES A HELP ID BUT A CONSUMER REPLACES
   *  THE BODY. `BackendConfigModal` is the case: it owns
   *  `MODAL_HELP.backendConfig` (Storage) for its own default body, but its
   *  `children` prop lets a consumer render something else entirely — the
   *  empty-state AI instance renders `AiSection` under it, so the icon would
   *  open the Storage entry over a dialog about the Anthropic API key. A wrong
   *  entry is worse than no icon.
   *  SUPPRESSED rather than repointed: no Help entry describes the AI settings
   *  today. Suppressed HERE rather than by making the id conditional at the
   *  call site, because `help-content.test.ts` scans for the bare
   *  attribute-equals-MODAL_HELP-dot-key spelling and a ternary would read as
   *  an unwired key. (Spelled out rather than quoted: the literal form is what
   *  that scan — and the grep people run beside it — matches, so writing it
   *  here would make this comment count as a 20th call site.) Defaults to
   *  false, so every existing call site renders byte-identically. */
  hideHelp?: boolean;
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
  closeLabel,
  hideVoiceCommand = false,
  helpConceptId,
  hideHelp = false,
  helpTitle,
  headerExtra,
  onResetLayout,
  logo,
}: ModalHeaderProps) {
  const voice = useVoiceCommand();
  const closeName = closeLabel ?? t(lang, "alertModalClose");
  const [helpOpen, setHelpOpen] = useState(false);
  const helpWrapRef = useRef<HTMLDivElement | null>(null);
  // ★ SHARED PRIMITIVE, never a hand-rolled Escape/outside-click pair.
  // ★★ STACK ORDER SCOPES ESCAPE, NOT `kind` — an earlier revision of this
  // comment said otherwise. `escapeOwner()` in dismissal-stack.ts is
  // kind-AGNOSTIC: it walks the stack from the TOP and returns the first entry
  // that claims. The popover is pushed above the Modal, so it takes Escape and
  // the modal stays open. `kind` means "traps Tab" and nothing else; "layer"
  // is right here because the popover traps nothing, but flipping it to
  // "modal" would NOT change the Escape behaviour this line depends on — so a
  // test asserting the modal survives cannot pin the kind, and none claims to.
  usePopoverDismiss(helpOpen, helpWrapRef, () => setHelpOpen(false));
  const helpEntry =
    helpConceptId && !hideHelp ? HELP_ENTRIES.find((e) => e.id === helpConceptId) : undefined;
  const helpName = t(lang, "modalHelpAbout", helpTitle ?? title);
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
        {helpEntry && (
          <div ref={helpWrapRef} className="relative">
            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              aria-expanded={helpOpen}
              aria-label={helpName}
              title={helpName}
              className={`rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:hover:text-ui-light-grey ${INTERACTIVE}`}
            >
              <QuestionMarkCircleIcon aria-hidden="true" className="h-4 w-4" />
            </button>
            {helpOpen && (
              <div
                role="dialog"
                aria-label={t(lang, helpEntry.titleKey)}
                className="absolute right-0 top-full z-20 mt-1 w-80 max-w-[90vw] rounded-md border border-line bg-surface p-3 text-left"
              >
                <p className="mb-1 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
                  {t(lang, helpEntry.titleKey)}
                </p>
                <p className="max-w-[64ch] whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  <HelpBodyText body={t(lang, helpEntry.bodyKey)} labelClass="font-medium text-foreground" />
                </p>
              </div>
            )}
          </div>
        )}
        {voice && !hideVoiceCommand && (
          <VoiceCommandButton lang={lang} onCommand={voice.onCommand} onError={voice.onError} />
        )}
        {onResetLayout && (
          <button
            type="button"
            onClick={onResetLayout}
            aria-label={t(lang, "modalResetSize")}
            title={t(lang, "modalResetSize")}
            className={`rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:hover:text-ui-light-grey ${INTERACTIVE}`}
          >
            <ArrowsPointingInIcon aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
        {!hideClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeName}
            title={closeName}
            className="rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:hover:text-ui-light-grey"
          >
            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  );
}
