// src/app/chat-threads.ts — pure, i18n-free, DOM-free engine for per-project AI
// chat threads. No React, no Turso IO — see chat-threads-schema.ts/
// chat-threads-store.ts for persistence. chat-panel.tsx is the sole consumer.
import type { ApiMessage, ContentBlock, DisplayItem, TextBlock } from "./chat-api";

export interface ChatThread {
  id: string;
  /** "default" in non-portfolio Turso mode, matching ChatPanel's own projectId default. */
  projectId: string;
  /** Auto-derived from the first user message on first save; empty until then —
   *  callers show a translated "Untitled chat" fallback (this module is i18n-free). */
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Attachment-stripped — see stripAttachmentsForPersistence. */
  history: ApiMessage[];
  display: DisplayItem[];
}

/** Auto-derived thread name is capped at this many Unicode code points. */
export const THREAD_NAME_MAX = 60;

/** Derive a thread's display name from its first user message. Returns "" when
 *  no user message exists yet. Truncates by code point (Array.from), not by
 *  UTF-16 slice — a multi-unit character (e.g. an emoji) at the boundary is
 *  never split into an orphan surrogate. */
export function deriveThreadName(display: readonly DisplayItem[]): string {
  const first = display.find((item) => item.kind === "user");
  if (!first) return "";
  const text = first.text.trim();
  const chars = Array.from(text);
  return chars.length > THREAD_NAME_MAX ? `${chars.slice(0, THREAD_NAME_MAX).join("")}…` : text;
}

/** Placeholder substituted for a stripped attachment block, or null if `block`
 *  isn't an attachment. */
function attachmentPlaceholder(block: ContentBlock): TextBlock | null {
  if (block.type === "image") return { type: "text", text: "[attachment: image]" };
  if (block.type === "document") return { type: "text", text: "[attachment: document]" };
  return null;
}

/** Strip attachment bytes from history before persisting to Turso. Rewriting
 *  every prior attachment on every turn's save (write-amplification) is why
 *  attachments are session-only — see the design doc's "Attachment handling"
 *  section. The live in-session transcript is untouched; only the persisted
 *  copy loses the original bytes. */
export function stripAttachmentsForPersistence(history: readonly ApiMessage[]): ApiMessage[] {
  return history.map((msg): ApiMessage => {
    if (typeof msg.content === "string") return msg;
    return { ...msg, content: msg.content.map((block) => attachmentPlaceholder(block) ?? block) };
  });
}

function attachmentBytes(block: ContentBlock): number {
  return block.type === "image" || block.type === "document" ? block.source.data.length : 0;
}

/** Wire-only: keep the outgoing request under `maxBytes` of attachment payload
 *  by replacing the OLDEST earlier-turn attachments with placeholders (§575).
 *  The LAST message (the current turn) is never touched — the staging cap
 *  already bounds it. Under budget the input array's own messages are returned
 *  unchanged, so an ordinary thread's request is byte-identical and the prompt
 *  cache prefix survives. Never mutates its input. */
export function fitHistoryToBudget(history: readonly ApiMessage[], maxBytes: number): ApiMessage[] {
  let total = 0;
  for (const m of history) {
    if (typeof m.content !== "string") for (const b of m.content) total += attachmentBytes(b);
  }
  if (total <= maxBytes) return history.slice();
  const out = history.slice();
  for (let i = 0; i < out.length - 1 && total > maxBytes; i++) {
    const msg = out[i];
    if (typeof msg.content === "string") continue;
    let changed = false;
    const content = msg.content.map((block) => {
      if (total <= maxBytes) return block;
      const placeholder = attachmentPlaceholder(block);
      if (!placeholder) return block;
      total -= attachmentBytes(block);
      changed = true;
      return placeholder;
    });
    if (changed) out[i] = { ...msg, content } as ApiMessage;
  }
  return out;
}

/** Mint a new thread id, preferring crypto.randomUUID (mirrors newTemplateId in
 *  settings-sections/templates-section.tsx). */
export function newThreadId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
