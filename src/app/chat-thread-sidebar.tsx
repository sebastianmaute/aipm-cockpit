"use client";

// src/app/chat-thread-sidebar.tsx — the Turso chat panel's sidebar COLUMN:
// an optional save/fetch-failure banner (with retry) above the thread list.
// PURE presentational leaf (gantt/documents-list panel-split pattern,
// AGENTS.md "Extraction conventions" rule 5) — no hooks, no Turso IO. Kept
// separate from chat-panel.tsx (already over the file-size ratchet) so
// wiring the sidebar into the panel costs only an import + a few JSX lines.

import { type Lang, t } from "./i18n";
import { Banner } from "./banner";
import { Button } from "./button";
import { ChatThreadList } from "./chat-thread-list";
import type { ChatThread } from "./chat-threads";

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
  return (
    <div className="flex w-56 shrink-0 flex-col gap-2 border-r border-line pr-3">
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
        className="min-h-0 flex-1"
      />
    </div>
  );
}
