// Pure window math for the Resource Calendar. All arithmetic is UTC to match
// the rest of the calendar/resource-capacity code and avoid timezone drift.

export type CalendarMode = "month" | "week" | "custom";

/** Max span a window may cover, in days — guards against huge column counts. */
export const MAX_CALENDAR_SPAN_DAYS = 370;

export interface CalendarWindow {
  startDate: string; // ISO yyyy-mm-dd
  endDate: string;   // ISO yyyy-mm-dd, inclusive
}

const MS_PER_DAY = 86_400_000;

// Exported: shared with calendar-drag.ts, which resolves grid drag/resize
// gestures in the same UTC frame rather than re-deriving this parsing.
export function parseUtc(iso: string): Date | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.valueOf()) ? null : d;
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Exported: the single "date ± n days" step in the app. recurrence.ts uses it
// for rule stepping, and gantt-engine.ts re-exports it (rather than carrying
// the byte-identical copy it used to) so Gantt's own callers are unchanged.
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

/** First … last day of the anchor's month. */
export function monthWindow(anchorIso: string): CalendarWindow {
  const d = parseUtc(anchorIso);
  if (!d) return { startDate: anchorIso, endDate: anchorIso };
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    startDate: iso(new Date(Date.UTC(y, m, 1))),
    endDate: iso(new Date(Date.UTC(y, m + 1, 0))),
  };
}

/** Monday … Sunday of the anchor's week (ISO, Monday-start). */
export function weekWindow(anchorIso: string): CalendarWindow {
  const d = parseUtc(anchorIso);
  if (!d) return { startDate: anchorIso, endDate: anchorIso };
  const deltaToMonday = (d.getUTCDay() + 6) % 7;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - deltaToMonday);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { startDate: iso(start), endDate: iso(end) };
}

/** [from, to] normalized so start ≤ end and clamped to MAX_CALENDAR_SPAN_DAYS. */
export function customWindow(fromIso: string, toIso: string): CalendarWindow {
  const a = parseUtc(fromIso);
  const b = parseUtc(toIso);
  if (!a || !b) return { startDate: fromIso, endDate: toIso };
  let start = a;
  let end = b;
  if (start.valueOf() > end.valueOf()) [start, end] = [end, start];
  const span = Math.round((end.valueOf() - start.valueOf()) / MS_PER_DAY);
  if (span > MAX_CALENDAR_SPAN_DAYS) {
    end = addDays(start, MAX_CALENDAR_SPAN_DAYS);
  }
  return { startDate: iso(start), endDate: iso(end) };
}

/** Step an anchor by ±1 month or ±1 week (Prev/Next). */
export function stepAnchor(anchorIso: string, unit: "month" | "week", dir: -1 | 1): string {
  const d = parseUtc(anchorIso);
  if (!d) return anchorIso;
  if (unit === "week") {
    d.setUTCDate(d.getUTCDate() + dir * 7);
    return iso(d);
  }
  // Month: clamp the day to the target month's length so a month-end anchor
  // (e.g. Jan 31) doesn't overflow into the following month.
  const target = d.getUTCMonth() + dir;
  const year = d.getUTCFullYear() + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDay);
  return iso(new Date(Date.UTC(year, month, day)));
}

/** Resolve the active window from the current control state. */
export function resolveWindow(
  mode: CalendarMode,
  anchorIso: string,
  fromIso: string,
  toIso: string,
): CalendarWindow {
  if (mode === "week") return weekWindow(anchorIso);
  if (mode === "custom") return customWindow(fromIso, toIso);
  return monthWindow(anchorIso);
}
