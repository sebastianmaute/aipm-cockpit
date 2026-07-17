// src/app/document-link.ts
//
// Shared model for a referenced knowledge link (a SharePoint document/folder, a
// Confluence page, or a general web URL) plus the lossless JSON-in-cell codec
// used by the CSV/Markdown/Turso serializers. The persisted field is still named
// `documentLinks` on every entity (byte-stable wire format); only the TS type was
// renamed to KnowledgeLink when the Documents view became Knowledge.
// Leaf module: imports nothing from the app so any entity type can depend on it.

/** What kind of knowledge a link points at. Absent ⇒ "document" — kept sparse so
 *  legacy (pre-Knowledge) links serialize byte-identically (golden-stable). */
export type KnowledgeLinkKind = "document" | "confluence" | "url";

export type KnowledgeLink = {
  /** Stable id: the Graph driveItem id, or a generated id for manual entries. */
  id: string;
  /** Display name (file or folder). */
  name: string;
  /** webUrl — opened in a new tab. */
  url: string;
  /** SharePoint item shape — files vs folders. Orthogonal to `linkKind`. */
  kind: "file" | "folder";
  /** Link type (document / Confluence page / plain URL). Absent ⇒ "document". */
  linkKind?: KnowledgeLinkKind;
  /** Graph addressing for future re-browse / re-resolution. */
  driveId?: string;
  itemId?: string;
  /** File icon / type hint (files only). */
  mimeType?: string;
  /** ISO timestamp when the link was added. */
  addedAt?: string;
};

/** The effective link kind of a (possibly legacy) link: absent ⇒ "document". */
export function linkKindOf(link: { linkKind?: KnowledgeLinkKind }): KnowledgeLinkKind {
  return link.linkKind ?? "document";
}

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

/** True only for http(s) URLs — blocks javascript:/data:/etc. in rendered hrefs. */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function isValidDocumentLink(v: unknown): v is { name: string; url: string } {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as Record<string, unknown>;
  return asTrimmedString(rec.name) !== "" && asTrimmedString(rec.url) !== "";
}

export function sanitizeDocumentLinks(raw: unknown): KnowledgeLink[] {
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeLink[] = [];
  for (const entry of raw) {
    if (!isValidDocumentLink(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const link: KnowledgeLink = {
      id: optionalString(rec.id) ?? nextGeneratedId(),
      name: asTrimmedString(rec.name),
      url: asTrimmedString(rec.url),
      kind: rec.kind === "folder" ? "folder" : "file",
    };
    // linkKind is emitted only for confluence/url so document links (the vast
    // majority, incl. every legacy link) stay byte-identical → golden-stable.
    if (rec.linkKind === "confluence" || rec.linkKind === "url") link.linkKind = rec.linkKind;
    const driveId = optionalString(rec.driveId);
    const itemId = optionalString(rec.itemId);
    const mimeType = optionalString(rec.mimeType);
    const addedAt = optionalString(rec.addedAt);
    if (driveId) link.driveId = driveId;
    if (itemId) link.itemId = itemId;
    if (mimeType) link.mimeType = mimeType;
    if (addedAt) link.addedAt = addedAt;
    if (!isSafeHttpUrl(link.url)) continue;
    out.push(link);
  }
  return out;
}

/** Encode for a single CSV/MD/Turso cell. Empty/undefined -> "" so entities
 *  with no links stay byte-identical to legacy serialized data. */
export function encodeDocumentLinks(links: readonly KnowledgeLink[] | undefined): string {
  return links && links.length ? JSON.stringify(links) : "";
}

/** Inverse of encodeDocumentLinks; tolerates empty/malformed cells. */
export function decodeDocumentLinks(cell: string | null | undefined): KnowledgeLink[] {
  if (!cell) return [];
  try {
    return sanitizeDocumentLinks(JSON.parse(cell));
  } catch {
    return [];
  }
}
