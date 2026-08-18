"use client";

// src/app/chat-thread-list.tsx — the Turso-backed chat panel's sidebar list of
// saved AI chat threads. PURE presentational (the gantt/documents-list split):
// no data fetching, no Turso IO, no delete confirmation — the caller
// (chat-panel.tsx) owns a useConfirm instance and confirms before calling
// onDelete, exactly as it already does for its "Clear chat" action.
//
// This surface is Turso-only and the e2e axe gate's seed is file-mode, so it
// never scans this component — see AGENTS.md's a11y hard-constraint bullet.
// The row-unique accessible names (WCAG 2.4.6) and the non-colour active
// marker (WCAG 1.4.1) below are pinned ONLY by chat-thread-list.test.tsx.

import { useRef, useState } from "react";
import { PencilIcon, TrashIcon, PlusIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { EmptyState } from "./empty-state";
import { Input } from "./form-controls";
import { Dot } from "./dot";
import { INTERACTIVE } from "./interaction-styles";
import type { ChatThread } from "./chat-threads";

export interface ChatThreadListProps {
  lang: Lang;
  threads: readonly ChatThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  className?: string;
  /** Classes for the SCROLL wrapper around the thread list itself — never the
   *  root. `overflow-y-auto` on the root would put the New-chat button INSIDE
   *  the scroller, so paging down to an older thread scrolls the column's
   *  primary action out of view. Split into its own prop precisely so a caller
   *  cannot make that mistake by passing `className`. */
  listClassName?: string;
}

/** A blank OR whitespace-only `ChatThread.name` (not yet auto-derived — see
 *  chat-threads.ts `deriveThreadName`) falls back to the translated
 *  "Untitled chat" for both the visible row text and every per-row control's
 *  accessible name. Trims before the fallback check (and returns the TRIMMED
 *  name, not the raw one) so a name that is merely whitespace never renders a
 *  blank-looking row with a non-empty accessible name — mirrors
 *  `commitRename`, which also trims before falling back. */
function displayName(lang: Lang, name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : t(lang, "chatThreadUntitled");
}

export function ChatThreadList({
  lang,
  threads,
  activeThreadId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  className,
  listClassName,
}: ChatThreadListProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  // Double-commit guard (mirrors use-inline-cell-edit.ts): Enter calls
  // commitRename, which clears renamingId and unmounts the focused <Input>.
  // Per the HTML spec's unfocusing steps, removing a focused element fires a
  // native blur — so the still-attached onBlur handler runs commitRename a
  // SECOND time for one keypress. jsdom does not implement node-removal blur,
  // so that exact real-browser sequence cannot be reproduced end-to-end in
  // the unit suite — but real browsers do fire it. A ref — not renamingId
  // state, which is stale inside the same tick's closures — tracks the row
  // actually being renamed; once cleared, a second commit for that id is a
  // no-op. Not reused via useInlineCellEdit: that hook's `InlineField` union
  // is task-row-cell-specific (a fixed set of column names), not an id-keyed
  // row rename — the guard here is the same shape, sized to this component
  // instead.
  //
  // ★ chat-thread-list.test.tsx DOES pin this guard directly, via a
  // different mechanism than literal node-removal blur: it fires the Enter
  // keydown and the blur inside one explicit outer `act()`, which keeps
  // React's flush (and therefore the <Input>'s unmount) from landing between
  // the two dispatches, so both reach the still-mounted node in one
  // synchronous scope — see that test's comment for the mutation proof
  // (guard deleted ⇒ test goes RED, onRename called twice).
  const renamingIdRef = useRef<string | null>(null);

  function startRename(th: ChatThread) {
    renamingIdRef.current = th.id;
    setRenamingId(th.id);
    setDraftName(th.name);
  }

  function commitRename(id: string) {
    if (renamingIdRef.current !== id) return; // double-commit guard (blur after Enter)
    renamingIdRef.current = null;
    setRenamingId(null);
    onRename(id, draftName.trim() || t(lang, "chatThreadUntitled"));
  }

  function cancelRename() {
    renamingIdRef.current = null;
    setRenamingId(null);
  }

  return (
    <div className={`flex flex-col gap-2${className ? ` ${className}` : ""}`}>
      {/* `shrink-0` keeps the primary action at full height when the list below
          it is long; it sits OUTSIDE the scroll wrapper so it can never be
          scrolled away (see `listClassName`). */}
      <Button variant="secondary" size="sm" onClick={onNew} className="w-full shrink-0 justify-center gap-1.5">
        <PlusIcon aria-hidden className="h-4 w-4" />
        {t(lang, "chatThreadNew")}
      </Button>

      <div className={listClassName}>
        {threads.length === 0 ? (
          <EmptyState title={t(lang, "chatThreadEmptyTitle")} description={t(lang, "chatThreadEmptyBody")} compact />
        ) : (
          // Tailwind v4 Preflight sets `list-style: none` on every ul/ol, which
          // makes Safari/VoiceOver drop list/listitem semantics — role="list"
          // restores them (precedent: sidebar-nav.tsx, comm-template-diff-view.tsx).
          <ul role="list" className="flex flex-col gap-0.5">
            {threads.map((th) => {
              const name = displayName(lang, th.name);
              const isActive = th.id === activeThreadId;
              const isRenaming = renamingId === th.id;
              const renameLabel = t(lang, "chatThreadRename", name);

              return (
                <li key={th.id}>
                  {isRenaming ? (
                    <Input
                      autoFocus
                      size="xs"
                      aria-label={renameLabel}
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => commitRename(th.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          commitRename(th.id);
                        } else if (e.key === "Escape") {
                          cancelRename();
                        }
                      }}
                      className="w-full"
                    />
                  ) : (
                    <div className="flex items-center gap-1 rounded-md hover:bg-surface-muted">
                      <button
                        type="button"
                        onClick={() => onSelect(th.id)}
                        aria-label={t(lang, "chatThreadOpen", name)}
                        aria-current={isActive ? "true" : undefined}
                        className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground ${INTERACTIVE}`}
                      >
                        {/* Non-colour active-state cue (WCAG 1.4.1) — always
                            rendered so the row's layout doesn't shift; toggled
                            via `invisible` (mirrors ToggleButton's own pressed
                            marker, AGENTS.md). aria-hidden by default (Dot with
                            no `label`), so it never pollutes the accessible
                            name above. */}
                        <Dot color="bg-ui-dark-blue" size="xs" className={isActive ? "" : "invisible"} />
                        <span className="truncate">{name}</span>
                      </button>
                      <IconButton label={renameLabel} onClick={() => startRename(th)} className="shrink-0">
                        <PencilIcon aria-hidden className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        label={t(lang, "chatThreadDelete", name)}
                        variant="danger"
                        onClick={() => onDelete(th.id)}
                        className="shrink-0"
                      >
                        <TrashIcon aria-hidden className="h-4 w-4" />
                      </IconButton>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
