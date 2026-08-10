// src/app/use-document-entity-filter.ts — "show only the documents linked to
// THIS entity", the state behind the Documents pane's entity-filter banner.
//
// Extracted from `documents-panel.tsx` as one cohesive concern: the pane sits
// against the 800-line ratchet, and the request/reconcile/filter trio is the
// part of it that stands alone.

import { useMemo, useState } from "react";
import { indexDocumentsByEntity, refKey, type DocEntityRef, type DocRefKind } from "./document-ref";

export type DocEntityFilter = { kind: DocRefKind; id: number } | null;

export interface DocumentEntityFilterResult<T> {
  /** The filter currently APPLIED, as opposed to the one being requested. */
  entityFilter: DocEntityFilter;
  /** `rows`, narrowed to the documents referencing the filtered entity. */
  visibleRows: readonly T[];
  /** Drop the filter. The caller must ALSO consume the parent's request, or
   *  navigating away and back re-applies it. */
  clearEntityFilter: () => void;
}

/**
 * `pending` is armed elsewhere (`requestDocumentsForEntity`) and is therefore
 * already present in this pane's FIRST render.
 *
 * ★★★ SENTINEL SEED. `handled` starts `undefined` — "nothing handled yet" —
 * which is NOT the same as `null` ("handled, and it was empty"). Seeding it
 * from the LIVE value is the remount-swallow trap: the modern shell renders
 * only the active view, so arrival IS a fresh mount and a live seed reads the
 * pending request as already consumed. Reconciled at RENDER TIME, never in an
 * effect — `react-hooks/set-state-in-effect` is fatal here.
 */
export function useDocumentEntityFilter<
  T extends { id: number; readonly linkedEntities?: readonly DocEntityRef[] },
>(
  documents: readonly T[],
  rows: readonly T[],
  pending: DocEntityFilter,
): DocumentEntityFilterResult<T> {
  const [entityFilter, setEntityFilter] = useState<DocEntityFilter>(null);
  const [handled, setHandled] = useState<DocEntityFilter | undefined>(undefined);
  if (handled !== pending) {
    setHandled(pending);
    if (pending) setEntityFilter(pending);
  }

  const entityIndex = useMemo(() => indexDocumentsByEntity(documents), [documents]);
  // Filters the SORTED rows, so dismissing restores the order rather than
  // rebuilding it.
  const visibleRows = useMemo(() => {
    if (!entityFilter) return rows;
    const allowed = new Set((entityIndex.get(refKey(entityFilter.kind, entityFilter.id)) ?? []).map((d) => d.id));
    return rows.filter((d) => allowed.has(d.id));
  }, [rows, entityFilter, entityIndex]);

  return { entityFilter, visibleRows, clearEntityFilter: () => setEntityFilter(null) };
}
