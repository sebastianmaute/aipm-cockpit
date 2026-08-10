"use client";

// src/app/document-links-field.tsx — the Documents pane's attach control.
//
// The ONE door that creates a document→entity reference (the entity-side door
// is a recorded follow-up, deliberately not built here). Built on the shared
// EntityLinkPicker rather than hand-rolled markup — a standing rule in this
// repo (raid-edit-fields' causedBy field and task-form-fields' dependency
// editor already do the same).

import { useMemo, useState } from "react";
import { EntityLinkPicker, type LinkPickerEntry } from "./entity-link-picker";
import { refKey, resolveDocRef, type DocEntityRef, type DocRefKind, type DocRefLookups } from "./document-ref";
import { type Lang, t } from "./i18n";

/** A linkable entity, flattened by the caller. */
export interface DocLinkCandidate {
  kind: DocRefKind;
  id: number;
  title: string;
}

/** Short prefix per kind — also what makes each chip's remove button
 *  row-UNIQUE (WCAG 2.4.6), since ids collide across kinds. */
const CODE_PREFIX: Record<DocRefKind, string> = { task: "#", milestone: "M#", raid: "R#", change: "C#" };
const codeOf = (kind: DocRefKind, id: number): string => `${CODE_PREFIX[kind]}${id}`;

interface DocumentLinksFieldProps {
  lang: Lang;
  refs: readonly DocEntityRef[];
  lookups: DocRefLookups;
  candidates: readonly DocLinkCandidate[];
  onLink: (ref: DocEntityRef) => void;
  onUnlink: (ref: Pick<DocEntityRef, "kind" | "id">) => void;
  onOpenEntity: (kind: DocRefKind, id: number) => void;
}

export function DocumentLinksField({ lang, refs, lookups, candidates, onLink, onUnlink, onOpenEntity }: DocumentLinksFieldProps) {
  const [query, setQuery] = useState("");

  // Resolve ONCE: the chips, the dangling markers and the click-through all
  // read the same resolution, so they cannot disagree.
  const resolved = useMemo(
    () => refs.map((ref) => ({ ref, ...resolveDocRef(ref, lookups) })),
    [refs, lookups],
  );

  const selected: LinkPickerEntry[] = resolved.map(({ ref, title }) => ({
    key: refKey(ref.kind, ref.id),
    id: ref.id,
    code: codeOf(ref.kind, ref.id),
    // A dangling ref with no stored label has nothing to show but its code.
    label: title || codeOf(ref.kind, ref.id),
  }));

  const options: LinkPickerEntry[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const linked = new Set(refs.map((r) => refKey(r.kind, r.id)));
    return candidates
      .filter((c) => !linked.has(refKey(c.kind, c.id)))
      .filter((c) => c.title.toLowerCase().includes(q) || codeOf(c.kind, c.id).toLowerCase().includes(q))
      .map((c) => ({ key: refKey(c.kind, c.id), id: c.id, code: codeOf(c.kind, c.id), label: c.title }));
  }, [candidates, refs, query]);

  // The key carries the kind; `id` alone is ambiguous across kinds.
  const kindOf = (entry: LinkPickerEntry): DocRefKind => (entry.key ?? "").split(":")[0] as DocRefKind;

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{t(lang, "documentsLinkedEntities")}</div>
      <EntityLinkPicker
        selected={selected}
        options={options}
        query={query}
        onQueryChange={setQuery}
        onAdd={(entry) => {
          // ★ The tombstone label is captured HERE, at attach time — it is what
          // a chip falls back to once the entity is deleted. It is NEVER read
          // while the entity lives; resolveDocRef enforces that.
          onLink({ kind: kindOf(entry), id: entry.id, label: entry.label });
          setQuery("");
        }}
        onRemove={(entry) => onUnlink({ kind: kindOf(entry), id: entry.id })}
        onOpen={(entry) => onOpenEntity(kindOf(entry), entry.id)}
        searchLabel={t(lang, "documentsLinkedSearch")}
        placeholder={t(lang, "documentsLinkedPlaceholder")}
        removeLabel={t(lang, "documentsLinkedRemove")}
        clearLabel={t(lang, "documentsLinkedClear")}
      />
      {/* ★★ Non-colour dangling cue (WCAG 1.4.1): the chip is styled the same
          either way, so the GLYPH carries the state, not a tint.
          ★★ The state must also be programmatically determinable (1.3.1), and a
          `title` on a static span does NOT do that — it is hover-only, has no
          keyboard path and is not reliably exposed on a non-interactive
          element. The ResourcePicker precedent this mirrors puts the state in
          the accessible DESCRIPTION of a BUTTON, which is exposed; this is not
          a button. So the marker names itself, and the reference it refers to,
          via `role="img"`. */}
      <div className="mt-1 flex flex-wrap gap-2">
        {resolved
          .filter((r) => r.dangling)
          .map(({ ref }) => (
            <span
              key={refKey(ref.kind, ref.id)}
              data-dangling-marker
              role="img"
              aria-label={`${codeOf(ref.kind, ref.id)} – ${t(lang, "documentsLinkedDangling")}`}
              title={t(lang, "documentsLinkedDangling")}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            >
              <span aria-hidden="true">⚠</span>
              {codeOf(ref.kind, ref.id)}
            </span>
          ))}
      </div>
    </div>
  );
}
