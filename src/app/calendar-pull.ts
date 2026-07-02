// Pure, i18n-free engine: diff the app's pushed milestone dates against their
// current Outlook events and classify each into apply / conflict / deletion.
// App-wins: only auto-apply an Outlook move when the entity has NOT changed
// locally since the last sync (baseline). No baseline for a moved event => the
// safe default is a conflict, never a silent apply.

export interface PulledEvent {
  id: string;
  date: string | null; // all-day start as YYYY-MM-DD; null if missing/malformed
  isCancelled: boolean;
}

export interface PullEntity {
  id: number;
  date: string; // current entity anchor date, YYYY-MM-DD
  outlookEventId?: string;
}

export interface PullPlan {
  applies: { id: number; eventId: string; newDate: string }[];
  conflicts: { id: number; eventId: string; appDate: string; outlookDate: string }[];
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
    if (!ev || ev.isCancelled || ev.date === null) {
      plan.deletions.push({ id: ent.id, eventId });
      continue;
    }
    if (ev.date === ent.date) continue; // in sync
    if (baseline[eventId] === ent.date) {
      plan.applies.push({ id: ent.id, eventId, newDate: ev.date });
    } else {
      plan.conflicts.push({ id: ent.id, eventId, appDate: ent.date, outlookDate: ev.date });
    }
  }
  return plan;
}
