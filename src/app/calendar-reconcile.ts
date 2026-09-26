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
    // §486 — the user opted this item out (by pruning its event, or by
    // unticking "Sync to Outlook"). Never create or update it; a still-linked
    // event is KEPT (not deleted) — the app never deletes an event the user
    // chose to leave in Outlook.
    if (m.calendarOptOut === true) {
      if (m.outlookEventId) keptIds.add(m.outlookEventId);
      continue;
    }
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

export interface HasEventLink { id: number; outlookEventId?: string; calendarOptOut?: boolean; }

export interface GenericReconcilePlan<T> {
  create: T[];
  update: { item: T; eventId: string }[];
  delete: string[];
}

// Generic form of planCalendarReconcile: reconciles ANY entity carrying an
// outlookEventId (tasks, RAID, changes, absences) with the SAME logic — present
// id → update + keep, absent → create, any unkept existing id → delete.
// An opted-out item (§486) is skipped, but its linked id is still kept.
export function planEntityReconcile<T extends HasEventLink>(
  items: readonly T[],
  existing: readonly ExistingEvent[],
): GenericReconcilePlan<T> {
  const keptIds = new Set<string>();
  const create: T[] = [];
  const update: { item: T; eventId: string }[] = [];
  for (const it of items) {
    // §486 — the user opted this item out (by pruning its event, or by
    // unticking "Sync to Outlook"). Never create or update it; a still-linked
    // event is KEPT (not deleted) — the app never deletes an event the user
    // chose to leave in Outlook.
    if (it.calendarOptOut === true) {
      if (it.outlookEventId) keptIds.add(it.outlookEventId);
      continue;
    }
    if (it.outlookEventId) {
      update.push({ item: it, eventId: it.outlookEventId });
      keptIds.add(it.outlookEventId);
    } else {
      create.push(it);
    }
  }
  const del = existing.map((e) => e.id).filter((id) => !keptIds.has(id));
  return { create, update, delete: del };
}
