"use client";

// Per-entity CRUD hook for recurring meetings (Resources → Calendar band +
// series editor). Extracted from use-resource-planner.ts (which had grown
// past the file-size ratchet) to mirror the useChangeLog/useStakeholders
// convention AGENTS.md documents for per-entity save/delete handlers — move
// only, no behavior change. Mirrors the editingAbsence block in
// use-resource-planner.ts in SHAPE (editing state + open/edit/close/save/
// delete), but — unlike handleSaveAbsence's plain id-existence check —
// routes create-vs-update through resolveEntitySave (the pattern
// handleSaveRaidItem, in use-resource-planner.ts, already uses): the modal
// mints its id at open time, and a concurrent writer could take that id
// before Save; resolveEntitySave re-mints on a genuine create rather than
// letting the id-existence check misread it as an update and clobber the
// concurrent row.
//
// Activity logging + undo capture are wired the same way useChangeLog does it:
// four OPTIONAL callback args in, captureFieldChanges + logActivityChanges out.
// The undo group (CALENDAR_EVENT_UNDO_GROUPS) deliberately binds startDate,
// recurrence and exceptions together — see its doc comment for the two
// sanitizer invariants that makes non-negotiable.
//
// The vanished-row guard useChangeLog carries (a toast when a concurrent
// writer deleted the row mid-edit) is deliberately NOT mirrored: it needs
// showToast + lang, which this hook does not take, and the silent map-replace
// no-op it guards is pre-existing behaviour, not something this wiring added.

import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useWorkspace } from "./workspace-context";
import { resolveEntitySave } from "./entity-id-mint";
import { mintId } from "./id-mint-session";
import { sanitizeCalendarEvent, type CalendarEvent } from "./calendar-event";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { captureFieldChanges } from "./undo/capture-field-changes";
import { CALENDAR_EVENT_UNDO_GROUPS } from "./undo/field-groups";
import type { UndoStackApi } from "./undo/use-undo-stack";

export interface UseCalendarEventsArgs {
  today: string;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  /** Capture a pre-op snapshot for undo (delete removes the row). */
  capture?: UndoStackApi["capture"];
  /** Capture per-field edits for undo (modal save). */
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
}

function emptyCalendarEventDraft(id: number, today: string): CalendarEvent {
  return {
    id,
    title: "",
    startDate: today,
    startTime: "09:00",
    durationMinutes: 60,
  };
}

export function useCalendarEvents(args: UseCalendarEventsArgs) {
  const { calendarEvents, setCalendarEvents } = useWorkspace();
  const { today } = args;

  const [editingCalendarEvent, setEditingCalendarEvent] = useState<{
    event: CalendarEvent;
    isNew: boolean;
  } | null>(null);

  // The undo stack's setter type is non-optional (`readonly T[]`), but the
  // workspace slice is `readonly CalendarEvent[] | undefined`. Adapt rather
  // than cast: an undo restoring an event necessarily happens against a list
  // that exists, and `?? []` is the same defaulting every handler here does.
  const setEventsForUndo = useCallback<Dispatch<SetStateAction<readonly CalendarEvent[]>>>(
    (action) => {
      setCalendarEvents((prev) =>
        typeof action === "function" ? action(prev ?? []) : action,
      );
    },
    [setCalendarEvents],
  );

  const handleOpenAddCalendarEvent = useCallback(() => {
    const nextId = mintId("calendarEvent", calendarEvents ?? []);
    const draft = emptyCalendarEventDraft(nextId, today);
    setEditingCalendarEvent({ event: draft, isNew: true });
  }, [calendarEvents, today]);

  const handleEditCalendarEvent = useCallback((event: CalendarEvent) => {
    setEditingCalendarEvent({ event, isNew: false });
  }, []);

  const handleCloseCalendarEventModal = useCallback(() => {
    setEditingCalendarEvent(null);
  }, []);

  const handleSaveCalendarEvent = useCallback(
    (next: CalendarEvent, isNew?: boolean) => {
      const events = calendarEvents ?? [];
      const { create, id } = resolveEntitySave(events, next.id, isNew, () => mintId("calendarEvent", events));
      const sanitized = sanitizeCalendarEvent({ ...next, id });
      if (!sanitized) return;
      // Read the before-image as a VALUE from the pre-update array, never from
      // inside the updater below — capture and the activity diff both need it,
      // and reading it in there would make them a side effect of a React state
      // computation.
      const previous = create ? undefined : events.find((e) => e.id === id);
      // Functional updater so N saves in one tick (e.g. a drag-reschedule
      // landing in the same tick as a modal save) compose instead of the
      // second clobbering the first — the same landmine that already bit
      // RAID/Changes/Stakeholders.
      setCalendarEvents((prev) => {
        const list = prev ?? [];
        return create ? [...list, sanitized] : list.map((e) => (e.id === id ? sanitized : e));
      });
      if (create) {
        args.logActivity?.("calendarEvent.created", id, sanitized.title);
      } else if (previous) {
        captureFieldChanges(args.captureFieldEdit, {
          setter: setEventsForUndo, kind: "calendarEvent.updated", id,
          prev: previous, next: sanitized, groups: CALENDAR_EVENT_UNDO_GROUPS,
          stampField: "localModifiedAt", name: sanitized.title,
        });
        if (args.logActivityChanges) {
          args.logActivityChanges("calendarEvent.updated", diffFields(previous, sanitized), id, sanitized.title);
        } else {
          // Back-compat: a caller wiring only logActivity still records it.
          args.logActivity?.("calendarEvent.updated", id, sanitized.title);
        }
      }
      setEditingCalendarEvent(null);
    },
    [calendarEvents, setCalendarEvents, setEventsForUndo, args],
  );

  const handleDeleteCalendarEvent = useCallback(
    (id: number) => {
      const events = calendarEvents ?? [];
      const doomed = events.find((e) => e.id === id);
      if (doomed) {
        args.capture?.({ setter: setEventsForUndo, kind: "calendarEvent.deleted", removed: [doomed], fromArray: events, name: doomed.title });
      }
      setCalendarEvents((prev) => (prev ?? []).filter((e) => e.id !== id));
      if (doomed) args.logActivity?.("calendarEvent.deleted", id, doomed.title);
      setEditingCalendarEvent(null);
    },
    [calendarEvents, setCalendarEvents, setEventsForUndo, args],
  );

  return {
    calendarEvents,
    editingCalendarEvent,
    handleOpenAddCalendarEvent,
    handleEditCalendarEvent,
    handleCloseCalendarEventModal,
    handleSaveCalendarEvent,
    handleDeleteCalendarEvent,
  };
}
