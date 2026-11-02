"use client";

// src/app/chat-not-saved-notice.tsx — the one line under the chat that says why chats are not saved
// (Turso mode only; the panel decides). A chat identity this browser can no longer open gets its own
// line and two ways out: start a new identity for this database (asked first whether the old chats go
// too), or delete the old chats (type-to-confirm, the same value as "Delete all my chats"). Kept old
// rows stay readable to the operator until retention removes them, or a later delete-all.

import { useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import { Banner } from "./banner";
import { Button } from "./button";
import { TypeToConfirmDialog } from "./type-to-confirm-dialog";
import type { ChatPersistence } from "./use-chat-threads";

/** Why chats are not saved, one line per reason. */
const CHAT_NOT_SAVED_KEY: Record<Exclude<ChatPersistence, "on">, TranslationKey> = {
  "no-recovery-key": "chatNotSavedNoRecoveryKey",
  "no-crypto": "chatNotSavedNoCrypto",
  "identity-locked": "chatNotSavedIdentityLocked",
  "identity-retry": "chatNotSavedIdentityRetry",
  "status-unknown": "chatNotSavedStatusUnknown",
};

/** Why an open chat was closed: its row was deleted elsewhere (an erasure, another tab or browser, the
 *  expiry), or a save found no row of it and could not tell whether it was deleted, or it belongs to
 *  the database the user has just left. */
export type ChatThreadCloseReason = "gone" | "unconfirmed" | "otherDatabase";

const CLOSED_KEY: Record<ChatThreadCloseReason, TranslationKey> = {
  gone: "chatThreadClosedGone",
  unconfirmed: "chatThreadClosedUnconfirmed",
  otherDatabase: "chatThreadClosedOtherDatabase",
};

/** One line after an open chat was closed, saying why (`reason`, "gone" when not given). Nothing while
 *  `closed` is false. */
export function ChatThreadClosedNotice({ lang, closed, reason = "gone" }: { lang: Lang; closed: boolean; reason?: ChatThreadCloseReason }) {
  if (!closed) return null;
  return <p role="status" className="mb-2 shrink-0 text-xs text-muted-foreground">{t(lang, CLOSED_KEY[reason])}</p>;
}

export interface ChatNotSavedNoticeProps {
  lang: Lang;
  persistence: ChatPersistence;
  /** Replaces this browser's chat identity for the current database with a new one. */
  onStartNewIdentity: () => Promise<void>;
  /** Deletes every chat of this browser's owner ids in the database (the delete-all); offered while the
   *  identity is locked. Rejects when the delete fails. */
  onDeleteOldChats?: () => Promise<unknown>;
}

export function ChatNotSavedNotice({ lang, persistence, onStartNewIdentity, onDeleteOldChats }: ChatNotSavedNoticeProps) {
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState<"closed" | "asking" | "busy">("closed");
  const [deleteFailed, setDeleteFailed] = useState(false);
  if (persistence === "on") return null;
  const locked = persistence === "identity-locked";

  function start(): void {
    if (starting) return;
    setStarting(true);
    void onStartNewIdentity().finally(() => setStarting(false));
  }

  function deleteOld(): void {
    if (!onDeleteOldChats || deleting === "busy") return;
    setDeleting("busy");
    setDeleteFailed(false);
    onDeleteOldChats().then(
      () => setDeleting("closed"),
      () => {
        setDeleting("closed");
        setDeleteFailed(true);
      },
    );
  }

  return (
    <div className="mb-2 flex shrink-0 flex-col items-start gap-1.5">
      <p role="status" className="text-xs text-muted-foreground">{t(lang, CHAT_NOT_SAVED_KEY[persistence])}</p>
      {locked && deleteFailed && <Banner severity="error" role="alert">{t(lang, "chatDeleteAllFailed")}</Banner>}
      {locked && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" size="xs" disabled={starting} onClick={start}>
            {t(lang, "chatStartNewIdentity")}
          </Button>
          {onDeleteOldChats && (
            <Button variant="secondary" size="xs" disabled={deleting === "busy"} onClick={() => setDeleting("asking")}>
              {t(lang, "chatDeleteOldChats")}
            </Button>
          )}
        </div>
      )}
      {locked && deleting === "asking" && (
        <TypeToConfirmDialog
          lang={lang}
          title={t(lang, "chatDeleteOldChatsTitle")}
          message={t(lang, "chatDeleteOldChatsMessage")}
          confirmValue={t(lang, "chatDeleteAllConfirmValue")}
          confirmLabel={t(lang, "chatDeleteAllConfirm")}
          onConfirm={deleteOld}
          onCancel={() => setDeleting("closed")}
        />
      )}
    </div>
  );
}
