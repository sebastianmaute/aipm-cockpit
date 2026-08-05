"use client";

import { useState } from "react";
import { QuestionMarkCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { INTERACTIVE } from "./interaction-styles";
import { type Lang, t } from "./i18n";
import { HelpContentPane } from "./help-content-pane";
import { ClearableSearchInput } from "./clearable-search-input";
import { useResizable } from "./use-resizable";
import { useDraggableWindow, type ComputeInitialPos } from "./use-draggable-window";
import { ResetSizeButton } from "./task-manager-ui";
import { useClaimsWhenFocusWithin, useDismissable } from "./use-dismissable";
import { usePanelInitialFocus } from "./use-panel-focus";
import { APP_LICENSE_URL } from "./version";
import { useSettings } from "./use-settings";

const STORAGE_KEY_POS = "aipm-cockpit:help-pos";
const STORAGE_KEY_SIZE = "aipm-cockpit:help-size-v3";

// Minimum gap (px) between the help panel and the top/bottom viewport edges
// when the panel opens. The panel can still be dragged anywhere afterwards;
// the `maxHeight` cap on the rendered element keeps the panel from spilling
// into the gutter even after a resize.
const VIEWPORT_PADDING = 100;

// Restore saved position on first open; default to near top-right with a
// VIEWPORT_PADDING-px gutter from top + bottom of the viewport. Then re-apply
// the gutter even if a previously-saved position would have placed the panel
// closer to a viewport edge. If the viewport is so short that the gutter would
// invert (panel taller than viewport - 2 * padding), fall back to minY so the
// top edge wins.
const computeHelpInitialPos: ComputeInitialPos = ({ saved, panelW, panelH, clamp }) => {
  const initial = clamp(
    saved ?? {
      x: Math.max(0, window.innerWidth - panelW - 36),
      y: VIEWPORT_PADDING,
    },
  );
  const minY = VIEWPORT_PADDING;
  const maxY = Math.max(minY, window.innerHeight - panelH - VIEWPORT_PADDING);
  return { ...initial, y: Math.min(maxY, Math.max(minY, initial.y)) };
};

/** Floating top-bar Help panel: a draggable, resizable pop-over showing the
 *  shared grouped Help content (TOC + cards + search). Content-pane only — the
 *  tabbed tours / relations-map / information-flows surfaces live in the in-pane
 *  Help VIEW, not here. */
export function HelpMenu({ lang }: { lang: Lang }) {
  // ★ A LOCAL useSettings(), not a prop threaded through `ActionMenus` (which
  // mounts this component). That contract is guarded by
  // `action-menus-sweep.test.ts` and documents a props-not-hooks rule for the
  // export config; widening it would add three hops for a value one component
  // needs. The rule's original reason — a second instance not seeing a change
  // until reload — no longer applies: `use-settings.ts` keeps every live
  // instance in step through a module-level listener registry.
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { ref: panelRef, reset: resetHelpSize } = useResizable(STORAGE_KEY_SIZE);
  // Drag/position (shared with notes-window); size stays on useResizable above.
  // The panel renders only once `pos` is set, so the placement fallback size is
  // the panel's default dimensions.
  const { pos, onTitleBarMouseDown } = useDraggableWindow(STORAGE_KEY_POS, {
    open,
    panelRef,
    computeInitialPos: computeHelpInitialPos,
    fallbackWidth: 820,
    fallbackHeight: 640,
  });

  // Escape closes the panel — but only while focus is inside it, or nowhere.
  // Same shape as `notes-window`: a persistent draggable panel that stays open
  // while the user works elsewhere must not answer an Escape aimed at the
  // dialog they are actually typing in.
  // ★★ Move focus INTO the panel on open — see `usePanelInitialFocus`. The
  // trigger keeps focus otherwise, so `claimsFocusWithin` reads false and this
  // panel declines an Escape aimed at it, handing the key to whatever is
  // beneath. It also means a screen reader is finally told the dialog opened.
  // ★ `open && pos !== null` — the SECOND gate matters. This panel renders on
  // `{open && pos && …}` and `pos` lands a tick after open, so passing raw
  // `open` focuses nothing (the node does not exist yet when the deferred frame
  // fires) and the panel goes on declining its own Escape.
  usePanelInitialFocus(panelRef, open && pos !== null);

  const claimsFocusWithin = useClaimsWhenFocusWithin(panelRef);
  useDismissable({
    open,
    kind: "layer",
    onDismiss: () => setOpen(false),
    claims: claimsFocusWithin,
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "help")}
        aria-expanded={open}
        title={t(lang, "help")}
        className="rounded-md p-2 text-foreground hover:bg-surface-muted hover:text-ui-dark-blue focus:outline-none focus:ring-2 focus:ring-ui-green dark:text-muted-foreground dark:hover:text-ui-light-grey"
      >
        <QuestionMarkCircleIcon aria-hidden="true" className="h-5 w-5" />
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          role="dialog"
          // Focus target for `usePanelInitialFocus` — no focus ring, not in the
          // tab order.
          tabIndex={-1}
          aria-label={t(lang, "help")}
          style={{
            left: pos.x,
            top: pos.y,
            maxWidth: "100vw",
            maxHeight: `calc(100vh - ${2 * VIEWPORT_PADDING}px)`,
          }}
          className="fixed z-50 flex h-[640px] min-h-72 w-[820px] min-w-[420px] flex-col overflow-auto resize rounded-lg border border-line bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green"
        >
          <div
            onMouseDown={onTitleBarMouseDown}
            className="flex shrink-0 cursor-move select-none items-center justify-between border-b border-line px-4 py-2"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(lang, "help")}
            </h3>
            <div className="flex items-center gap-1">
              {/* The panel is drag-resizable and its size persists, so without a
                * reset there is no way back to the default once dragged.
                * (onTitleBarMouseDown ignores presses on any button, so this
                * needs no stopPropagation wrapper.) */}
              {/* modalResetSize, NOT the default pane label: the Help panel
                * floats over a pane whose own reset button is always present,
                * so sharing "Reset back to the default size." would put two
                * identically-named buttons on screen (WCAG 2.4.6). Same reason
                * modal-header uses this key. */}
              <ResetSizeButton onClick={resetHelpSize} lang={lang} labelKey="modalResetSize" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t(lang, "close")}
                className={`rounded p-1 text-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:text-muted-foreground dark:hover:text-ui-light-grey ${INTERACTIVE}`}
              >
                <XMarkIcon aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="shrink-0 border-b border-line p-2">
            {/* ★ This window can float ON TOP of the in-pane Help view, whose
                field carries `helpSearchPlaceholder`. Two identically-named
                fields (and two identically-named clears) in one accessibility
                tree is WCAG 2.4.6, so the NAME is window-qualified here while
                the visible placeholder stays the shared wording. */}
            <ClearableSearchInput
              value={query}
              onClear={() => setQuery("")}
              clearLabel={`${t(lang, "clear")} – ${t(lang, "helpSearchPanelLabel")}`}
            >
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(lang, "helpSearchPlaceholder")}
                aria-label={t(lang, "helpSearchPanelLabel")}
                className={`w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ui-green [&::-webkit-search-cancel-button]:appearance-none${query ? " pr-8" : ""}`}
              />
            </ClearableSearchInput>
          </div>

          <HelpContentPane lang={lang} query={query} readingLevel={settings.helpReadingLevel ?? "standard"} />

          <div className="flex shrink-0 items-center justify-end gap-4 border-t border-line px-4 py-2">
            <a
              href={APP_LICENSE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-ui-dark-blue underline-offset-2 hover:underline dark:text-ui-blue"
            >
              {t(lang, "versionLicense")} ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
