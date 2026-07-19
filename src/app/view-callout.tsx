"use client";

import { useState } from "react";
import { InformationCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
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
      <InformationCircleIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ui-dark-blue dark:text-ui-light-grey" />
      <p className="flex-1 text-foreground">{t(lang, callout.textKey)}</p>
      <button
        type="button"
        onClick={() => onLearnMore(callout.conceptId)}
        className={`shrink-0 font-medium text-ui-dark-blue underline-offset-2 hover:underline dark:text-ui-light-grey ${INTERACTIVE}`}
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
        <XMarkIcon aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
