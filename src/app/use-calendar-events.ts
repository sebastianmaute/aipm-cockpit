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
// concurrent row. No undo-capture/activity-log wiring yet — no
// CALENDAR_EVENT_UNDO_GROUPS or ActivityKind entries exist for this entity,
// and adding either wasn't asked for; that's a deliberate follow-up, not an
// oversight.

import { useCallback, useState } from "react";
import { useWorkspace } from "./workspace-context";
import { resolveEntitySave } from "./entity-id-mint";
import { mintId } from "./id-mint-session";
import { sanitizeCalendarEvent, type CalendarEvent } from "./calendar-event";

export interface UseCalendarEventsArgs {
  today: string;
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
      // Functional updater so N saves in one tick (e.g. a drag-reschedule
      // landing in the same tick as a modal save) compose instead of the
      // second clobbering the first — the same landmine that already bit
      // RAID/Changes/Stakeholders.
      setCalendarEvents((prev) => {
        const list = prev ?? [];
        return create ? [...list, sanitized] : list.map((e) => (e.id === id ? sanitized : e));
      });
      setEditingCalendarEvent(null);
    },
    [calendarEvents, setCalendarEvents],
  );

  const handleDeleteCalendarEvent = useCallback(
    (id: number) => {
      // No captureRef undo here (unlike handleDeleteAbsence/handleDeleteRaidItem):
      // capture()'s `kind` is typed ActivityKind, a closed union with no
      // calendarEvent.* entry — see the block comment above.
      setCalendarEvents((prev) => (prev ?? []).filter((e) => e.id !== id));
      setEditingCalendarEvent(null);
    },
    [setCalendarEvents],
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
