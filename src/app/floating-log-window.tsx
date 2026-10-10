"use client";

// Draggable, resizable, NON-MODAL floating window chrome — the title bar, the
// body portal, position/size persistence and the Escape protocol — shared by
// every entity log window (the note log, the blocker log). Controlled by
// external `open`/`onClose` — it never self-triggers, has no backdrop, and does
// not trap focus, so the app stays interactive underneath. Drag/resize
// mechanics clone `help-menu.tsx`; the body is whatever the caller passes as
// `children`.

import { useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { XMarkIcon } from "./icons";
import { FLOATING_LAYER_ATTR } from "./modal";
import { IconButton } from "./icon-button";
import { t, type Lang } from "./i18n";
import { useResizable } from "./use-resizable";
import { useDraggableWindow, type ComputeInitialPos } from "./use-draggable-window";
import { ResetSizeButton } from "./task-manager-ui";
import { useClaimsWhenFocusWithin, useDismissable } from "./use-dismissable";
import { usePanelInitialFocus } from "./use-panel-focus";
import { HelpIconButton } from "./help-icon-button";
import type { HelpEntryId } from "./help-content";

/** The note log's default corner gap; other log windows pass their own so two
 *  windows opened side by side do not stack exactly. */
export const DEFAULT_LOG_WINDOW_POS = { x: 96, y: 96 } as const;

/** Above the entity editors (`EditModalShell`, z 50), below confirm dialogs (60). */
export const NOTES_WINDOW_Z = 55;

export interface FloatingLogWindowProps {
  open: boolean;
  onClose: () => void;
  /** ★★ ONE SPELLING, THREE SINKS: the window's accessible name, its visible
   *  heading and the help trigger's `dialogTitle` all come from this string. */
  title: string;
  /** Saved geometry lives at `${storageKeyPrefix}-pos` and `-size`. */
  storageKeyPrefix: string;
  /** A `MODAL_HELP` value (a `HelpEntryId`), as the help button takes today. */
  helpConceptId: HelpEntryId;
  lang: Lang;
  /** Where the window first appears when no position is saved; defaults to
   *  `DEFAULT_LOG_WINDOW_POS` (the note log's corner). */
  defaultX?: number;
  defaultY?: number;
  children: ReactNode;
}

export function FloatingLogWindow({
  open,
  onClose,
  title,
  storageKeyPrefix,
  helpConceptId,
  lang,
  defaultX = DEFAULT_LOG_WINDOW_POS.x,
  defaultY = DEFAULT_LOG_WINDOW_POS.y,
  children,
}: FloatingLogWindowProps) {
  // Place the window on first open: saved position, else the default corner gap.
  const computeInitialPos = useCallback<ComputeInitialPos>(
    ({ saved, clamp }) => clamp(saved ?? { x: defaultX, y: defaultY }),
    [defaultX, defaultY],
  );
  const { ref: panelRef, reset: resetSize } = useResizable(`${storageKeyPrefix}-size`, { open });
  // Drag/position (shared with help-menu); size stays on useResizable above.
  const { pos, onTitleBarMouseDown } = useDraggableWindow(`${storageKeyPrefix}-pos`, {
    open,
    panelRef,
    computeInitialPos,
    fallbackWidth: 480,
    fallbackHeight: 560,
  });

  // Escape closes — but ONLY while focus is inside this window, or nowhere.
  //
  // ★★ This window is NON-MODAL and mounts at the top level: it stays open
  // while the user works anywhere else, including inside a modal it is not
  // part of. An unconditional claim swallowed every Escape in the app — open
  // notes from a row badge, open the task editor, press Escape to dismiss the
  // editor, and the notes window closed while the editor stayed.
  //
  // ★★ The gate lives in `claims` rather than in a handler, and that is
  // load-bearing: a declining entry that stayed topmost would block every
  // layer beneath it, because each of those asks "am I topmost?" and gets
  // `false`. Escape would become a no-op. The stack walks past a decliner
  // instead, so the editor underneath gets the key.
  // ★★ Move focus INTO the window on open. Without this the trigger that
  // opened it — the "Notes (N)" button INSIDE the task/RAID editor `Modal` —
  // keeps focus, `claimsFocusWithin` reads false, this window declines, and the
  // editor beneath takes the Escape and closes with the user's draft. Opening
  // this window must not arm a keypress that destroys work.
  usePanelInitialFocus(panelRef, open);

  const claimsFocusWithin = useClaimsWhenFocusWithin(panelRef);
  useDismissable({
    open,
    kind: "layer",
    onDismiss: onClose,
    claims: claimsFocusWithin,
  });

  if (!open) return null;

  // ★★ PORTALED TO <body> ABOVE THE EDITORS. The window opens from the "Notes"
  // button inside the task/RAID/change editor, and is meant to be used beside
  // it. Rendered in place at z-40 it sat UNDER the editor's z-50 backdrop: the
  // scrim dimmed it, and a click on it landed on the backdrop and closed the
  // editor. The portal keeps it out of any ancestor stacking context, and
  // NOTES_WINDOW_Z puts it above the editors (50) but below confirm dialogs (60),
  // so a delete confirmation still covers it. FLOATING_LAYER_ATTR stops the
  // editor's Tab trap from pulling keyboard focus back out of it.
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      {...{ [FLOATING_LAYER_ATTR]: "" }}
      // Focus target for `usePanelInitialFocus` — carries no focus ring, and is
      // deliberately not in the tab order.
      tabIndex={-1}
      aria-label={title}
      style={{ left: pos?.x ?? defaultX, top: pos?.y ?? defaultY, maxWidth: "100vw", maxHeight: "calc(100vh - 32px)", zIndex: NOTES_WINDOW_Z }}
      className="fixed flex h-[560px] min-h-72 w-[480px] min-w-[320px] resize flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-card)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green"
    >
      <div
        onMouseDown={onTitleBarMouseDown}
        className="flex shrink-0 cursor-move select-none items-center justify-between border-b border-line px-4 py-2"
      >
        <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
        <div className="flex items-center gap-1">
          {/* ★★★ THE FIRST `HelpIconButton` OUTSIDE A `Modal`, AND THAT WAS
              MEASURED BEFORE IT WAS WIRED — the component's docstring used to
              make "inside a `Modal`" a flat REQUIREMENT, and this mount is why
              it no longer does. Read that docstring for the general rule; what
              follows is this window's own numbers.

              This window is NOT a `Modal`: `kind: "layer"`, `role="dialog"`
              with NO `aria-modal`, and its own header comment says it does not
              trap focus. So there was never a Tab trap here for the popover's
              `kind: "modal"` push to stand down — the mechanism the containment
              reasoning in `help-icon-button.tsx` is about is simply absent.

              ★★ TWO PROBES, twelve `userEvent.tab()` presses each, one button
              rendered OUTSIDE the window as the falsifier.

              BASELINE (no help icon anywhere): 1 the window itself, 2 Reset
              size, 3 Close, 4 Add note, 5 Edit – #1, 6 Delete – #1, then
              7 `<body>` and 8 the OUTSIDE button, cycling from there.

              TREATMENT (this icon, popover OPEN): the popover's own close
              button on all twelve, never leaving the panel.

              ★★★ READ THE DIFFERENCE, NOT THE TREATMENT. Tab already walked
              out of this window on press 7 with no help icon present, because
              non-modal is what this window IS. The icon did not cause that and
              did not make it earlier — with the popover open it does not
              happen at all inside twelve presses. So: this window does NOT
              contain Tab today, this slice did not change that, and nothing
              here should be read as a claim that the icon is contained. */}
          <HelpIconButton lang={lang} conceptId={helpConceptId} dialogTitle={title} />
          <ResetSizeButton onClick={resetSize} lang={lang} labelKey="modalResetSize" />
          {/* md like the help and reset buttons beside it, so the header row is one size (§688). */}
          <IconButton size="md" onClick={onClose} label={t(lang, "close")} title={t(lang, "close")}>
            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      {children}
    </div>,
    document.body,
  );
}
