"use client";

import { useRef } from "react";
import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { useDismissable, useClaimsWhenFocusWithin } from "./use-dismissable";

interface SimulationIntroProps {
  lang: Lang;
  /** Dismiss for good ("Got it", or Escape). */
  onGotIt: () => void;
  /** Open Help at the simulation entry. Absent where Help cannot be opened
   *  (a popout), in which case the button is not rendered. */
  onShowMe?: () => void;
}

/** One-time, NON-modal note shown under the Dashboard toolbar when the
 *  "Show simulation" switch is first turned on. No focus trap; Escape dismisses
 *  it only while focus is inside it (or nowhere), so it never steals the key
 *  from a field the user is typing in. */
export function SimulationIntro({ lang, onGotIt, onShowMe }: SimulationIntroProps) {
  const ref = useRef<HTMLDivElement>(null);
  const claims = useClaimsWhenFocusWithin(ref);
  useDismissable({ open: true, kind: "layer", onDismiss: onGotIt, claims });
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
        <Button onClick={onGotIt} variant="secondary" size="xs">
          {t(lang, "simulationIntroGotIt")}
        </Button>
      </div>
    </div>
  );
}
