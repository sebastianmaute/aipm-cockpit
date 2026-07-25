"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { type Lang, t } from "../i18n";
import { FOCUS_RING } from "../interaction-styles";
import { Button } from "../button";
import { Card } from "../card";
import { RichTextEditor } from "../rich-text-editor";
import { RichTextView } from "../rich-text-view";
import { isNarrativeEmpty, narrativeToHtml, normalizeNarrativeHtml } from "../narrative-html";
import type { ProjectStatus } from "../types";

/** Read-only exec-summary of the saved status narrative (Tier 0). Renders null
 *  when empty so a blank project shows nothing up top. Rich text since R3 — the
 *  HTML is re-sanitised at the SINK (RichTextView), so a regressed load path can
 *  never put markup in the DOM. */
export function NarrativeSummary({ lang, status }: { lang: Lang; status: ProjectStatus }) {
  const html = narrativeToHtml(status.narrative);
  if (!html || isNarrativeEmpty(html)) return null;
  return (
    <Card boxed className="p-3">
      <RichTextView html={html} />
      {status.narrativeUpdatedAt ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t(lang, "dashboardNarrativeUpdated", status.narrativeUpdatedAt.slice(0, 10))}
        </p>
      ) : null}
    </Card>
  );
}

/** Folded status-summary editor (Tier 3). Owns the draft + the render-time
 *  reconcile that re-seeds it when an external workspace reload changes
 *  status.narrative (NOT a useEffect — set-state-in-effect is banned). */
export function NarrativeEditor({
  lang, status, setStatus,
}: {
  lang: Lang;
  status: ProjectStatus;
  setStatus: Dispatch<SetStateAction<ProjectStatus>>;
}) {
  const storedHtml = narrativeToHtml(status.narrative);
  const [prevStoredNarrative, setPrevStoredNarrative] = useState(storedHtml);
  const [draftNarrative, setDraftNarrative] = useState(storedHtml);
  // Remount nonce: RichTextEditor reads `value` only as its mount-time content
  // (useEditor binds it once), so a re-seeded draft needs a fresh editor
  // instance to become visible. Mirrors the notes-window composer nonce.
  const [seedNonce, setSeedNonce] = useState(0);

  if (storedHtml !== prevStoredNarrative) {
    setPrevStoredNarrative(storedHtml);
    setDraftNarrative(storedHtml);
    setSeedNonce((n) => n + 1);
  }

  // What a commit would store: blank markup collapses to "", so clearing the
  // editor stores an empty narrative rather than an empty paragraph.
  const nextValue = isNarrativeEmpty(draftNarrative) ? "" : normalizeNarrativeHtml(draftNarrative);
  const unchanged = nextValue === storedHtml;

  const commitNarrative = () => {
    if (unchanged) return;
    setStatus((s) => ({ ...s, narrative: nextValue, narrativeUpdatedAt: new Date().toISOString() }));
  };

  const clearNarrative = () => {
    setDraftNarrative("");
    if (storedHtml !== "") {
      setStatus((s) => ({ ...s, narrative: "", narrativeUpdatedAt: new Date().toISOString() }));
    } else {
      // Nothing stored to reconcile against, so bump the nonce here: the editor
      // must drop its own content even though `storedHtml` does not change.
      setSeedNonce((n) => n + 1);
    }
  };

  return (
    <details className="rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)] print:hidden">
      <summary className={`cursor-pointer text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey ${FOCUS_RING}`}>
        {t(lang, "dashboardStatusSummary")}
      </summary>
      <div className="mt-2">
        <RichTextEditor
          key={seedNonce}
          variant="lean"
          lang={lang}
          label={t(lang, "dashboardNarrativePlaceholder")}
          value={draftNarrative}
          onChange={setDraftNarrative}
        />
        <div className="mt-2 flex justify-end gap-2 print:hidden">
          <Button variant="primary" size="sm" onClick={commitNarrative} disabled={unchanged}>
            {t(lang, "dashboardStatusSave")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={clearNarrative}
            onMouseDown={(e) => e.preventDefault()}
            disabled={storedHtml === "" && isNarrativeEmpty(draftNarrative)}
          >
            {t(lang, "dashboardStatusClear")}
          </Button>
        </div>
      </div>
    </details>
  );
}
