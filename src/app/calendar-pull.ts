// Pure, i18n-free engine: diff the app's pushed milestone dates against their
// current Outlook events and classify each into apply / conflict / deletion.
// App-wins: only auto-apply an Outlook move when the entity has NOT changed
// locally since the last sync (baseline). No baseline for a moved event => the
// safe default is a conflict, never a silent apply.

export interface PulledEvent {
  id: string;
  date: string | null; // all-day start as YYYY-MM-DD; null if missing/malformed
  endDate: string | null; // INCLUSIVE all-day end as YYYY-MM-DD (exclusive-end - 1 day); null if missing/malformed
  isCancelled: boolean;
}

export interface PullEntity {
  id: number;
  date: string; // current entity anchor date (or range start), YYYY-MM-DD
  endDate?: string; // present only for range entities (absences); inclusive range end
  outlookEventId?: string;
}

export interface PullPlan {
  applies: { id: number; eventId: string; newDate: string; newEndDate?: string }[];
  conflicts: { id: number; eventId: string; appDate: string; outlookDate: string; appEndDate?: string; outlookEndDate?: string }[];
  deletions: { id: number; eventId: string }[];
}

export function planCalendarPull(args: {
  entities: readonly PullEntity[];
  events: readonly PulledEvent[];
  baseline: Readonly<Record<string, string>>;
}): PullPlan {
  const { entities, events, baseline } = args;
  const byId = new Map(events.map((e) => [e.id, e]));
  const plan: PullPlan = { applies: [], conflicts: [], deletions: [] };
  for (const ent of entities) {
    const eventId = ent.outlookEventId;
    if (!eventId) continue;
    const ev = byId.get(eventId);
    if (!ev || ev.isCancelled) {
      // Definitive deletion: the event is gone or cancelled in Outlook.
      plan.deletions.push({ id: ent.id, eventId });
      continue;
    }
    if (ev.date === null || (ent.endDate !== undefined && ev.endDate === null)) {
      // Transient/unreadable read (present event, malformed date) — neither in-sync
      // nor a deletion; the next pull with a readable date reconciles it.
      continue;
    }
    const hasEnd = ent.endDate !== undefined;
    const startMatch = ev.date === ent.date;
    const endMatch = !hasEnd || ev.endDate === ent.endDate;
    if (startMatch && endMatch) continue; // in sync
    const entKey = hasEnd ? `${ent.date}|${ent.endDate}` : ent.date;
    if (baseline[eventId] === entKey) {
      plan.applies.push({ id: ent.id, eventId, newDate: ev.date, ...(hasEnd ? { newEndDate: ev.endDate! } : {}) });
    } else {
      plan.conflicts.push({
        id: ent.id,
        eventId,
        appDate: ent.date,
        outlookDate: ev.date,
        ...(hasEnd ? { appEndDate: ent.endDate, outlookEndDate: ev.endDate! } : {}),
      });
    }
  }
  return plan;
}
