"use client";

// src/app/chat-not-saved-notice.tsx — the one line under the chat that says why chats are not saved
// (Turso mode only; the panel decides). A chat identity this browser can no longer open gets its own
// line and a way out: start a new identity for this database. The earlier rows are left alone — they
// stay readable to the operator until retention removes them.

import { useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import { Button } from "./button";
import type { ChatPersistence } from "./use-chat-threads";

/** Why chats are not saved, one line per reason. */
const CHAT_NOT_SAVED_KEY: Record<Exclude<ChatPersistence, "on">, TranslationKey> = {
  "no-recovery-key": "chatNotSavedNoRecoveryKey",
  "no-crypto": "chatNotSavedNoCrypto",
  "identity-locked": "chatNotSavedIdentityLocked",
  "status-unknown": "chatNotSavedStatusUnknown",
};

/** Why an open chat was closed: its row was deleted elsewhere (an erasure, another tab or browser, the
 *  expiry), or a save found no row of it and could not tell whether it was deleted. */
export type ChatThreadCloseReason = "gone" | "unconfirmed";

/** One line after an open chat was closed, saying why (`reason`, "gone" when not given). Nothing while
 *  `closed` is false. */
export function ChatThreadClosedNotice({ lang, closed, reason = "gone" }: { lang: Lang; closed: boolean; reason?: ChatThreadCloseReason }) {
  if (!closed) return null;
  const key = reason === "unconfirmed" ? "chatThreadClosedUnconfirmed" : "chatThreadClosedGone";
  return <p role="status" className="mb-2 shrink-0 text-xs text-muted-foreground">{t(lang, key)}</p>;
}

export interface ChatNotSavedNoticeProps {
  lang: Lang;
  persistence: ChatPersistence;
  /** Replaces this browser's chat identity for the current database with a new one. */
  onStartNewIdentity: () => Promise<void>;
}

export function ChatNotSavedNotice({ lang, persistence, onStartNewIdentity }: ChatNotSavedNoticeProps) {
  const [starting, setStarting] = useState(false);
  if (persistence === "on") return null;

  function start(): void {
    if (starting) return;
    setStarting(true);
    void onStartNewIdentity().finally(() => setStarting(false));
  }

  return (
    <div className="mb-2 flex shrink-0 flex-col items-start gap-1.5">
      <p role="status" className="text-xs text-muted-foreground">{t(lang, CHAT_NOT_SAVED_KEY[persistence])}</p>
      {persistence === "identity-locked" && (
        <Button variant="secondary" size="xs" disabled={starting} onClick={start}>
          {t(lang, "chatStartNewIdentity")}
        </Button>
      )}
    </div>
  );
}
