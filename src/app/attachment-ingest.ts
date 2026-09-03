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
import { bytesToBase64 } from "./base64";

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

/** Fallback `media_type` for an image whose `File.type` is empty — common on
 *  drag-drop. buildAttachmentBlock passes an image's mimeType straight into
 *  `source.media_type` (every other kind builds a fixed value instead), so an
 *  empty mimeType would otherwise emit `media_type: ""` and the API 400s.
 *  classifyAttachment can only reach "image" via this same extension set when
 *  mimeType does not start with "image/" (chat-attachments.ts's
 *  IMAGE_EXTENSIONS / SUPPORTED_IMAGE_MIMES), so this always resolves when it
 *  fires. */
const IMAGE_EXT_MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function imageMimeFallback(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  return IMAGE_EXT_MIME[ext] ?? null;
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
  const outputMime =
    kind === "image" && mimeType.trim() === "" ? (imageMimeFallback(fileName) ?? mimeType) : mimeType;
  try {
    const data = await payloadFor(kind, bytes, mimeType, fileName);
    return {
      ok: true,
      node: { fileName, kind, block: buildAttachmentBlock(kind, outputMime, data), children: [] },
    };
  } catch {
    return { ok: false, error: "read-failed" };
  }
}

/** Browser entry point. Classifies (cheap) before reading the File's bytes
 *  so a large unsupported file is rejected without being loaded into memory,
 *  and so a read failure on a file that would have classified as unsupported
 *  still surfaces as "unsupported-type" rather than "read-failed" — the
 *  wizard treats those two very differently (drop-and-continue vs.
 *  abandon-the-batch). Then defers to ingestBytes so both paths share one
 *  implementation — the wizard already had a bytes-oriented path and the
 *  assistant a File-oriented one, and they had diverged. ingestBytes
 *  re-classifies, which costs nothing. */
export async function ingestFile(file: File): Promise<IngestResult> {
  const sizeErr = checkAttachmentSize(file.size);
  if (sizeErr) return { ok: false, error: sizeErr };
  const kind = classifyAttachment(file.type, file.name);
  if (!kind) return { ok: false, error: "unsupported-type" };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, error: "read-failed" };
  }
  return ingestBytes(bytes, file.type, file.name);
}
