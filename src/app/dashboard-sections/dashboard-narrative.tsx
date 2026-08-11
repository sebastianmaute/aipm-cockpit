"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { type Lang, t } from "../i18n";
import { FOCUS_RING } from "../interaction-styles";
import { Button } from "../button";
import { Card } from "../card";
import { RichTextEditor } from "../rich-text-editor";
import { RichTextView } from "../rich-text-view";
import { sanitizeRichHtml } from "../sanitize-html";
import { isNarrativeEmpty, narrativeToHtml, normalizeNarrativeHtml } from "../narrative-html";
import type { ProjectStatus } from "../types";

/** Read-only exec-summary of the saved status narrative (Tier 0). Renders null
 *  when empty so a blank project shows nothing up top. Rich text since R3 — the
 *  HTML is re-sanitised at the SINK (RichTextView), so a regressed load path can
 *  never put markup in the DOM.
 *
 *  ★★ Emptiness is decided on the SANITISED html, not the stored value. The two
 *  diverge whenever the sink leaves a wrapper with nothing in it, and judging the
 *  pre-sanitised value called that non-empty and rendered a blank card carrying
 *  nothing but an "Updated <date>" line. ★★ The ORIGINAL example no longer
 *  reaches that state and would read as a refutation: a Word-pasted
 *  `<p><u>text</u></p>` used to sanitise to `<p></p>` because the old
 *  `sanitizeNoteHtml` omitted `u` AND deleted a stripped element's text
 *  (KEEP_CONTENT: false); `u` is on RICH_ALLOWED_TAGS now and the value survives
 *  whole. The divergence itself survives — it is just narrower, because it now
 *  needs an element that carries no text of its own. Measured 2026-08-11 through
 *  the real sanitizer: `<p><script>x</script></p>` -> `<p></p>` (isNarrativeEmpty
 *  true), and `<p><img src=x></p>` the same way. Deciding on what actually
 *  reaches the DOM cannot drift from what the user sees.
 *
 *  ★ The sanitised value is then handed to RichTextView, which sanitises AGAIN.
 *  That is deliberate rather than wasteful: sanitizeRichHtml is idempotent
 *  (documented in rich-text-view.tsx, and the second pass is a verified no-op on
 *  its own output), and the alternative — a prop telling the sink to trust its
 *  input — would put a bypass switch on the app's defence-in-depth boundary for
 *  every other caller too. One cheap redundant pass is the better trade. */
export function NarrativeSummary({ lang, status }: { lang: Lang; status: ProjectStatus }) {
  const html = narrativeToHtml(status.narrative);
  const rendered = html ? sanitizeRichHtml(html) : "";
  if (!rendered || isNarrativeEmpty(rendered)) return null;
  return (
    <Card boxed className="p-3">
      <RichTextView html={rendered} />
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

  // What a commit would store: blank markup collapses to "", so clearing the
  // editor stores an empty narrative rather than an empty paragraph.
  const nextValue = isNarrativeEmpty(draftNarrative) ? "" : normalizeNarrativeHtml(draftNarrative);
  const unchanged = nextValue === storedHtml;

  if (storedHtml !== prevStoredNarrative) {
    setPrevStoredNarrative(storedHtml);
    setDraftNarrative(storedHtml);
    // ★★ Bump the remount nonce ONLY for a change the editor does not already
    // hold. A re-seed that originates from our OWN commit-on-blur carries
    // exactly the content in the editor, so remounting is pure loss: mousedown
    // on a toolbar button blurs -> commits -> changes storedHtml -> replaced the
    // editor node before mouseup, so no `click` fired and no format command ever
    // ran (and the fresh instance had no selection to apply one to). A genuine
    // external change (workspace reload) still remounts - useEditor binds
    // `content` once, so that is the only way a new value becomes visible.
    if (storedHtml !== nextValue) setSeedNonce((n) => n + 1);
  }

  const commitNarrative = () => {
    if (unchanged) return;
    setStatus((s) => ({ ...s, narrative: nextValue, narrativeUpdatedAt: new Date().toISOString() }));
  };

  const clearNarrative = () => {
    setDraftNarrative("");
    // ★★ Bump UNCONDITIONALLY: the nonce is the only thing that empties the
    // editor DOM, and the reconcile below can never cover Clear. By the time it
    // runs, `draftNarrative` is already "" so `nextValue === storedHtml === ""`
    // and its `storedHtml !== nextValue` guard is false. Bumping only in the
    // nothing-stored branch left a CLEARED narrative on screen while the stored
    // value was gone — and the next keystroke committed the two merged back
    // together.
    setSeedNonce((n) => n + 1);
    if (storedHtml !== "") {
      setStatus((s) => ({ ...s, narrative: "", narrativeUpdatedAt: new Date().toISOString() }));
    }
  };

  return (
    <details className="rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)] print:hidden">
      <summary className={`cursor-pointer text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey ${FOCUS_RING}`}>
        {t(lang, "dashboardStatusSummary")}
      </summary>
      <div className="mt-2">
        {/* Commit-on-blur, as the textarea this replaced did: typing and then
            clicking away or folding the disclosure must not silently discard the
            edit. React's onBlur is focusout, so it bubbles from the editor
            surface — the lean editor exposes no blur prop of its own. Clear
            keeps its onMouseDown preventDefault so its blur can't commit the
            text it is about to discard; Save's blur commit is a no-op because
            `unchanged` is then true. */}
        <div onBlur={commitNarrative}>
          <RichTextEditor
            key={seedNonce}
            variant="lean"
            lang={lang}
            label={t(lang, "dashboardNarrativePlaceholder")}
            value={draftNarrative}
            onChange={setDraftNarrative}
          />
        </div>
        <div className="mt-2 flex justify-end gap-2 print:hidden">
          <Button variant="primary" size="sm" onClick={commitNarrative} disabled={unchanged}>
            {t(lang, "dashboardStatusSave")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={clearNarrative}
            onMouseDown={(e) => e.preventDefault()}
            title={t(lang, "dashboardStatusClearHint")}
            disabled={storedHtml === "" && isNarrativeEmpty(draftNarrative)}
          >
            {t(lang, "dashboardStatusClear")}
          </Button>
        </div>
      </div>
    </details>
  );
}
