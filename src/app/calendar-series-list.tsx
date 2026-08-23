"use client";

// The all-series list: every stored CalendarEvent, reachable regardless of
// the currently-visible calendar window. The band only renders occurrences
// that fall inside that window — a series whose occurrences all fall outside
// it would otherwise be invisible and unreachable. A collapsed <details>
// under the grid; DataTable + EmptyState primitives only, no hand-rolled
// table (an explicit user decision on this component).
import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import type { CalendarEvent, RecurrenceRule } from "./calendar-event";
import { nearestOccurrence } from "./recurrence";
import { DataTable } from "./data-table";
import { EmptyState } from "./empty-state";
import { Button } from "./button";
import { type SortDir, SortResizeTh, useSortHeaderProps, compareStrOrNum, nextSortDir } from "./report-table";

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

/** Next occurrence at-or-after `today`, formatted, or a localized fallback.
 *  Shares its window-search mechanics with export-sections.ts's
 *  `firstOccurrenceLabel` via recurrence.ts's `nearestOccurrence` — the two
 *  genuinely differ only in WHERE the search starts (an event's own
 *  startDate vs "today") and what to show when nothing resolves, so only
 *  that stays separate; the shared mechanics live once, in recurrence.ts.
 *
 *  Two DIFFERENT fallbacks, not one: a confirmed-empty search ("no further
 *  occurrences") is a fact; `truncated` means the search gave up (its
 *  iteration cap was reached, reachable for a series whose `startDate` is
 *  far in the past) before it could confirm that — collapsing both into one
 *  message would misrepresent "couldn't tell" as "definitely none". */
function nextOccurrenceInfo(
  event: CalendarEvent,
  today: string,
  lang: Lang,
): { label: string; sortValue: string | null } {
  const { occurrence, truncated } = nearestOccurrence(event, today);
  if (occurrence) {
    const stamp = `${occurrence.date} ${occurrence.time}`;
    // ISO date + 24h time, so lexical order IS chronological order — the
    // rendered label doubles as the comparable value with no reparsing.
    return { label: stamp, sortValue: stamp };
  }
  return {
    label: t(lang, truncated ? "calendarSeriesUnknownNext" : "calendarSeriesNoNext"),
    // ★ null, not a sentinel date. Both fallbacks mean "no comparable value
    // here" — one confirmed-empty, one couldn't-tell — and a sentinel that
    // sinks such a row ascending would float it to the TOP descending, which
    // is the one place it must never be. Held out of the comparison instead.
    sortValue: null,
  };
}

/** Only these two columns carry an order a user could act on. The recurrence
 *  column is a rendered phrase, not a scale (is "every 3 weeks" before or
 *  after "monthly"?), and the edit column holds a control — sorting either
 *  would be an affordance promising something meaningless. */
type SeriesSortKey = "title" | "next";

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
  // Starts "off" so the list opens in WORKSPACE order — the order the user's
  // own data is in, which no derived ordering can reconstruct once lost. The
  // asc -> desc -> off cycle makes it recoverable, matching every other
  // sortable table in the app.
  const [sort, setSort] = useState<{ key: SeriesSortKey; dir: SortDir }>({ key: "title", dir: "off" });

  // Decoration is memoized SEPARATELY from sorting: `nextOccurrenceInfo` runs a
  // real recurrence expansion per series (against its own iteration cap), and
  // folding it into the sort memo re-expanded every series on every header
  // click — work that cannot change unless the events, the day, or the language
  // do.
  const decorated = useMemo(
    () => events.map((e) => ({ event: e, next: nextOccurrenceInfo(e, today, lang) })),
    [events, today, lang],
  );

  const rows = useMemo(() => {
    if (sort.dir === "off") return decorated;
    // Unknown-next rows are appended in BOTH directions rather than sorted —
    // see nextOccurrenceInfo's sortValue comment for why a sentinel cannot do
    // this. Only the `next` column has an unknown state; `title` always has one.
    //
    // ★ This is the same rule `useSortableFilter`'s `isUnknown` encodes
    // (report-table.tsx), deliberately NOT reused: that hook requires
    // `Row extends { name: string }` and bakes in a text filter this list has
    // no field for. Two copies of a subtle rule can drift — if you touch either,
    // touch both.
    const known = sort.key === "next" ? decorated.filter((d) => d.next.sortValue !== null) : decorated;
    const unknown = sort.key === "next" ? decorated.filter((d) => d.next.sortValue === null) : [];
    const sorted = [...known].sort((a, b) => {
      const cmp = sort.key === "title"
        ? compareStrOrNum(a.event.title, b.event.title)
        : compareStrOrNum(a.next.sortValue ?? "", b.next.sortValue ?? "");
      return sort.dir === "desc" ? -cmp : cmp;
    });
    return [...sorted, ...unknown];
  }, [decorated, sort]);

  function onSort(key: SeriesSortKey) {
    setSort((prev) => (prev.key === key
      ? { key, dir: nextSortDir(prev.dir) }
      : { key, dir: "asc" }));
  }

  const th = useSortHeaderProps(sort.key, sort.dir, onSort);

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
                  {/* Sortable columns use the shared SortResizeTh with no
                      `onResize` — this list stores no column widths, and the
                      two remaining columns stay bare <th>s (AGENTS.md's rule
                      for header cells with nothing to sort). */}
                  <SortResizeTh
                    {...th}
                    label={t(lang, "title")}
                    sortCol="title"
                  />
                  <th className="px-3 py-2 font-medium">{t(lang, "calendarEventRepeat")}</th>
                  <SortResizeTh
                    {...th}
                    label={t(lang, "calendarSeriesColNext")}
                    sortCol="next"
                  />
                  <th className="px-3 py-2 font-medium">{t(lang, "edit")}</th>
                </tr>
              }
            >
              {rows.map(({ event: e, next }) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 font-medium text-foreground">{e.title}</td>
                  <td className="px-3 py-2 text-muted-foreground">{describeRecurs(e.recurrence, lang)}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{next.label}</td>
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
