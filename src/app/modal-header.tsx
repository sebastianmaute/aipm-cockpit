"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { ArrowsPointingInIcon, QuestionMarkCircleIcon, XMarkIcon } from "./icons";
import { HELP_ENTRIES, type HelpEntryId } from "./help-content";
import { HelpBodyText } from "./help-body-text";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { PopoverPanel } from "./popover-panel";
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
  helpTitle,
  headerExtra,
  onResetLayout,
  logo,
}: ModalHeaderProps) {
  const voice = useVoiceCommand();
  const closeName = closeLabel ?? t(lang, "alertModalClose");
  const [helpOpen, setHelpOpen] = useState(false);
  const helpTriggerRef = useRef<HTMLButtonElement | null>(null);
  const helpPanelId = useId();
  // `PopoverPanel` reads this through effect dependencies, so it MUST be
  // stable — its docstring says so explicitly.
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const helpEntry = helpConceptId ? HELP_ENTRIES.find((e) => e.id === helpConceptId) : undefined;
  const helpName = t(lang, "modalHelpAbout", helpTitle ?? title);
  const helpCloseName = helpEntry
    ? `${t(lang, "alertModalClose")} – ${t(lang, helpEntry.titleKey)}`
    : "";
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
          <>
            <button
              type="button"
              ref={helpTriggerRef}
              onClick={() => setHelpOpen((v) => !v)}
              aria-expanded={helpOpen}
              aria-haspopup="dialog"
              /* ★ Set only while OPEN. `aria-controls` must resolve to a node
                 that EXISTS and the panel is unmounted while closed — the same
                 shape as `entity-combobox-search.tsx`. */
              aria-controls={helpOpen ? helpPanelId : undefined}
              aria-label={helpName}
              title={helpName}
              className={`rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:hover:text-ui-light-grey ${INTERACTIVE}`}
            >
              <QuestionMarkCircleIcon aria-hidden="true" className="h-4 w-4" />
            </button>
            {/* ★ SHARED PRIMITIVE, never a hand-rolled absolute panel. EVERY
                declaring modal's panel is `overflow-hidden`
                (`edit-modal-chrome.tsx` serves seven of them,
                `documents-rename-modal.tsx` and `task-linked-task-modal.tsx`
                one each), and z-index CANNOT escape overflow — so the
                `absolute right-0 top-full` panel this replaced was clipped at
                the panel edge. `PopoverPanel` portals to `document.body` and
                positions `fixed` from the trigger's rect, which is why there
                is no `relative` wrapper left here to anchor anything.

                ★★ WHAT THE PRIMITIVE'S `kind: "modal"` BUYS AND COSTS, given
                this header always renders inside a `Modal`:

                ESCAPE IS UNCHANGED. `escapeOwner()` (`dismissal-stack.ts`) is
                kind-AGNOSTIC — it walks the stack from the TOP and returns the
                first entry that claims — so the popover, pushed above the
                Modal, takes Escape and the modal stays open. That held under
                the old `usePopoverDismiss` (`kind: "layer"`, hardcoded inside
                the hook — there was never a choice at this call site) and holds
                now, so the test asserting the modal survives cannot pin the
                kind and does not claim to.

                ★★★ TAB IS THE HALF THAT CHANGES, AND THE CLOSE BUTTON BELOW IS
                WHAT MAKES IT SAFE. `kind` MEANS "traps Tab": `modal.tsx`'s Tab
                branch defers to the topmost `"modal"` entry, which is now this
                popover — and `PopoverPanel`'s own cycle returns WITHOUT
                trapping when the panel holds no focusables. A text-only panel
                would therefore stand BOTH traps down and let Tab walk out of
                the dialog (WCAG 2.4.3). MEASURED, not reasoned, by two probes
                each driving twelve `userEvent.tab()` presses inside a `Modal`
                that also rendered one button OUTSIDE it. A bare `Modal` +
                text-only `PopoverPanel` harness (four controls in the modal)
                reached `document.body` on the 4th press and the OUTSIDE button
                on the 5th, then cycled through both forever. This header with
                the close button below never left the panel across all twelve.
                So the button is LOAD-BEARING for containment, not decoration.
                Pinned by "keeps Tab inside the dialog while the help popover
                is open" in `modal-header.test.tsx`.

                ★ `autoFocus` is left at the primitive's DEFAULT (true), so
                opening lands focus on that close button. This panel is
                `role="dialog"`; leaving focus outside an open dialog is the
                shape where AT announces nothing, and the docstring's reason
                for passing `false` — a destructive first control — does not
                apply to a Close.

                ★ `max-h-[60vh] overflow-y-auto` is on the PANEL rather than an
                inner wrapper so the scroll region CONTAINS the close button:
                that keeps it keyboard-scrollable (focus sits inside the
                scroller, so arrow keys act on it) without adding a bare
                `tabIndex={0}` stop. Some bodies run past 1000 characters and
                the old panel had no height cap at all. The primitive's
                close-on-scroll listener ignores scrolls it contains, so this
                cannot dismiss itself. */}
            <PopoverPanel
              open={helpOpen}
              anchorRef={helpTriggerRef}
              onClose={closeHelp}
              id={helpPanelId}
              role="dialog"
              ariaLabel={t(lang, helpEntry.titleKey)}
              className="max-h-[60vh] w-80 max-w-[90vw] overflow-y-auto p-3 text-left"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
                  {t(lang, helpEntry.titleKey)}
                </p>
                {/* ★ QUALIFIED BY THE ENTRY TITLE, never a bare "Close". The
                    header's own ✕ is in the same document and defaults to the
                    unqualified `alertModalClose` string; two controls sharing
                    an accessible name is a WCAG 2.4.6 / speech-input defect
                    that axe has no rule for, so the unit test beside this file
                    is the only detector. Same en-dash convention `closeLabel`
                    documents above. */}
                <button
                  type="button"
                  onClick={closeHelp}
                  aria-label={helpCloseName}
                  title={helpCloseName}
                  className={`-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:hover:text-ui-light-grey ${INTERACTIVE}`}
                >
                  <XMarkIcon aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <p className="max-w-[64ch] whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                <HelpBodyText body={t(lang, helpEntry.bodyKey)} labelClass="font-medium text-foreground" />
              </p>
            </PopoverPanel>
          </>
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
