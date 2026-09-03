// src/app/attachment-ingest.ts — the ONE read/classify/extract pipeline.
//
// ★★★ THREE CONSUMERS CALL THIS AND NONE MAY REIMPLEMENT IT: chat-panel.tsx,
// step0-import-panel.tsx and anything added later. They each carried their own
// copy once, and the copies drifted — the wizard silently rejected six token
// classes the assistant accepted. Phase 2 adds mail recursion HERE, which is
// the other reason the pipeline cannot live in the callers: a dropped .eml is a
// TREE, and three separate tree walks with three separate budgets is not a
// thing anyone should maintain.

import {
  classifyAttachment,
  checkAttachmentSize,
  buildAttachmentBlock,
  type AttachmentKind,
  type AttachmentBlock,
  type AttachmentError,
} from "./chat-attachments";
import { officeKindOf, extractOfficeMarkdown } from "./office-extract";
import { extractHtmlMarkdown } from "./html-extract";

export type IngestNode = {
  fileName: string;
  kind: AttachmentKind;
  block: AttachmentBlock;
  /** Nested attachments, for mail. Empty for every flat file. */
  children: IngestNode[];
};

export type IngestResult =
  | { ok: true; node: IngestNode }
  | { ok: false; error: AttachmentError | "read-failed" | "encrypted" };

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  // Chunked so a large attachment cannot blow the argument limit of String.fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** Extract one file's model-facing payload. Bytes in, `data` for
 *  buildAttachmentBlock out. Mail kinds are handled in Phase 2. */
async function payloadFor(
  kind: AttachmentKind,
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<string> {
  if (kind === "office") {
    const fmt = officeKindOf(mimeType, fileName);
    if (!fmt) throw new Error("unknown office format");
    return extractOfficeMarkdown(bytes, fmt);
  }
  if (kind === "html") return extractHtmlMarkdown(new TextDecoder().decode(bytes));
  if (kind === "text") return new TextDecoder().decode(bytes);
  return bytesToBase64(bytes);
}

export async function ingestBytes(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<IngestResult> {
  const sizeErr = checkAttachmentSize(bytes.byteLength);
  if (sizeErr) return { ok: false, error: sizeErr };
  const kind = classifyAttachment(mimeType, fileName);
  if (!kind) return { ok: false, error: "unsupported-type" };
  try {
    const data = await payloadFor(kind, bytes, mimeType, fileName);
    return {
      ok: true,
      node: { fileName, kind, block: buildAttachmentBlock(kind, mimeType, data), children: [] },
    };
  } catch {
    return { ok: false, error: "read-failed" };
  }
}

/** Browser entry point. Reads the File, then defers to ingestBytes so both
 *  paths share one implementation — the wizard already had a bytes-oriented
 *  path and the assistant a File-oriented one, and they had diverged. */
export async function ingestFile(file: File): Promise<IngestResult> {
  const sizeErr = checkAttachmentSize(file.size);
  if (sizeErr) return { ok: false, error: sizeErr };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, error: "read-failed" };
  }
  return ingestBytes(bytes, file.type, file.name);
}
