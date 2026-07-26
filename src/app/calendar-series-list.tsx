"use client";

// The all-series list: every stored CalendarEvent, reachable regardless of
// the currently-visible calendar window. The band only renders occurrences
// that fall inside that window — a series whose occurrences all fall outside
// it would otherwise be invisible and unreachable. A collapsed <details>
// under the grid; DataTable + EmptyState primitives only, no hand-rolled
// table (an explicit user decision on this component).
import { type Lang, t } from "./i18n";
import type { CalendarEvent, RecurrenceRule } from "./calendar-event";
import { nearestOccurrence } from "./recurrence";
import { DataTable } from "./data-table";
import { EmptyState } from "./empty-state";
import { Button } from "./button";

/** Compact, i18n'd recurrence summary for a list row — deliberately terser
 *  than export-sections.ts's `describeRecurrence` (which is English-only by
 *  the sibling document-export convention and spells out byDay/ordinal
 *  detail for an audit trail read once). This list's job is just letting the
 *  user tell series apart and reach one that's off-window; the exact rule
 *  mechanics are one click away via Edit, so frequency + interval is enough
 *  here. Reuses the calendar-event editor's OWN vocabulary (the
 *  calendarEventRepeat-, calendarEventInterval- and
 *  calendarEventIntervalUnit-prefixed keys) rather than inventing a
 *  parallel set of words for the same concepts —
 *  needs zero new i18n keys and reads identically to what the editor itself
 *  calls the same rule. */
function describeRecurs(rule: RecurrenceRule | undefined, lang: Lang): string {
  if (!rule) return t(lang, "calendarEventRepeatNever");
  if (rule.interval <= 1) {
    const key = rule.freq === "daily" ? "calendarEventRepeatDaily"
      : rule.freq === "weekly" ? "calendarEventRepeatWeekly" : "calendarEventRepeatMonthly";
    return t(lang, key);
  }
  const unitKey = rule.freq === "daily" ? "calendarEventIntervalUnitDaily"
    : rule.freq === "weekly" ? "calendarEventIntervalUnitWeekly" : "calendarEventIntervalUnitMonthly";
  return `${t(lang, "calendarEventInterval")} ${rule.interval} ${t(lang, unitKey)}`;
}

/** Next occurrence at-or-after `today`, formatted, or the localized "no
 *  further occurrences" fallback. Shares its window-search mechanics with
 *  export-sections.ts's `firstOccurrenceLabel` via recurrence.ts's
 *  `nearestOccurrence` — the two genuinely differ only in WHERE the search
 *  starts (an event's own startDate vs "today") and what to show when
 *  nothing resolves (an empty export cell vs a translated UI string), so
 *  only those two things stay separate; the shared mechanics live once, in
 *  recurrence.ts. */
function nextOccurrenceLabel(event: CalendarEvent, today: string, lang: Lang): string {
  const occ = nearestOccurrence(event, today);
  return occ ? `${occ.date} ${occ.time}` : t(lang, "calendarSeriesNoNext");
}

interface CalendarSeriesListProps {
  lang: Lang;
  events: readonly CalendarEvent[];
  /** Passed in, never read from a clock here (this renders — a react-hooks
   *  purity requirement — and must stay a deterministic function of props). */
  today: string;
  /** Omit to render a read-only mirror (e.g. a popout) with no edit affordance. */
  onEdit?: (event: CalendarEvent) => void;
}

export function CalendarSeriesList({ lang, events, today, onEdit }: CalendarSeriesListProps) {
  return (
    // Defaults OPEN (unlike the version-history `<details>` this pattern is
    // borrowed from): the whole point of this list is making an off-window
    // series reachable, so hiding it behind an extra click by default would
    // work against that. Still collapsible — a user who doesn't need it can
    // close it.
    <details open className="rounded-md border border-line">
      <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-foreground">
        {t(lang, "calendarMeetings")} ({events.length})
      </summary>
      <div className="p-2">
        {events.length === 0 ? (
          <EmptyState title={t(lang, "calendarSeriesEmptyTitle")} compact />
        ) : (
          <div className="overflow-auto rounded-md border border-line pr-2">
            <DataTable
              tbodyClassName="divide-y divide-line"
              head={
                <tr>
                  <th className="px-3 py-2 font-medium">{t(lang, "title")}</th>
                  <th className="px-3 py-2 font-medium">{t(lang, "calendarEventRepeat")}</th>
                  <th className="px-3 py-2 font-medium">{t(lang, "calendarSeriesColNext")}</th>
                  <th className="px-3 py-2 font-medium">{t(lang, "edit")}</th>
                </tr>
              }
            >
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 font-medium text-foreground">{e.title}</td>
                  <td className="px-3 py-2 text-muted-foreground">{describeRecurs(e.recurrence, lang)}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {nextOccurrenceLabel(e, today, lang)}
                  </td>
                  <td className="px-3 py-2">
                    {onEdit && (
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => onEdit(e)}
                        aria-label={`${t(lang, "edit")} – ${e.title}`}
                      >
                        {t(lang, "edit")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </div>
    </details>
  );
}
