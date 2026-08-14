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

import { useState } from "react";
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
}

/** A blank `ChatThread.name` (not yet auto-derived — see chat-threads.ts
 *  `deriveThreadName`) falls back to the translated "Untitled chat" for both
 *  the visible row text and every per-row control's accessible name. */
function displayName(lang: Lang, name: string): string {
  return name || t(lang, "chatThreadUntitled");
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
}: ChatThreadListProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  function startRename(th: ChatThread) {
    setRenamingId(th.id);
    setDraftName(th.name);
  }

  function commitRename(id: string) {
    onRename(id, draftName.trim() || t(lang, "chatThreadUntitled"));
    setRenamingId(null);
  }

  function cancelRename() {
    setRenamingId(null);
  }

  return (
    <div className={`flex flex-col gap-2${className ? ` ${className}` : ""}`}>
      <Button variant="secondary" size="sm" onClick={onNew} className="w-full justify-center gap-1.5">
        <PlusIcon aria-hidden className="h-4 w-4" />
        {t(lang, "chatThreadNew")}
      </Button>

      {threads.length === 0 ? (
        <EmptyState title={t(lang, "chatThreadEmptyTitle")} description={t(lang, "chatThreadEmptyBody")} compact />
      ) : (
        <ul className="flex flex-col gap-0.5">
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
                  <div className="group flex items-center gap-1 rounded-md hover:bg-surface-muted">
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
  );
}
