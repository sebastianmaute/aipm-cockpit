// src/app/chat-attachments.ts — pure, i18n-free module for AI-Assistant document ingestion.
// Classifies uploaded files and builds Anthropic Messages API content blocks.
// Caller is responsible for reading file bytes; this module is synchronous.

import { officeKindOf } from "./office-extract";

// ---------------------------------------------------------------------------
// Exported types — chat-panel.tsx imports these to extend its ContentBlock union
// ---------------------------------------------------------------------------

export type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};

export type DocumentBlock = {
  type: "document";
  source:
    | { type: "base64"; media_type: string; data: string }
    | { type: "text"; media_type: "text/plain"; data: string };
};

export type AttachmentBlock = ImageBlock | DocumentBlock;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB

// ---------------------------------------------------------------------------
// Exported narrower types
// ---------------------------------------------------------------------------

export type AttachmentKind = "pdf" | "image" | "text" | "office";
export type AttachmentError = "unsupported-type" | "too-large";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export const SUPPORTED_IMAGE_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export const PDF_EXTENSIONS: ReadonlySet<string> = new Set([".pdf"]);
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([".txt", ".md", ".markdown", ".csv", ".vtt"]);
export const HTML_EXTENSIONS: ReadonlySet<string> = new Set([".html", ".htm"]);
export const OFFICE_EXTENSIONS: ReadonlySet<string> = new Set([".docx", ".xlsx", ".xlsm", ".pptx"]);

/** Extra MIME tokens the picker should offer. Extensions alone are not enough:
 *  a file arriving as application/octet-stream with no extension is classified
 *  by MIME, and a picker listing only extensions filters it out before
 *  classifyAttachment ever sees it. */
const ACCEPT_MIMES = [
  "application/pdf",
  // Deliberately OVER-offers relative to SUPPORTED_IMAGE_MIMES — this is what
  // triggers camera capture in mobile file pickers (this app ships as a PWA).
  // An image type the picker admits but the classifier does not recognise
  // still comes back null from classifyAttachment and surfaces as the normal
  // unsupported-file error; that failure is loud, unlike the silent
  // under-offer this whole constant exists to close.
  "image/*",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/vtt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

/** ★★★ THE SINGLE SOURCE FOR EVERY FILE PICKER IN THE APP. Three consumers
 *  (chat-panel, step0-import-panel, and anything added later) must use this and
 *  never hand-write an accept string. They did hand-write them once and drifted
 *  by six tokens — .markdown plus every MIME type — so the wizard silently
 *  rejected files the assistant accepted. Deriving it from the same sets
 *  classifyAttachment consults makes that class of drift unrepresentable. */
export const ATTACHMENT_ACCEPT = [
  ...PDF_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...TEXT_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ...OFFICE_EXTENSIONS,
  ...ACCEPT_MIMES,
].join(",");

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot === -1) return "";
  return fileName.slice(dot).toLowerCase();
}

// ---------------------------------------------------------------------------
// classifyAttachment
// ---------------------------------------------------------------------------

/**
 * Classify a file by MIME type (preferred) with filename-extension fallback.
 * Returns null when the file type is not supported for AI attachment.
 */
export function classifyAttachment(
  mimeType: string,
  fileName: string
): AttachmentKind | null {
  const mime = mimeType.trim().toLowerCase();

  // --- PDF ---
  if (mime === "application/pdf") return "pdf";

  // --- Image ---
  if (mime.startsWith("image/")) {
    return SUPPORTED_IMAGE_MIMES.has(mime) ? "image" : null;
  }

  // --- Text (read natively as UTF-8; Claude parses HTML/VTT without a lib) ---
  if (
    mime === "text/plain" ||
    mime === "text/markdown" ||
    mime === "text/csv" ||
    mime === "text/html" ||
    mime === "text/vtt"
  ) {
    return "text";
  }

  // --- Extension fallback (e.g. application/octet-stream) ---
  const ext = fileExtension(fileName);
  if (ext !== "" && PDF_EXTENSIONS.has(ext)) return "pdf";
  if (ext !== "" && IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext !== "" && TEXT_EXTENSIONS.has(ext)) return "text";
  if (ext !== "" && HTML_EXTENSIONS.has(ext)) return "text";

  // --- Office (OOXML: docx/xlsx/xlsm/pptx) — MIME or extension ---
  if (officeKindOf(mimeType, fileName)) return "office";

  return null;
}

// ---------------------------------------------------------------------------
// checkAttachmentSize
// ---------------------------------------------------------------------------

/**
 * Validate file size before reading.
 * Returns an error code when the file is too large, or null when OK.
 */
export function checkAttachmentSize(byteLength: number): AttachmentError | null {
  if (byteLength > MAX_ATTACHMENT_BYTES) return "too-large";
  return null;
}

// ---------------------------------------------------------------------------
// buildAttachmentBlock
// ---------------------------------------------------------------------------

/**
 * Build the Anthropic content block for the given attachment kind.
 * - pdf / image: `data` is base64 (no data: URI prefix).
 * - text: `data` is the decoded UTF-8 string.
 * All returned objects are new (immutable).
 */
export function buildAttachmentBlock(
  kind: AttachmentKind,
  mimeType: string,
  data: string
): AttachmentBlock {
  if (kind === "pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data },
    };
  }

  if (kind === "image") {
    const normalized =
      mimeType.toLowerCase() === "image/jpg" ? "image/jpeg" : mimeType.toLowerCase();
    return {
      type: "image",
      source: { type: "base64", media_type: normalized, data },
    };
  }

  if (kind === "office") {
    // `data` is already the extracted Markdown (produced by the file reader).
    return {
      type: "document",
      source: { type: "text", media_type: "text/plain", data },
    };
  }

  // kind === "text"
  return {
    type: "document",
    source: { type: "text", media_type: "text/plain", data },
  };
}
