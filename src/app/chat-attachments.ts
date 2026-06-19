// src/app/chat-attachments.ts — pure, i18n-free module for AI-Assistant document ingestion.
// Classifies uploaded files and builds Anthropic Messages API content blocks.
// Caller is responsible for reading file bytes; this module is synchronous.

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

export type AttachmentKind = "pdf" | "image" | "text";
export type AttachmentError = "unsupported-type" | "too-large";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SUPPORTED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const PDF_EXTENSIONS = new Set([".pdf"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv"]);

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

  // --- Text ---
  if (
    mime === "text/plain" ||
    mime === "text/markdown" ||
    mime === "text/csv"
  ) {
    return "text";
  }

  // --- Extension fallback (e.g. application/octet-stream) ---
  const ext = fileExtension(fileName);
  if (ext !== "" && PDF_EXTENSIONS.has(ext)) return "pdf";
  if (ext !== "" && IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext !== "" && TEXT_EXTENSIONS.has(ext)) return "text";

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

  // kind === "text"
  return {
    type: "document",
    source: { type: "text", media_type: "text/plain", data },
  };
}
