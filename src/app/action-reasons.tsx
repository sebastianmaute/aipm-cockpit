// src/app/action-reasons.tsx
"use client";
import { useState } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

interface ActionReasonsProps {
  lang: Lang;
  /** The primary action — its id keys the aria-controls target. */
  action: SuggestedAction;
  extraReasons?: readonly SuggestedAction[];
}

/** "+N more reasons" disclosure shared by the compact row and the hero card. The
 *  reasons list is ALWAYS mounted and `hidden`-toggled (aria-controls target must
 *  stay in DOM). Renders nothing when there are no extra reasons. */
export function ActionReasons({ lang, action, extraReasons }: ActionReasonsProps) {
  const [open, setOpen] = useState(false);
  if (!extraReasons || extraReasons.length === 0) return null;
  const title = t(lang, action.title.key, ...(action.title.params ?? []));
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`action-reasons-${action.id}`}
        aria-label={`${t(lang, "actionMoreReasons", extraReasons.length)} – ${title}`}
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
