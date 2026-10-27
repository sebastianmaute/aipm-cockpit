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

/** The name a rename draft becomes once committed: trimmed, and the caller-supplied translated
 *  "Untitled chat" (this module is i18n-free) when nothing is left. The one rule shared by the list's commit and the outbox replay (§626). */
export function normalizeThreadName(draft: string, untitled: string): string {
  return draft.trim() || untitled;
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

// AI-08 / AI-05 — a thread saved before the tool results were minimised still carries, in its
// stored API history, tool results with e-mail addresses and an absence's real type and note. Loading it would
// send them to the model again with the next message, so they are removed on load (`rowsToThreads`). Only
// `tool_result` blocks are touched: the user's and the assistant's own text stays as written, and so does the
// result of a `get_contact_email` call, the one tool built to return an address.

/** The e-mail fields of the pre-upgrade tool results: task `assigneeEmail`, stakeholder `email`, resource
 *  `email`/`emails`, RAID `ownerEmail`, an escalation's `toEmail`, absence `assigneeEmail`. */
const STORED_EMAIL_KEYS: ReadonlySet<string> = new Set(["assigneeEmail", "ownerEmail", "toEmail", "email", "emails"]);
const ABSENCE_TYPE_VALUES: ReadonlySet<string> = new Set(["vacation", "sick", "training", "other", "absent"]);

/** An absence row or summary: an assignee, a start and end date and an absence type. */
function isAbsenceShaped(o: Record<string, unknown>): boolean {
  return typeof o.assignee === "string" && typeof o.startDate === "string" && typeof o.endDate === "string"
    && typeof o.type === "string" && ABSENCE_TYPE_VALUES.has(o.type);
}

/** A copy of `value` without the e-mail fields, every absence's type read as "absent" and its note dropped. */
function minimiseValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(minimiseValue);
  if (typeof value !== "object" || value === null) return value;
  const o = value as Record<string, unknown>;
  const absence = isAbsenceShaped(o);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (STORED_EMAIL_KEYS.has(k)) continue;
    if (absence && k === "note") continue;
    out[k] = absence && k === "type" ? "absent" : minimiseValue(v);
  }
  return out;
}

const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** A `"note": "…"` member, escaped quotes inside the string included. */
const NOTE_FIELD = /"note"\s*:\s*"(?:[^"\\]|\\.)*"/g;

/** A tool result's text with the same data removed. JSON (what `stringifyResult` writes) is minimised field by
 *  field and written back the same way, and left byte-identical when nothing was removed. A JSON value that is
 *  not an object or array loses every e-mail address; text that does not parse (an error message, a cut result)
 *  also loses every `note` string and has any absence type read as "absent". */
export function minimiseToolResultText(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text
      .replace(EMAIL_ADDRESS, "[email removed]")
      .replace(NOTE_FIELD, '"note": ""')
      .replace(/"type"\s*:\s*"(?:vacation|sick|training|other)"/g, '"type": "absent"');
  }
  if (typeof parsed !== "object" || parsed === null) return text.replace(EMAIL_ADDRESS, "[email removed]");
  const minimised = minimiseValue(parsed);
  return JSON.stringify(minimised) === JSON.stringify(parsed) ? text : JSON.stringify(minimised, null, 2);
}

/** The one tool whose result IS an address (AI-08): what it returned was asked for, one person at a time. */
const KEPT_RESULT_TOOL = "get_contact_email";

/** The ids of every `tool_use` block in `history` that called `KEPT_RESULT_TOOL`. */
function keptToolUseIds(history: readonly ApiMessage[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const msg of history) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block && block.type === "tool_use" && block.name === KEPT_RESULT_TOOL) ids.add(block.id);
    }
  }
  return ids;
}

/** `history` with every stored `tool_result` minimised (`minimiseToolResultText`), except the result of a
 *  `get_contact_email` call — matched by its `tool_use_id` to a `tool_use` of that name in the same history —
 *  which keeps the address it was called for. Other blocks and string messages are returned as they are. Never
 *  mutates its input. */
export function minimiseStoredToolResults(history: readonly ApiMessage[]): ApiMessage[] {
  const kept = keptToolUseIds(history);
  return history.map((msg): ApiMessage => {
    if (typeof msg.content === "string" || !Array.isArray(msg.content)) return msg;
    return {
      ...msg,
      content: msg.content.map((block) =>
        block && block.type === "tool_result" && typeof block.content === "string" && !kept.has(block.tool_use_id)
          ? { ...block, content: minimiseToolResultText(block.content) }
          : block),
    };
  });
}
