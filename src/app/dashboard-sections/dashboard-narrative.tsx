"use client";

import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { type Lang, t } from "../i18n";
import { TRANSITION, FOCUS_RING, INTERACTIVE } from "../interaction-styles";
import { useAutogrow } from "../use-autogrow";
import type { ProjectStatus } from "../types";

/** Read-only exec-summary of the saved status narrative (Tier 0). Renders null
 *  when empty so a blank project shows nothing up top. Plain text — no
 *  aria-label on the wrapper (dead-label landmine). */
export function NarrativeSummary({ lang, status }: { lang: Lang; status: ProjectStatus }) {
  const text = (status.narrative ?? "").trim();
  if (!text) return null;
  return (
    <div className="rounded-lg border border-line bg-surface p-3 shadow-[var(--shadow-card)]">
      <p className="whitespace-pre-wrap text-sm text-foreground">{text}</p>
      {status.narrativeUpdatedAt ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t(lang, "dashboardNarrativeUpdated", status.narrativeUpdatedAt.slice(0, 10))}
        </p>
      ) : null}
    </div>
  );
}

/** Folded status-summary editor (Tier 3). Owns the draft + autogrow + the
 *  render-time reconcile that re-seeds the draft when an external workspace
 *  reload changes status.narrative (NOT a useEffect — set-state-in-effect is
 *  banned). */
export function NarrativeEditor({
  lang, status, setStatus,
}: {
  lang: Lang;
  status: ProjectStatus;
  setStatus: Dispatch<SetStateAction<ProjectStatus>>;
}) {
  const [prevStoredNarrative, setPrevStoredNarrative] = useState(status.narrative ?? "");
  const [draftNarrative, setDraftNarrative] = useState(status.narrative ?? "");

  const storedNarrative = status.narrative ?? "";
  if (storedNarrative !== prevStoredNarrative) {
    setPrevStoredNarrative(storedNarrative);
    setDraftNarrative(storedNarrative);
  }

  const narrativeRef = useRef<HTMLTextAreaElement | null>(null);
  useAutogrow(narrativeRef, draftNarrative);

  const commitNarrative = () => {
    const trimmed = draftNarrative.trim();
    if (trimmed === (status.narrative ?? "")) return;
    setStatus((s) => ({ ...s, narrative: trimmed, narrativeUpdatedAt: new Date().toISOString() }));
  };

  const clearNarrative = () => {
    setDraftNarrative("");
    if ((status.narrative ?? "") !== "") {
      setStatus((s) => ({ ...s, narrative: "", narrativeUpdatedAt: new Date().toISOString() }));
    }
    // No synchronous resize here: the draft state hasn't flushed yet, so the
    // textarea still holds its old value. The useAutogrow pass re-measures
    // after the cleared value lands in the DOM.
  };

  return (
    <details className="rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)] print:hidden">
      <summary className={`cursor-pointer text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey ${FOCUS_RING}`}>
        {t(lang, "dashboardStatusSummary")}
      </summary>
      <div className="mt-2">
        <textarea
          ref={narrativeRef}
          className={`min-h-24 w-full resize-none rounded-md border border-line bg-surface p-2 text-sm ${TRANSITION} ${FOCUS_RING}`}
          aria-label={t(lang, "dashboardNarrativePlaceholder")}
          placeholder={t(lang, "dashboardNarrativePlaceholder")}
          value={draftNarrative}
          onChange={(e) => setDraftNarrative(e.target.value)}
          onBlur={commitNarrative}
        />
        <div className="mt-2 flex justify-end gap-2 print:hidden">
          <button
            type="button"
            onClick={commitNarrative}
            disabled={draftNarrative.trim() === (status.narrative ?? "")}
            className={`rounded-md bg-AIPM-dark-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
          >
            {t(lang, "dashboardStatusSave")}
          </button>
          <button
            type="button"
            onClick={clearNarrative}
            onMouseDown={(e) => e.preventDefault()}
            disabled={(status.narrative ?? "") === "" && draftNarrative === ""}
            className={`rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
          >
            {t(lang, "dashboardStatusClear")}
          </button>
        </div>
      </div>
    </details>
  );
}
