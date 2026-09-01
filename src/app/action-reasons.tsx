// src/app/action-reasons.tsx
"use client";
import { useState } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { rowLabel } from "./row-tokens";

interface ActionReasonsProps {
  lang: Lang;
  /** The primary action — its id keys the aria-controls target. */
  action: SuggestedAction;
  extraReasons?: readonly SuggestedAction[];
  /** Occurrence-qualified row name from the list owner. REQUIRED — this button
   *  used to qualify itself with the raw action TITLE, which is free text and
   *  can repeat, so two rows sharing a title collided anyway (§324). */
  rowToken: string;
}

/** "+N more reasons" disclosure shared by the compact row and the hero card. The
 *  reasons list is ALWAYS mounted and `hidden`-toggled (aria-controls target must
 *  stay in DOM). Renders nothing when there are no extra reasons. */
export function ActionReasons({ lang, action, extraReasons, rowToken }: ActionReasonsProps) {
  const [open, setOpen] = useState(false);
  if (!extraReasons || extraReasons.length === 0) return null;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`action-reasons-${action.id}`}
        aria-label={rowLabel(t(lang, "actionMoreReasons", extraReasons.length), rowToken)}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={`mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ${FOCUS_RING} ${TRANSITION}`}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        {t(lang, "actionMoreReasons", extraReasons.length)}
      </button>
      <span id={`action-reasons-${action.id}`} hidden={!open} className="mt-0.5 block">
        {extraReasons.map((ex) => (
          <span key={ex.id} className="block truncate text-xs text-muted-foreground">
            {t(lang, ex.why.key, ...(ex.why.params ?? []))}
          </span>
        ))}
      </span>
    </>
  );
}
