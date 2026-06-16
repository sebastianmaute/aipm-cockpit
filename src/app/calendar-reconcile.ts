// src/app/calendar-reconcile.ts — pure milestone↔calendar reconcile (no Graph, no i18n).
import type { Milestone } from "./types";

export interface ExistingEvent { id: string; }

export interface ReconcilePlan {
  create: Milestone[];
  update: { milestone: Milestone; eventId: string }[];
  delete: string[];
}

export function planCalendarReconcile(
  milestones: readonly Milestone[],
  existing: readonly ExistingEvent[],
): ReconcilePlan {
  const keptIds = new Set<string>();
  const create: Milestone[] = [];
  const update: { milestone: Milestone; eventId: string }[] = [];
  for (const m of milestones) {
    // A stored event id is dup-proof to PATCH by id, so ALWAYS update when present.
    // (Updating an id absent from `existing` is safe; re-creating it would duplicate
    // the Outlook event if listProjectEvents transiently returns [] due to indexing lag.)
    if (m.outlookEventId) {
      update.push({ milestone: m, eventId: m.outlookEventId });
      keptIds.add(m.outlookEventId);
    } else {
      create.push(m);
    }
  }
  const del = existing.map((e) => e.id).filter((id) => !keptIds.has(id));
  return { create, update, delete: del };
}
