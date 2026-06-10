// src/app/document-link.ts
//
// Shared model for a referenced SharePoint document (file or folder) plus the
// lossless JSON-in-cell codec used by the CSV/Markdown/Turso serializers.
// Leaf module: imports nothing from the app so any entity type can depend on it.

export type DocumentLink = {
  /** Stable id: the Graph driveItem id, or a generated id for manual entries. */
  id: string;
  /** Display name (file or folder). */
  name: string;
  /** webUrl — opened in a new tab. */
  url: string;
  kind: "file" | "folder";
  /** Graph addressing for future re-browse / re-resolution. */
  driveId?: string;
  itemId?: string;
  /** File icon / type hint (files only). */
  mimeType?: string;
  /** ISO timestamp when the link was added. */
  addedAt?: string;
};

function asTrimmedString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function optionalString(v: unknown): string | undefined {
  const s = asTrimmedString(v);
  return s === "" ? undefined : s;
}

/** Module-level monotonic counter for generated ids. Avoids Date.now()/
 *  Math.random() (deterministic) while staying unique across separate
 *  sanitize calls, so merging two sanitized arrays never collides. */
let _idSeq = 0;
function nextGeneratedId(): string {
  return `dl-${(_idSeq += 1)}`;
}

export function isValidDocumentLink(v: unknown): v is { name: string; url: string } {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as Record<string, unknown>;
  return asTrimmedString(rec.name) !== "" && asTrimmedString(rec.url) !== "";
}

export function sanitizeDocumentLinks(raw: unknown): DocumentLink[] {
  if (!Array.isArray(raw)) return [];
  const out: DocumentLink[] = [];
  for (const entry of raw) {
    if (!isValidDocumentLink(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const link: DocumentLink = {
      id: optionalString(rec.id) ?? nextGeneratedId(),
      name: asTrimmedString(rec.name),
      url: asTrimmedString(rec.url),
      kind: rec.kind === "folder" ? "folder" : "file",
    };
    const driveId = optionalString(rec.driveId);
    const itemId = optionalString(rec.itemId);
    const mimeType = optionalString(rec.mimeType);
    const addedAt = optionalString(rec.addedAt);
    if (driveId) link.driveId = driveId;
    if (itemId) link.itemId = itemId;
    if (mimeType) link.mimeType = mimeType;
    if (addedAt) link.addedAt = addedAt;
    out.push(link);
  }
  return out;
}

/** Encode for a single CSV/MD/Turso cell. Empty/undefined -> "" so entities
 *  with no links stay byte-identical to legacy serialized data. */
export function encodeDocumentLinks(links: readonly DocumentLink[] | undefined): string {
  return links && links.length ? JSON.stringify(links) : "";
}

/** Inverse of encodeDocumentLinks; tolerates empty/malformed cells. */
export function decodeDocumentLinks(cell: string | null | undefined): DocumentLink[] {
  if (!cell) return [];
  try {
    return sanitizeDocumentLinks(JSON.parse(cell));
  } catch {
    return [];
  }
}
