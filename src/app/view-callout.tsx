"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import type { AppView } from "./nav-config";
import { VIEW_CALLOUTS } from "./view-callouts";
import { loadDismissed, dismissView } from "./view-hints-store";
import { INTERACTIVE } from "./interaction-styles";

interface ViewCalloutProps {
  view: AppView;
  lang: Lang;
  /** Global "show view hints" setting (Settings → Appearance). */
  showHints: boolean;
  /** Popouts are read-only — dismissals never persist. */
  isPopout: boolean;
  /** Deep-link the matching Help concept (wired to `requestHelpConcept`). */
  onLearnMore: (conceptId: string) => void;
}

/** Contextual per-view Help callout (SP2): a slim, dismissable banner that
 *  explains what the current view is for and links into the matching Help
 *  concept. Presentational (no context — the Kanban board renders one too,
 *  outside the tab context). Renders nothing when the view has no callout,
 *  hints are off, the callout was dismissed, or in a popout. */
export function ViewCallout({ view, lang, showHints, isPopout, onLearnMore }: ViewCalloutProps) {
  const callout = VIEW_CALLOUTS[view];
  // Lazy-load the dismissed map once; dismissing updates local state so the
  // banner hides immediately without a storage re-read.
  const [dismissed, setDismissed] = useState<Record<string, true>>(loadDismissed);

  if (!callout || !showHints || isPopout || dismissed[view]) return null;

  return (
    <div className="mb-2 flex shrink-0 items-start gap-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-xs print:hidden">
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-AIPM-dark-blue dark:text-AIPM-light-grey">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
      </svg>
      <p className="flex-1 text-foreground">{t(lang, callout.textKey)}</p>
      <button
        type="button"
        onClick={() => onLearnMore(callout.conceptId)}
        className={`shrink-0 font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-light-grey ${INTERACTIVE}`}
      >
        {t(lang, "viewHintLearnMore")}
        <span aria-hidden="true"> →</span>
      </button>
      <button
        type="button"
        onClick={() => setDismissed(dismissView(view, isPopout))}
        aria-label={t(lang, "viewHintDismiss")}
        title={t(lang, "viewHintDismiss")}
        className={`shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground ${INTERACTIVE}`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
    </div>
  );
}
