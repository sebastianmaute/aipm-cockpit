// src/app/workspace-rich-sanitize.ts — the post-decode rich-field pass for the
// CODEC load paths (CSV, Markdown, Turso rows). Open-followups §28.
//
// ★★ WHY A SEPARATE PASS AND NOT THE CODECS: `csvToWorkspace`,
// `markdownToWorkspace` and `rowsToWorkspace` are DOM-free by contract (scripts
// import them with no DOM), while DOMPurify is DOM-bound. So the codecs decode,
// and each BROWSER backend's `load()` runs this over the result — the same
// per-entity normalizers `jsonToWorkspace` and the IndexedDB read already apply
// (`note-log.ts`), so the six rich fields and every note log reach the app
// escaped and sanitized whichever backend they came from.
// ★★★ DOM-BOUND. Import it only from a browser backend; never from a codec, an
// entity sanitizer or anything under `scripts/`.
// ★ Idempotent on the app's own output (sanitizing clean HTML returns it
// unchanged), so data this app wrote loads byte-identical; only a hand-edited
// or foreign file changes, which is the point.
import type { Workspace } from "./workspace";
import {
  sanitizeChangeRichFields,
  sanitizeMilestoneRichFields,
  sanitizeNoteFields,
  sanitizeRaidRichFields,
} from "./note-log";

export function sanitizeDecodedRichFields(ws: Workspace): Workspace {
  return {
    ...ws,
    tasks: ws.tasks.map(sanitizeNoteFields),
    raid: ws.raid.map(sanitizeRaidRichFields),
    ...(ws.milestones ? { milestones: ws.milestones.map(sanitizeMilestoneRichFields) } : {}),
    ...(ws.changes ? { changes: ws.changes.map(sanitizeChangeRichFields) } : {}),
  };
}
