"use client";

// src/app/chat-thread-sidebar.tsx — the Turso chat panel's sidebar COLUMN:
// an optional save/fetch-failure banner (with retry) above the thread list,
// and the column's own drag-to-resize width. Presentational leaf
// (gantt/documents-list panel-split pattern, AGENTS.md "Extraction
// conventions" rule 5) — no data fetching and no Turso IO. Kept separate from
// chat-panel.tsx (which sits EXACTLY at its file-size baseline, so it has zero
// headroom) — which is also why `useResizable` is called HERE rather than in
// the panel and threaded down as a ref: the width is this column's own
// concern, it touches only the DOM and localStorage, and chat-panel.tsx cannot
// take the extra lines.
//
// ★ LAYOUT, and the two halves must move together: `resize` has NO effect on
// an element whose computed `overflow` is `visible` (CSS UI 4 §5.1), so the
// wrapper's `overflow-hidden` is what makes the drag handle exist at all.
// Clipping the wrapper then makes the list's own `overflow-y-auto` mandatory —
// before this, NOTHING here scrolled (the list had `min-h-0 flex-1` and no
// overflow), so a long thread list simply spilled out of the pane. Dropping
// either class re-breaks the other. jsdom has no layout, so no unit test in
// this repo can see the geometry — chat-thread-sidebar.test.tsx pins the
// classes, and the pixels are eye-verify only (this surface is Turso-gated, so
// the axe gate never renders it either).

import { type Lang, t } from "./i18n";
import { Banner } from "./banner";
import { Button } from "./button";
import { ChatThreadList } from "./chat-thread-list";
import { ResetSizeButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import type { ChatThread } from "./chat-threads";

/** localStorage key for the persisted column width. Distinct from the chat
 *  PANE's own `aipm-cockpit:chat-size-v2` — resetting one must not clear the
 *  other. */
const CHAT_SIDEBAR_SIZE_KEY = "aipm-cockpit:chat-sidebar-size";

export interface ChatThreadSidebarProps {
  lang: Lang;
  threads: readonly ChatThread[];
  activeThreadId: string | null;
  /** True when the last fetch/save/rename/delete against Turso failed. */
  error: boolean;
  onRetry: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function ChatThreadSidebar({
  lang,
  threads,
  activeThreadId,
  error,
  onRetry,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: ChatThreadSidebarProps) {
  // ★ `axis: "x"` — this column is `resize-x`, so height is not a dimension the
  // drag can change. Without it the hook records whatever height the flex row
  // had stretched the column to at pointerup (a stray click on the grabber is
  // enough) and replays it forever, so once the chat pane grows taller the
  // sidebar's `border-r` stops short of the pane bottom. The option neither
  // saves nor restores a height, so entries written before it existed are
  // ignored too. First and only x-only consumer of the hook.
  const { ref, reset } = useResizable(CHAT_SIDEBAR_SIZE_KEY, { axis: "x" });
  return (
    // `max-h-full` is now belt-and-braces rather than the primary guard (the
    // hook no longer restores a height for this key) — it still keeps the
    // column from outgrowing the chat pane on any future layout change.
    //
    // `pb-4` is for the drag handle, not for spacing: the browser paints the
    // resize grabber in the bottom-right of the PADDING box, which without it
    // lands on top of the reset button in the footer row below.
    <div
      ref={ref}
      className="flex max-h-full w-56 min-w-[10rem] max-w-[24rem] shrink-0 resize-x flex-col gap-2 overflow-hidden border-r border-line pb-4 pr-3"
    >
      {error && (
        <Banner severity="error" className="flex flex-col items-start gap-1.5">
          <p>{t(lang, "chatThreadSaveFailed")}</p>
          <Button variant="secondary" size="xs" onClick={onRetry}>
            {t(lang, "chatThreadSaveRetry")}
          </Button>
        </Banner>
      )}
      <ChatThreadList
        lang={lang}
        threads={threads}
        activeThreadId={activeThreadId}
        onSelect={onSelect}
        onNew={onNew}
        onRename={onRename}
        onDelete={onDelete}
        // ★ TWO classes, and the split is the point: `overflow-y-auto` belongs
        // on the wrapper around the <ul> ONLY. On the list component's ROOT it
        // would put the New-chat button inside the scroller, so scrolling down
        // to an older thread pushes the column's primary action off the top.
        className="min-h-0 flex-1"
        listClassName="min-h-0 flex-1 overflow-y-auto"
      />
      {/* Its OWN label key, never ResetSizeButton's `tableResetSizeHint`
          default: the chat pane already renders a reset-size button, and two
          reset controls sharing an accessible name while doing different
          things is a WCAG 2.4.6 failure that axe passes (a name exists). */}
      <div className="flex shrink-0 justify-end">
        <ResetSizeButton onClick={reset} lang={lang} labelKey="chatSidebarResetSize" />
      </div>
    </div>
  );
}
