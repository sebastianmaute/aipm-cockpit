// Pure form-draft ↔ RecurrenceRule converters for the meeting series editor
// (calendar-event-modal.tsx). Extracted so this pure domain logic — like
// every other piece of pure logic in this feature (date-range.ts,
// calendar-drag.ts, occurrence-lanes.ts, occurrence-drag.ts, recurrence.ts)
// — has its own module and its own exhaustive test file, reachable directly
// rather than only through DOM simulation of the form. Move-only: no
// behavior change from what shipped inside the modal.
//
// RecurrenceRule is a discriminated union whose `byDay` field means a
// DIFFERENT SHAPE per freq (Weekday[] for weekly; {ordinal,day} for
// monthly) — editing it piecemeal through the flat CalendarEvent draft would
// either fight the union's typing or silently drop a sub-form's values when
// the user switches freq and back. So recurrence sub-fields live in a
// SEPARATE flat superset bag (RecurrenceDraft) carrying every possible
// sub-field at once, regardless of which freq is active, and are only
// assembled into the real RecurrenceRule | undefined at submit time —
// the same "expand a single-field update() by hand for a field that can't
// be a flat patch" pattern absence-edit-modal.tsx uses for its start/end
// clamp, just at a larger scale.

import type { RecurrenceRule, Weekday } from "./calendar-event";

export type RepeatFreq = "none" | "daily" | "weekly" | "monthly";
export type MonthlyMode = "dom" | "nth";
export type EndsMode = "never" | "date" | "count";
export type Ordinal = 1 | 2 | 3 | 4 | -1;

export interface RecurrenceDraft {
  freq: RepeatFreq;
  interval: number;
  weeklyByDay: Weekday[];
  monthlyMode: MonthlyMode;
  monthlyDom: number;
  monthlyOrdinal: Ordinal;
  monthlyWeekday: Weekday;
  ends: EndsMode;
  until: string;
  count: number;
}

export const EMPTY_RECURRENCE_DRAFT: RecurrenceDraft = {
  freq: "none",
  interval: 1,
  weeklyByDay: [],
  monthlyMode: "dom",
  monthlyDom: 1,
  monthlyOrdinal: 1,
  monthlyWeekday: "MO",
  ends: "never",
  until: "",
  count: 1,
};

/** Populate the flat form-local draft from a persisted rule (or none). */
export function recurrenceDraftFrom(rule: RecurrenceRule | undefined): RecurrenceDraft {
  if (!rule) return EMPTY_RECURRENCE_DRAFT;
  const ends: EndsMode = rule.until ? "date" : rule.count !== undefined ? "count" : "never";
  const range = { ends, until: rule.until ?? "", count: rule.count ?? 1 };
  if (rule.freq === "daily") {
    return { ...EMPTY_RECURRENCE_DRAFT, freq: "daily", interval: rule.interval, ...range };
  }
  if (rule.freq === "weekly") {
    return {
      ...EMPTY_RECURRENCE_DRAFT,
      freq: "weekly",
      interval: rule.interval,
      weeklyByDay: rule.byDay ? [...rule.byDay] : [],
      ...range,
    };
  }
  // monthly
  if (rule.byDay) {
    return {
      ...EMPTY_RECURRENCE_DRAFT,
      freq: "monthly",
      interval: rule.interval,
      monthlyMode: "nth",
      monthlyOrdinal: rule.byDay.ordinal,
      monthlyWeekday: rule.byDay.day,
      ...range,
    };
  }
  return {
    ...EMPTY_RECURRENCE_DRAFT,
    freq: "monthly",
    interval: rule.interval,
    monthlyMode: "dom",
    monthlyDom: rule.byMonthDay ?? 1,
    ...range,
  };
}

/** Assemble the real discriminated-union rule from the flat form draft, or
 *  undefined for a non-recurring event. Only the fields the active freq
 *  actually uses are read — the rest of the bag is simply not consulted
 *  (nothing to strip; sanitizeCalendarEvent re-validates everything anyway). */
export function buildRecurrenceRule(d: RecurrenceDraft): RecurrenceRule | undefined {
  if (d.freq === "none") return undefined;
  const range = d.ends === "date" ? { until: d.until } : d.ends === "count" ? { count: d.count } : {};
  if (d.freq === "daily") return { freq: "daily", interval: d.interval, ...range };
  if (d.freq === "weekly") {
    return {
      freq: "weekly",
      interval: d.interval,
      ...(d.weeklyByDay.length ? { byDay: d.weeklyByDay } : {}),
      ...range,
    };
  }
  if (d.monthlyMode === "nth") {
    return {
      freq: "monthly",
      interval: d.interval,
      byDay: { ordinal: d.monthlyOrdinal, day: d.monthlyWeekday },
      ...range,
    };
  }
  return { freq: "monthly", interval: d.interval, byMonthDay: d.monthlyDom, ...range };
}
