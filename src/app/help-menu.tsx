"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QuestionMarkCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { INTERACTIVE } from "./interaction-styles";
import { type Lang, t } from "./i18n";
import { HelpContentPane } from "./help-content-pane";
import { useResizable } from "./use-resizable";
import { APP_LICENSE_URL } from "./version";

const STORAGE_KEY_POS = "aipm-cockpit:help-pos";
const STORAGE_KEY_SIZE = "aipm-cockpit:help-size-v3";

// Minimum gap (px) between the help panel and the top/bottom viewport edges
// when the panel opens. The panel can still be dragged anywhere afterwards;
// the `maxHeight` cap on the rendered element keeps the panel from spilling
// into the gutter even after a resize.
const VIEWPORT_PADDING = 100;

type Pos = { x: number; y: number };

function clampPos(p: Pos, panelW: number, panelH: number): Pos {
  return {
    x: Math.max(0, Math.min(p.x, window.innerWidth - panelW)),
    y: Math.max(0, Math.min(p.y, window.innerHeight - panelH)),
  };
}

function loadPos(): Pos | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_POS);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (
      p &&
      typeof p === "object" &&
      "x" in p &&
      "y" in p &&
      typeof (p as Pos).x === "number" &&
      typeof (p as Pos).y === "number"
    ) {
      return p as Pos;
    }
  } catch {
    // ignore
  }
  return null;
}

function savePos(p: Pos) {
  try {
    window.localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(p));
  } catch {
    // non-fatal
  }
}

/** Floating top-bar Help panel: a draggable, resizable pop-over showing the
 *  shared grouped Help content (TOC + cards + search). Content-pane only — the
 *  tabbed tours / relations-map / information-flows surfaces live in the in-pane
 *  Help VIEW, not here. */
export function HelpMenu({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [query, setQuery] = useState("");
  const { ref: panelRef } = useResizable(STORAGE_KEY_SIZE);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Restore saved position on first open; default to near top-right with
  // a VIEWPORT_PADDING-px gutter from top + bottom of the viewport. The
  // fallback numbers here are used only on the very first render before the
  // element has measured itself.
  useEffect(() => {
    if (!open || pos !== null) return;
    const el = panelRef.current;
    const panelW = el?.offsetWidth ?? 820;
    const panelH = el?.offsetHeight ?? 640;
    const saved = loadPos();
    const initial = clampPos(
      saved ?? {
        x: Math.max(0, window.innerWidth - panelW - 36),
        y: VIEWPORT_PADDING,
      },
      panelW,
      panelH,
    );
    // Re-apply the gutter even if a previously-saved position would have
    // placed the panel closer to a viewport edge. If the viewport is so
    // short that the gutter would invert (panel taller than viewport - 2 *
    // padding), fall back to minY so the top edge wins.
    const minY = VIEWPORT_PADDING;
    const maxY = Math.max(minY, window.innerHeight - panelH - VIEWPORT_PADDING);
    setPos({ ...initial, y: Math.min(maxY, Math.max(minY, initial.y)) });
  }, [open, pos, panelRef]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onTitleBarMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!pos) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };

      function onMove(mv: MouseEvent) {
        if (!dragRef.current) return;
        const el = panelRef.current;
        const panelW = el?.offsetWidth ?? 384;
        const panelH = el?.offsetHeight ?? 192;
        const next = clampPos(
          {
            x: dragRef.current.origX + mv.clientX - dragRef.current.startX,
            y: dragRef.current.origY + mv.clientY - dragRef.current.startY,
          },
          panelW,
          panelH,
        );
        setPos(next);
      }

      function onUp() {
        if (dragRef.current) {
          setPos((p) => {
            if (p) savePos(p);
            return p;
          });
          dragRef.current = null;
        }
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [pos, panelRef],
  );

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
          aria-label={t(lang, "help")}
          style={{
            left: pos.x,
            top: pos.y,
            maxWidth: "100vw",
            maxHeight: `calc(100vh - ${2 * VIEWPORT_PADDING}px)`,
          }}
          className="fixed z-50 flex h-[640px] min-h-72 w-[820px] min-w-[420px] flex-col overflow-auto resize rounded-lg border border-line bg-surface"
        >
          <div
            onMouseDown={onTitleBarMouseDown}
            className="flex shrink-0 cursor-move select-none items-center justify-between border-b border-line px-4 py-2"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(lang, "help")}
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className={`rounded p-1 text-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:text-muted-foreground dark:hover:text-ui-light-grey ${INTERACTIVE}`}
            >
              <XMarkIcon aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <div className="shrink-0 border-b border-line p-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(lang, "helpSearchPlaceholder")}
              aria-label={t(lang, "helpSearchPlaceholder")}
              className="w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ui-green"
            />
          </div>

          <HelpContentPane lang={lang} query={query} />

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
