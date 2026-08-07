"use client";

// src/app/chat-tool-block.tsx — the chat transcript's tool-call bubble.
// Extracted from chat-panel.tsx (which is file-size-ratchet baselined) to make
// room for the document-tool file card below without growing that file.

import { useState } from "react";
import { ArrowDownTrayIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { useWorkspace } from "./workspace-context";
import { downloadDocument, type DocFormat } from "./document-download";
import { DOC_FORMATS } from "./documents-toolbar";
import { DOCUMENT_TOOL_DEFS } from "./chat-tool-defs-documents";
import { Button } from "./button";

// ---------------------------------------------------------------------------
// Document file card. A document tool call that succeeded and returned the
// shape below renders as a card instead of a raw JSON blob.
//
// ★★★ THIS RESULT SHAPE IS A CONTRACT THIS TASK IS DEFINING, NOT READING BACK.
// The document tool IMPLEMENTATION (use-document-tools.ts) has not landed —
// nobody has decided what create_document/update_document/get_document
// actually return yet. `parseDocumentResult` below is therefore strictly
// defensive: anything that is not EXACTLY `{ id: number; title: string;
// blockCount: number }` (missing/renamed field, non-object, bare array, a
// numeric id arriving as a string, …) falls back to the plain tool block —
// never a half-populated card, never a throw. `list_documents` (an array) and
// `delete_document` (nothing left worth a card) are EXPECTED to miss this
// shape and fall back; that is intentional, not a gap this should "fix" by
// widening the parser.
// ---------------------------------------------------------------------------

type DocumentCardData = { id: number; title: string; blockCount: number };

// Read DOCUMENT_TOOL_DEFS live inside the function, never cached into a
// module-eval-time Set — a Set snapshotted from an imported const at THIS
// module's own eval time can freeze empty if this module is entered mid an
// import cycle (document-model.ts's header documents the general shape of
// that trap for settings-types/workspace/document-model; DOCUMENT_TOOL_DEFS
// sits in a different, currently acyclic, import graph, but reading it live
// costs nothing and the eager-Set failure mode is silent, so there is no
// reason to risk it).
function isDocumentTool(name: string): boolean {
  return DOCUMENT_TOOL_DEFS.some((def) => def.name === name);
}

function parseDocumentResult(result: string): DocumentCardData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  if (typeof r.id !== "number" || !Number.isInteger(r.id) || r.id <= 0) return null;
  if (typeof r.title !== "string" || r.title.trim() === "") return null;
  if (typeof r.blockCount !== "number" || !Number.isInteger(r.blockCount) || r.blockCount < 0) return null;
  return { id: r.id, title: r.title, blockCount: r.blockCount };
}

// The format this compact surface downloads with — there is no format picker
// here, unlike the full Documents panel. Sourced from DOC_FORMATS (not a
// hardcoded literal) so it can never disagree with that list if its order
// ever changes; DOC_FORMATS[0] is "docx" today, matching the Documents
// panel's own default.
const CARD_DOWNLOAD_FORMAT: DocFormat = DOC_FORMATS[0].value;

function DocumentCard({
  docId,
  title,
  blockCount,
  lang,
}: {
  docId: number;
  title: string;
  blockCount: number;
  lang: Lang;
}) {
  const ws = useWorkspace();
  // The tool result is a snapshot from the moment the call ran. The LIVE
  // document is authoritative when it still exists — a later edit in this
  // same conversation, or a concurrent write, can leave the snapshot stale.
  // Falling back to the tool's own numbers keeps the card USEFUL rather than
  // blank when the document has since been deleted; Download is disabled in
  // that case, since there is nothing left to render into bytes.
  const liveDoc = ws.documents.find((d) => d.id === docId);
  const displayTitle = liveDoc?.title ?? title;
  const displayBlockCount = liveDoc?.blocks.length ?? blockCount;

  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground">
        <DocumentTextIcon aria-hidden="true" className="h-8 w-8 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate font-medium">{displayTitle}</div>
          <div className="text-xs text-muted-foreground">
            {displayBlockCount} {t(lang, "documentsBlockCount")}
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!liveDoc}
          onClick={() => {
            if (liveDoc) downloadDocument(liveDoc, CARD_DOWNLOAD_FORMAT, ws, lang);
          }}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5"
        >
          <ArrowDownTrayIcon aria-hidden="true" className="h-4 w-4" />
          {t(lang, "documentsDownload")}
        </Button>
      </div>
    </div>
  );
}

export function ToolBlock({
  name,
  input,
  result,
  error,
  lang,
}: {
  name: string;
  input: unknown;
  result: string;
  error: boolean;
  lang: Lang;
}) {
  const [open, setOpen] = useState(false);

  // A document tool that succeeded and returned the shape above gets a file
  // card instead of a raw JSON blob.
  const card = !error && isDocumentTool(name) ? parseDocumentResult(result) : null;
  if (card) {
    return <DocumentCard docId={card.id} title={card.title} blockCount={card.blockCount} lang={lang} />;
  }

  return (
    <div className="flex justify-start">
      <details
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
        className={`max-w-[85%] rounded-lg border px-3 py-2 text-xs ${
          error
            ? "border-ui-pink/40 bg-ui-pink/10 text-ui-dark-blue dark:border-ui-pink/50 dark:bg-ui-pink/15 dark:text-ui-light-grey"
            : "border-line bg-surface text-foreground"
        }`}
      >
        <summary className="cursor-pointer select-none font-mono">
          {error ? `⚠ ${t(lang, "chatToolError")}: ` : "▸ "}
          {t(lang, "chatToolCall", name)}
        </summary>
        <div className="mt-2 space-y-1">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-surface-muted p-2 font-mono text-[11px]">
            {JSON.stringify(input, null, 2)}
          </pre>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-surface-muted p-2 font-mono text-[11px]">
            {result}
          </pre>
        </div>
      </details>
    </div>
  );
}
