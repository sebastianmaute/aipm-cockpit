"use client";

import { useCallback, useRef, type RefObject } from "react";
import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { useDismissable } from "./use-dismissable";

interface SimulationIntroProps {
  lang: Lang;
  /** Dismiss for good ("Got it", or Escape). */
  onGotIt: () => void;
  /** Open Help at the simulation entry. Absent where Help cannot be opened
   *  (a popout), in which case the button is not rendered. */
  onShowMe?: () => void;
  /** The control that opened the note. Focus stays on it after the press, so
   *  Escape must be claimed there too, or the note would decline its own key. */
  anchorRef?: RefObject<HTMLElement | null>;
}

/** One-time, NON-modal note shown at the top of the Dashboard when the
 *  "Use Monte Carlo forecasting" switch (burn tile) is first turned on. No focus trap; Escape dismisses
 *  it only while focus is inside it, on its anchor (or nowhere), so it never steals the key
 *  from a field the user is typing in. Escape is "Got it". */
export function SimulationIntro({ lang, onGotIt, onShowMe, anchorRef }: SimulationIntroProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Read at event time, so the refs are live DOM reads (see `useDismissable`).
  const claims = useCallback(() => {
    const focused = document.activeElement;
    if (focused === null || focused === document.body) return true;
    return (ref.current?.contains(focused) ?? false) || (anchorRef?.current?.contains(focused) ?? false);
  }, [anchorRef]);
  // Dismissing from a control inside the note would drop focus to <body>, so hand it back to the switch first.
  const dismiss = useCallback(() => {
    if (ref.current?.contains(document.activeElement)) {
      // The anchor is the switch's wrapper, so focus the control inside it.
      anchorRef?.current?.querySelector<HTMLElement>("button, input, [role='switch']")?.focus();
    }
    onGotIt();
  }, [anchorRef, onGotIt]);
  useDismissable({ open: true, kind: "layer", onDismiss: dismiss, claims });
  return (
    <div
      ref={ref}
      role="note"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground print:hidden"
    >
      <p className="min-w-0 flex-1">{t(lang, "simulationIntroText")}</p>
      <div className="flex shrink-0 items-center gap-2">
        {onShowMe && (
          <Button onClick={onShowMe} variant="secondary" size="xs">
            {t(lang, "simulationIntroShowMe")}
          </Button>
        )}
        <Button onClick={dismiss} variant="secondary" size="xs">
          {t(lang, "simulationIntroGotIt")}
        </Button>
      </div>
    </div>
  );
}
