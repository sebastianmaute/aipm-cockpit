// src/app/document-ref.ts
//
// A document's reference to a project entity. LEAF MODULE — imports nothing
// from the app, on purpose:
//
//  * `document-model.ts` sits in a value-import cycle (settings-types ⇄
//    workspace ⇄ document-model, open-followups §92). Keeping this module
//    dependency-free keeps the new type out of it.
//  * the entity-side attach door (a follow-up) will want this type from the
//    task/RAID/change/milestone editors, which must not import document-model.
//
// The cap lives HERE and document-model imports it, never the other way round.

/** The four entity kinds a document may reference. */
export type DocRefKind = "task" | "milestone" | "raid" | "change";

const KINDS: readonly DocRefKind[] = ["task", "milestone", "raid", "change"];

export type DocEntityRef = {
  kind: DocRefKind;
  id: number;
  /** ★★★ TOMBSTONE ONLY — the display source when `id` no longer resolves.
   *  Read it while the target LIVES and a rename silently desyncs every chip
   *  and badge (the stale-name-cache class `effectivePersonEmail` exists to
   *  prevent). `resolveDocRef` is the only reader; go through it. */
  label?: string;
};

export const MAX_LINKS_PER_DOC = 50;
const MAX_LABEL_CHARS = 200;

/** Map key for a (kind, id) pair — ids collide ACROSS kinds, so no numeric key. */
export function refKey(kind: DocRefKind, id: number): string {
  return `${kind}:${id}`;
}

function isKind(v: unknown): v is DocRefKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

/** Structural validator. Shape, bounds and dedupe only — no DOM, no i18n. */
export function sanitizeDocEntityRefs(raw: unknown): DocEntityRef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DocEntityRef[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_LINKS_PER_DOC) break;
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (!isKind(e.kind)) continue;
    const id = Math.floor(Number(e.id));
    if (!Number.isFinite(id) || id <= 0) continue;
    const key = refKey(e.kind, id);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = typeof e.label === "string" ? e.label.slice(0, MAX_LABEL_CHARS).trim() : "";
    // Sparse on purpose: an absent label must stay absent so an unlinked or
    // label-less document serializes byte-identically (golden stability).
    out.push(label ? { kind: e.kind, id, label } : { kind: e.kind, id });
  }
  return out;
}

/** Live titles by kind. A plain bag of Maps, not a Workspace — keeps this
 *  module leaf and keeps the resolver testable without a workspace fixture. */
export type DocRefLookups = Record<DocRefKind, ReadonlyMap<number, string>>;

/** THE single reader of `label`. Live title on a hit; the tombstone on a miss. */
export function resolveDocRef(
  ref: DocEntityRef,
  lookups: DocRefLookups,
): { title: string; dangling: boolean } {
  const live = lookups[ref.kind]?.get(ref.id);
  if (live !== undefined) return { title: live, dangling: false };
  return { title: ref.label ?? "", dangling: true };
}

/** Reverse index: (kind, id) → the documents referencing it, in document order. */
export function indexDocumentsByEntity<T extends { readonly linkedEntities?: readonly DocEntityRef[] }>(
  documents: readonly T[],
): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const doc of documents) {
    for (const ref of doc.linkedEntities ?? []) {
      const key = refKey(ref.kind, ref.id);
      const bucket = index.get(key);
      if (bucket) bucket.push(doc);
      else index.set(key, [doc]);
    }
  }
  return index;
}
