"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Dispatch, FocusEvent, SetStateAction } from "react";
import { type Lang, t } from "../i18n";
import { Button } from "../button";
import { Card } from "../card";
import { RichTextEditor } from "../rich-text-editor-lazy";
import { RichTextView } from "../rich-text-view";
import { sanitizeRichHtml } from "../sanitize-html";
import { isNarrativeEmpty, narrativeToHtml, normalizeNarrativeHtml } from "../narrative-html";
import type { ProjectStatus } from "../types";
import { useClaimsWhenFocusWithin, useDismissable } from "../use-dismissable";

/** The Dashboard's ONE status summary (Tier 0): the saved narrative, read-only,
 *  with an Edit button — or an Add button when there is none — that swaps it for
 *  `NarrativeEditor` in place. Rich text since R3 — the HTML is re-sanitised at
 *  the SINK (RichTextView), so a regressed load path can never put markup in the
 *  DOM.
 *
 *  ★★ IT ALWAYS RENDERS, and it used to render null when empty. The folded
 *  editor below the tile grid was deleted, which made this the only UI writer of
 *  `status.narrative`: a summary that hid itself when empty would leave no way to
 *  write a first narrative, or a new one after Clear. The ONE exception is
 *  read-only (a popout) AND empty — nothing to show and nothing to do — which
 *  renders null exactly as before, rather than a blank card.
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
export function NarrativeSummary({ lang, status, setStatus, readOnly }: {
  lang: Lang;
  status: ProjectStatus;
  setStatus: Dispatch<SetStateAction<ProjectStatus>>;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const focusFrameRef = useRef(0);
  const html = narrativeToHtml(status.narrative);
  const rendered = html ? sanitizeRichHtml(html) : "";
  const empty = !rendered || isNarrativeEmpty(rendered);

  // ★ Focus returns to the toggle ONLY when the close left it nowhere. Save
  //   unmounts the focused Save button, so focus falls to <body> and goes back
  //   to Edit; a user who clicked or tabbed to another control meant to go
  //   there, and pulling them back would undo their move. rAF because the toggle
  //   does not exist until the read-only branch has committed.
  // ★★ `preventScroll`: a click on non-focusable tile text far down the page
  //   also closes with focus on <body>, and a plain focus() scrolled the page
  //   back up to the summary, away from where the user clicked.
  // ★ The frame is cancelled on unmount, and a second close cancels the first
  //   frame rather than stacking another.
  const done = () => {
    setEditing(false);
    cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) toggleRef.current?.focus({ preventScroll: true });
    });
  };
  useEffect(() => () => cancelAnimationFrame(focusFrameRef.current), []);

  const storedView = empty ? null : (
    <>
      <RichTextView html={rendered} />
      {status.narrativeUpdatedAt ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t(lang, "dashboardNarrativeUpdated", status.narrativeUpdatedAt.slice(0, 10))}
        </p>
      ) : null}
    </>
  );

  if (editing) {
    // ★★ The editor region is print:hidden, and a print from the browser menu
    //   does NOT close it (leaving the window keeps the editor open, see
    //   `onRegionBlur`). So the STORED summary is printed from a print-only
    //   copy. Stored, not the draft: that focusout already ran commit-on-blur,
    //   so the two agree by the time anything prints.
    return (
      <>
        <NarrativeEditor lang={lang} status={status} setStatus={setStatus} autoFocus onDone={done} />
        {storedView && (
          <Card boxed className="hidden p-3 print:block" data-testid="narrative-print-copy">
            {storedView}
          </Card>
        )}
      </>
    );
  }
  if (empty && readOnly) return null;
  return (
    // An empty summary holds only the Add button, which is print:hidden, so
    // the card goes with it rather than printing as a blank box.
    <Card boxed className={empty ? "p-3 print:hidden" : "p-3"}>
      {storedView}
      {!readOnly && (
        <div className={empty ? "flex justify-end print:hidden" : "mt-2 flex justify-end print:hidden"}>
          <Button ref={toggleRef} variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {t(lang, empty ? "dashboardStatusSummaryAdd" : "dashboardStatusSummaryEdit")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Whether `node` is inside `region`, or inside a panel that a control in the
 *  region names through `aria-controls` (a popover portaled out of the region's
 *  DOM subtree). `aria-controls` is an ID list, so each token is checked. */
function isInsideRegion(region: HTMLElement | null, node: Node): boolean {
  if (!region) return false;
  if (region.contains(node)) return true;
  for (const el of region.querySelectorAll("[aria-controls]")) {
    for (const id of (el.getAttribute("aria-controls") ?? "").split(/\s+/)) {
      if (id && document.getElementById(id)?.contains(node)) return true;
    }
  }
  return false;
}

/** The status-summary editor, shown in place of `NarrativeSummary` while
 *  editing. Owns the draft + the render-time reconcile that re-seeds it when an
 *  external workspace reload changes status.narrative (NOT a useEffect —
 *  set-state-in-effect is banned). `onDone` is how it says "return to read-only":
 *  on Save, on Escape, and when focus leaves the whole region, and on nothing
 *  else. */
export function NarrativeEditor({
  lang, status, setStatus, onDone, autoFocus,
}: {
  lang: Lang;
  status: ProjectStatus;
  setStatus: Dispatch<SetStateAction<ProjectStatus>>;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const storedHtml = narrativeToHtml(status.narrative);
  const [prevStoredNarrative, setPrevStoredNarrative] = useState(storedHtml);
  const [draftNarrative, setDraftNarrative] = useState(storedHtml);
  // Remount nonce: RichTextEditor reads `value` only as its mount-time content
  // (useEditor binds it once), so a re-seeded draft needs a fresh editor
  // instance to become visible. Mirrors the notes-window composer nonce.
  const [seedNonce, setSeedNonce] = useState(0);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();

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

  // ★★ Closes only when focus LEAVES the whole region, decided from
  //   `relatedTarget`. React's onBlur is focusout and bubbles, so it also fires
  //   when focus moves to the editor's own toolbar or to Save/Clear; closing on
  //   that would unmount the editor under the user. ★ The Bold CLICK test does
  //   NOT pin this: a toolbar button takes no focus on mousedown, so the click
  //   never blurs the editor (a close-on-every-blur mutant kept it green). The
  //   keyboard Tab / Shift+Tab tests in the sibling test file do. The region is
  //   `tabIndex={-1}` so a click on its heading or padding focuses the region
  //   itself instead of <body>.
  // ★★ A POPOVER THE REGION OPENED COUNTS AS INSIDE IT. The toolbar's heading
  //   menu is a PopoverPanel portaled to document.body that autofocuses its
  //   first item, so `contains` alone saw focus leave and closed the editor
  //   under the menu. Its trigger (inside the region) names the panel through
  //   `aria-controls`, so that link — already required for a11y — identifies it
  //   without a marker on any shared component.
  // ★★ LEAVING THE WINDOW IS NOT LEAVING THE EDITOR. Alt-Tab, the address bar
  //   or devtools fire focusout with a null `relatedTarget` while the document
  //   loses focus; that keeps the editor open. A null `relatedTarget` while the
  //   document still has focus (a click on a dead area of the page) still
  //   closes.
  // ★★ ESCAPE LEAVES THE EDITOR THE WAY FOCUS LEAVING IT DOES: it commits the
  //   draft (never discards it) and closes, and `done` returns focus to Edit.
  //   Through the dismissal stack (docs/AGENTS/ui-shell.md "dismissal"), as a
  //   non-modal `layer` that claims the key only while focus is inside the
  //   region (or nowhere, on <body>): the heading menu, opened later, stays above it and takes the
  //   first Escape, and a surface opened before it is never closed by an
  //   Escape the editor consumed. Only inline (`onDone`) — without it there is
  //   nothing to close, and claiming a key it cannot act on would swallow it.
  const claimsFocusWithin = useClaimsWhenFocusWithin(regionRef);
  useDismissable({
    open: onDone !== undefined,
    kind: "layer",
    onDismiss: () => { commitNarrative(); onDone?.(); },
    claims: claimsFocusWithin,
  });

  const onRegionBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!onDone) return;
    const next = e.relatedTarget as Node | null;
    if (!next) {
      if (document.hasFocus()) onDone();
      return;
    }
    if (!isInsideRegion(regionRef.current, next)) onDone();
  };

  return (
    <div
      ref={regionRef}
      role="group"
      aria-labelledby={headingId}
      tabIndex={-1}
      onBlur={onRegionBlur}
      className="rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)] focus:outline-none print:hidden"
    >
      <p id={headingId} className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
        {t(lang, "dashboardStatusSummary")}
      </p>
      <div className="mt-2">
        {/* Commit-on-blur, as the textarea this replaced did: typing and then
            clicking away must not silently discard the edit. React's onBlur is
            focusout, so it bubbles from the editor surface — the lean editor
            exposes no blur prop of its own. Clear keeps its onMouseDown
            preventDefault so its blur can't commit the text it is about to
            discard; Save's blur commit is a no-op because `unchanged` is then
            true. */}
        <div onBlur={commitNarrative}>
          <RichTextEditor
            key={seedNonce}
            lang={lang}
            label={t(lang, "dashboardNarrativePlaceholder")}
            value={draftNarrative}
            onChange={setDraftNarrative}
            autoFocus={autoFocus}
          />
        </div>
        <div className="mt-2 flex justify-end gap-2 print:hidden">
          {/* ★★ Inline (with `onDone`), Save is NEVER disabled, because it also
              means "done". Pressing it moves focus off the editor first, and
              that blur commits the draft; `unchanged` then went true and
              disabled the button between mousedown and click, so the click
              never fired and the editor never closed. A keyboard user tabbing
              to it hits the same blur. The commit inside is then a no-op. */}
          <Button
            variant="primary"
            size="sm"
            onClick={() => { commitNarrative(); onDone?.(); }}
            disabled={unchanged && !onDone}
          >
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
    </div>
  );
}
