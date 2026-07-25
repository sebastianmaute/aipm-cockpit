"use client";

// The app's shared read-only rich-text sink. Every place that renders stored
// HTML re-sanitises HERE (defence in depth, mirroring comm-send-preview and
// meeting-report) — so an attacker-crafted workspace can never reach the DOM
// even if a load path regresses. sanitizeNoteHtml is idempotent on clean html.
//
// Extracted from notes-window.tsx's NoteBody so the note log and the dashboard
// status narrative share one sink and one prose class string.
import { sanitizeNoteHtml } from "./sanitize-html";

const PROSE_CLASS =
  "text-sm text-foreground [&_a]:text-ui-dark-blue [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc";

export function RichTextView({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={className ? `${PROSE_CLASS} ${className}` : PROSE_CLASS}
      dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(html) }}
    />
  );
}
