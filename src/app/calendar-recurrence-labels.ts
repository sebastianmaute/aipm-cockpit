// src/app/calendar-recurrence-labels.ts — the localized words for a recurrence
// rule, shared by the event editor, the all-series list and the document export.
//
// ★ One vocabulary, three surfaces. The editor's own labels (the
// calendarEventRepeat-, calendarEventInterval- and calendarEventOrdinal-
// prefixed keys, calendarEventMonthlyDayLabel, and the shiftDay weekday
// abbreviations) are the only words used, so an export reads exactly as the editor that wrote the rule (§621).
//
// ★★ This is NOT `calendar-recurrence-text.ts`. That module is i18n-free by
// contract and mirrors `sanitizeRecurrence` for the AI review card; this one
// only renders a rule that is already stored.
import { type Lang, t, type TranslationKey } from "./i18n";
import type { RecurrenceRule, Weekday } from "./calendar-event";
import type { Ordinal } from "./recurrence-draft";

export const WEEKDAY_LABEL_KEY: Record<Weekday, TranslationKey> = {
  MO: "shiftDayMon",
  TU: "shiftDayTue",
  WE: "shiftDayWed",
  TH: "shiftDayThu",
  FR: "shiftDayFri",
  SA: "shiftDaySat",
  SU: "shiftDaySun",
};

export const ORDINAL_LABEL_KEY: Record<Ordinal, TranslationKey> = {
  1: "calendarEventOrdinal1",
  2: "calendarEventOrdinal2",
  3: "calendarEventOrdinal3",
  4: "calendarEventOrdinal4",
  [-1]: "calendarEventOrdinalLast",
};

export const INTERVAL_UNIT_KEY: Record<RecurrenceRule["freq"], TranslationKey> = {
  daily: "calendarEventIntervalUnitDaily",
  weekly: "calendarEventIntervalUnitWeekly",
  monthly: "calendarEventIntervalUnitMonthly",
};

const REPEAT_KEY: Record<RecurrenceRule["freq"], TranslationKey> = {
  daily: "calendarEventRepeatDaily",
  weekly: "calendarEventRepeatWeekly",
  monthly: "calendarEventRepeatMonthly",
};

/** Frequency and interval only ("Weekly", "Every 2 week(s)"), or "Never" when
 *  there is no rule. The all-series list shows this; the full rule is one
 *  click away in the editor. */
export function recurrenceFrequencyText(rule: RecurrenceRule | undefined, lang: Lang): string {
  if (!rule) return t(lang, "calendarEventRepeatNever");
  if (rule.interval <= 1) return t(lang, REPEAT_KEY[rule.freq]);
  return `${t(lang, "calendarEventInterval")} ${rule.interval} ${t(lang, INTERVAL_UNIT_KEY[rule.freq])}`;
}

/** The frequency text plus which days, after " · ": the weekdays of a weekly
 *  rule ("Mon, Wed"), the nth weekday of a monthly one ("2nd Tue") or its day
 *  of the month ("Day 15"). A rule with no such detail gets the frequency text
 *  alone. The document export prints this. */
export function recurrenceSummaryText(rule: RecurrenceRule | undefined, lang: Lang): string {
  const base = recurrenceFrequencyText(rule, lang);
  const detail = rule ? recurrenceDetail(rule, lang) : "";
  return detail ? `${base} · ${detail}` : base;
}

function recurrenceDetail(rule: RecurrenceRule, lang: Lang): string {
  if (rule.freq === "weekly") {
    return (rule.byDay ?? []).map((d) => t(lang, WEEKDAY_LABEL_KEY[d])).join(", ");
  }
  if (rule.freq === "monthly") {
    if (rule.byDay) {
      return `${t(lang, ORDINAL_LABEL_KEY[rule.byDay.ordinal])} ${t(lang, WEEKDAY_LABEL_KEY[rule.byDay.day])}`;
    }
    if (rule.byMonthDay !== undefined) return `${t(lang, "calendarEventMonthlyDayLabel")} ${rule.byMonthDay}`;
  }
  return "";
}
