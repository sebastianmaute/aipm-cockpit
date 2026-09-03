// src/app/chat-attachment-summary.ts — the per-attachment summary line the
// user sees when a dropped file expands into a tree (mail attachments are
// the only source of children today). Non-error disclosure: what the walk
// under this file actually contained, kept out of chat-panel.tsx to stay
// inside its size ratchet.

import type { IngestNode } from "./attachment-ingest";
import { type Lang, t } from "./i18n";

// Count the "skipped -" disclosures the ingest walk wrote into the Markdown,
// surfacing to the USER what the orchestrator already discloses to the model.
function countSkipped(node: IngestNode): number {
  const src = node.block.source as { data?: string };
  return (src.data?.match(/skipped -/g) ?? []).length;
}

/** Summary line for a staged attachment, or null for a flat file with no
 *  children worth disclosing. */
export function buildAttachmentSummary(lang: Lang, fileName: string, node: IngestNode): string | null {
  const kids = node.children.length;
  if (kids === 0) return null;
  const skipped = countSkipped(node);
  if (skipped > 0) return t(lang, "chatAttachmentSummarySkipped", fileName, String(kids), String(skipped));
  if (kids === 1) return t(lang, "chatAttachmentSummaryOne", fileName);
  return t(lang, "chatAttachmentSummaryMany", fileName, String(kids));
}
