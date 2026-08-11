"use client";

// src/app/document-links-section.tsx — the Documents pane's link surface.
//
// Thin wiring around `DocumentLinksField`: it owns the read-only decision and
// the mutation shape, so the pane body carries one element instead of a dozen
// lines of props. Split out to keep `documents-panel.tsx` under the 800-line
// ratchet, which it sits close to.

import { DocumentLinksField } from "./document-links-field";
import { VIEW_BY_KIND } from "./document-link-sources";
import type { DocEntityRef, DocRefKind, DocRefLookups } from "./document-ref";
import type { DocLinkCandidate } from "./document-links-field";
import type { ProjectDocument } from "./document-model";
import type { AppView } from "./nav-config";
import type { Lang } from "./i18n";

interface DocumentLinksSectionProps {
  lang: Lang;
  /** The document the pane is showing. `null` renders nothing. */
  doc: ProjectDocument | null;
  lookups: DocRefLookups;
  candidates: readonly DocLinkCandidate[];
  isReadOnly?: boolean;
  onLink: (docId: number, ref: DocEntityRef) => void;
  onUnlink: (docId: number, ref: Pick<DocEntityRef, "kind" | "id">) => void;
  onOpenView: (view: AppView, id: number) => void;
}

export function DocumentLinksSection({
  lang,
  doc,
  lookups,
  candidates,
  isReadOnly,
  onLink,
  onUnlink,
  onOpenView,
}: DocumentLinksSectionProps) {
  // ★★ HIDDEN when read-only, not rendered inert: the field has no disabled
  // mode and a no-op handler is the false affordance this repo bans. Accepted
  // cost — a popout mirror shows no link chips either, not just no picker.
  if (!doc || isReadOnly) return null;
  return (
    <DocumentLinksField
      lang={lang}
      refs={doc.linkedEntities ?? []}
      lookups={lookups}
      candidates={candidates}
      onLink={(ref) => onLink(doc.id, ref)}
      onUnlink={(ref) => onUnlink(doc.id, ref)}
      onOpenEntity={(kind: DocRefKind, id: number) => onOpenView(VIEW_BY_KIND[kind], id)}
    />
  );
}
