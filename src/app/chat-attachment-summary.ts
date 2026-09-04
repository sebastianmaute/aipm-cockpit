// src/app/chat-attachment-summary.ts — the per-attachment summary line the
// user sees when a dropped file expands into a tree (mail attachments are
// the only source of children today). Non-error disclosure: what the walk
// under this file actually contained, kept out of chat-panel.tsx to stay
// inside its size ratchet.

import type { IngestNode } from "./attachment-ingest";
import { type Lang, t } from "./i18n";

// Count the "skipped -" disclosures the ingest walk wrote into the Markdown,
// surfacing to the USER what the orchestrator already discloses to the model.
//
// ★★ WALKS THE WHOLE TREE, not just the root. A nested mail's own drops are
// written into THAT mail's block, never propagated up, so counting the root
// alone reports 0 for every skip below the first level.
//
// ★ Only a MAIL block carries the walk's diagnostics — a leaf's `data` is the
// extracted document itself, so a .txt reading "skipped - lunch" would
// otherwise be counted as a dropped attachment. A mail's own rendered text —
// body, subject or an attachment filename — that happens to
// say it remains a residual false positive — the walk writes prose, not a
// machine-readable marker.
function countSkipped(node: IngestNode): number {
  const src = node.block.source as { data?: string };
  const own = node.kind === "mail" ? (src.data?.match(/skipped -/g) ?? []).length : 0;
  return node.children.reduce((n, child) => n + countSkipped(child), own);
}

/** Summary line for a staged attachment, or null for a flat file with nothing
 *  to disclose. */
export function buildAttachmentSummary(lang: Lang, fileName: string, node: IngestNode): string | null {
  const kids = node.children.length;
  const skipped = countSkipped(node);
  // ★★ SKIPS ARE COUNTED BEFORE DECIDING THERE IS NOTHING TO SAY. A mail
  // whose ONLY attachment was skipped has no children at all — and that is
  // precisely the user who most needs telling, since the model was handed a
  // drop notice they never saw. Returning null on `kids === 0` alone made
  // `chatAttachmentSummarySkipped` reachable only when some SIBLING had
  // succeeded, i.e. never for the single-attachment case.
  if (kids === 0 && skipped === 0) return null;
  if (skipped > 0) return t(lang, "chatAttachmentSummarySkipped", fileName, String(kids), String(skipped));
  if (kids === 1) return t(lang, "chatAttachmentSummaryOne", fileName);
  return t(lang, "chatAttachmentSummaryMany", fileName, String(kids));
}
