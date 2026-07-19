// src/app/document-link.ts
//
// Shared model for a referenced knowledge link (a SharePoint document/folder, a
// Confluence page, or a general web URL) plus the lossless JSON-in-cell codec
// used by the CSV/Markdown/Turso serializers. The persisted field is named
// `knowledgeLinks` on every entity (renamed from the legacy `documentLinks`
// wire name when the Documents view became Knowledge; decoders still accept the
// old column/key as an alias — see the codecs + workspace load migration).
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

export function isValidKnowledgeLink(v: unknown): v is { name: string; url: string } {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as Record<string, unknown>;
  return asTrimmedString(rec.name) !== "" && asTrimmedString(rec.url) !== "";
}

export function sanitizeKnowledgeLinks(raw: unknown): KnowledgeLink[] {
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeLink[] = [];
  for (const entry of raw) {
    if (!isValidKnowledgeLink(entry)) continue;
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
export function encodeKnowledgeLinks(links: readonly KnowledgeLink[] | undefined): string {
  return links && links.length ? JSON.stringify(links) : "";
}

/** Inverse of encodeKnowledgeLinks; tolerates empty/malformed cells. */
export function decodeKnowledgeLinks(cell: string | null | undefined): KnowledgeLink[] {
  if (!cell) return [];
  try {
    return sanitizeKnowledgeLinks(JSON.parse(cell));
  } catch {
    return [];
  }
}

/** A STANDALONE knowledge item: a link that lives in the project's Knowledge
 *  library on its own (not attached to an entity), optionally cross-linked to
 *  one or more tasks as an explicit second step. Persisted as `Workspace
 *  .knowledgeItems` across all six storage paths AND included in exports. */
export type KnowledgeItem = KnowledgeLink & {
  /** Ids of tasks this item is linked to. Omitted/empty ⇒ unlinked. */
  taskIds?: number[];
};

/** Max task links per knowledge item / max standalone items — bounds the work a
 *  hostile or corrupt import can force (the dedup + validation loops). */
const MAX_TASK_LINKS = 200;
const MAX_KNOWLEDGE_ITEMS = 1000;

/** Positive-integer task ids, deduped (Set) and capped; drops non-numeric/≤ 0. */
function sanitizeTaskIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const v of raw) {
    if (seen.size >= MAX_TASK_LINKS) break;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isInteger(n) && n > 0) seen.add(n);
  }
  return [...seen];
}

/** Validate an array of standalone knowledge items: each link is run through
 *  `sanitizeKnowledgeLinks` (safe-http-url gate, kind normalization, id fill)
 *  and its `taskIds` are coerced to a deduped positive-int list. `taskIds` is
 *  emitted only when non-empty, so an unlinked item stays byte-minimal. */
export function sanitizeKnowledgeItems(raw: unknown): KnowledgeItem[] {
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeItem[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_KNOWLEDGE_ITEMS) break;
    const [link] = sanitizeKnowledgeLinks([entry]);
    if (!link) continue;
    const taskIds = sanitizeTaskIds(
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>).taskIds
        : undefined,
    );
    out.push(taskIds.length ? { ...link, taskIds } : link);
  }
  return out;
}

/** Encode the standalone-items list for a single CSV/MD/Turso cell (empty ⇒ ""
 *  so a project with no standalone items stays byte-identical to legacy data). */
export function encodeKnowledgeItems(items: readonly KnowledgeItem[] | undefined): string {
  return items && items.length ? JSON.stringify(items) : "";
}

/** Inverse of encodeKnowledgeItems; tolerates empty/malformed cells. */
export function decodeKnowledgeItems(cell: string | null | undefined): KnowledgeItem[] {
  if (!cell) return [];
  try {
    return sanitizeKnowledgeItems(JSON.parse(cell));
  } catch {
    return [];
  }
}
