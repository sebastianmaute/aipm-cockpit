// CalendarEvent — a timed meeting on the resource calendar, optionally
// recurring. Pure, i18n-free, clock-free.
//
// The sanitizer NEVER throws: every load path (JSON import, CSV/MD decode,
// Turso row, IndexedDB) runs untrusted data through it and expects null for an
// unrecoverable record rather than an exception.

import { sanitizeMultiline, sanitizeText, toNumber } from "./sanitize";

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type RecurrenceRule =
  | { freq: "daily"; interval: number; until?: string; count?: number }
  | { freq: "weekly"; interval: number; byDay?: Weekday[]; until?: string; count?: number }
  | { freq: "monthly"; interval: number; byMonthDay?: number;
      byDay?: { ordinal: 1 | 2 | 3 | 4 | -1; day: Weekday }; until?: string; count?: number };

export type EventException =
  | { date: string; kind: "skip" }
  | { date: string; kind: "move"; toDate: string; toTime?: string };

export interface CalendarEvent {
  id: number;
  title: string;
  startDate: string;
  startTime: string;
  durationMinutes: number;
  location?: string;
  notes?: string;
  recurrence?: RecurrenceRule;
  exceptions?: EventException[];
  attendeeResourceIds?: number[];
  sendInvitations?: boolean;
  localModifiedAt?: string;
  outlookEventId?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const TITLE_MAX = 200;
const LOCATION_MAX = 200;
const MAX_EXCEPTIONS = 500;
const MAX_ATTENDEES = 100;
const DEFAULT_TIME = "09:00";
const DEFAULT_DURATION = 60;

function isoDateOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
    ? v : undefined;
}

function intInRange(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = toNumber(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
}

function weekdayOrUndefined(v: unknown): Weekday | undefined {
  return typeof v === "string" && (WEEKDAYS as readonly string[]).includes(v) ? (v as Weekday) : undefined;
}

function sanitizeRecurrence(raw: unknown, startDate: string): RecurrenceRule | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const interval = intInRange(r.interval, 1, 52, 1);

  // At most ONE range terminator survives. Both present is ambiguous, and
  // `until` is the one a user can verify by reading it.
  const until = isoDateOrUndefined(r.until);
  const validUntil = until && until >= startDate ? until : undefined;
  const count = validUntil ? undefined : (() => {
    const n = toNumber(r.count);
    return Number.isInteger(n) && n >= 1 && n <= 500 ? n : undefined;
  })();
  const range = { ...(validUntil ? { until: validUntil } : {}), ...(count ? { count } : {}) };

  if (r.freq === "daily") return { freq: "daily", interval, ...range };

  if (r.freq === "weekly") {
    const days = Array.isArray(r.byDay)
      ? WEEKDAYS.filter((d) => (r.byDay as unknown[]).some((x) => weekdayOrUndefined(x) === d))
      : [];
    return { freq: "weekly", interval, ...(days.length ? { byDay: [...days] } : {}), ...range };
  }

  if (r.freq === "monthly") {
    const nth = r.byDay && typeof r.byDay === "object" ? (r.byDay as Record<string, unknown>) : null;
    const day = nth ? weekdayOrUndefined(nth.day) : undefined;
    const ordinalRaw = nth ? toNumber(nth.ordinal) : NaN;
    const ordinal = [1, 2, 3, 4, -1].includes(ordinalRaw) ? (ordinalRaw as 1 | 2 | 3 | 4 | -1) : undefined;
    // byDay wins over byMonthDay: the two express different intents and keeping
    // both would leave the expansion engine choosing silently.
    if (day && ordinal) return { freq: "monthly", interval, byDay: { ordinal, day }, ...range };
    const fallbackDom = Number(startDate.slice(8, 10));
    return { freq: "monthly", interval, byMonthDay: intInRange(r.byMonthDay, 1, 31, fallbackDom), ...range };
  }

  return undefined;
}

function sanitizeExceptions(raw: unknown): EventException[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const byDate = new Map<string, EventException>();
  for (const item of raw.slice(0, MAX_EXCEPTIONS)) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const date = isoDateOrUndefined(e.date);
    if (!date) continue;
    if (e.kind === "move") {
      const toDate = isoDateOrUndefined(e.toDate);
      // A move whose target is unusable degrades to a skip, never to nothing:
      // an occurrence the user moved must not reappear on its original date.
      if (!toDate) { byDate.set(date, { date, kind: "skip" }); continue; }
      const toTime = typeof e.toTime === "string" && HHMM.test(e.toTime) ? e.toTime : undefined;
      byDate.set(date, { date, kind: "move", toDate, ...(toTime ? { toTime } : {}) });
    } else {
      byDate.set(date, { date, kind: "skip" });
    }
  }
  if (byDate.size === 0) return undefined;
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function sanitizeAttendees(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<number>();
  for (const v of raw) {
    const n = toNumber(v);
    // Dangling ids (resource since deleted) are KEPT — same stance as every
    // other FK in the app; the UI renders them unresolved rather than lying
    // about who was invited.
    if (Number.isInteger(n) && n > 0) seen.add(n);
    if (seen.size >= MAX_ATTENDEES) break;
  }
  return seen.size ? [...seen] : undefined;
}

export function sanitizeCalendarEvent(input: unknown): CalendarEvent | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const id = toNumber(raw.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const title = sanitizeText(raw.title, TITLE_MAX);
  if (!title) return null;

  const startDate = isoDateOrUndefined(raw.startDate);
  if (!startDate) return null;

  const startTime = typeof raw.startTime === "string" && HHMM.test(raw.startTime)
    ? raw.startTime : DEFAULT_TIME;

  return {
    id,
    title,
    startDate,
    startTime,
    durationMinutes: intInRange(raw.durationMinutes, 5, 1440, DEFAULT_DURATION),
    location: sanitizeText(raw.location, LOCATION_MAX) || undefined,
    notes: sanitizeMultiline(raw.notes, 2000) || undefined,
    recurrence: sanitizeRecurrence(raw.recurrence, startDate),
    exceptions: sanitizeExceptions(raw.exceptions),
    attendeeResourceIds: sanitizeAttendees(raw.attendeeResourceIds),
    sendInvitations: raw.sendInvitations === true ? true : undefined,
    localModifiedAt: sanitizeText(raw.localModifiedAt, 1024) || undefined,
    outlookEventId: sanitizeText(raw.outlookEventId, 1024) || undefined,
  };
}

// --- JSON-in-cell codecs -----------------------------------------------
// An absent value encodes to "" and decodes back to undefined, so a plain
// non-recurring event carries no JSON in its row.
//
// ★ UNLIKE note-log's decoders, these deliberately do NOT self-validate:
// sanitizeRecurrence needs `startDate` for cross-field checks (until >= start)
// that a decoder has no access to. A decoded cell is therefore UNTRUSTED —
// whoever assembles a CalendarEvent from decoded cells MUST run the whole
// object back through sanitizeCalendarEvent() before using it.

export function encodeRecurrence(rule: RecurrenceRule | undefined): string {
  return rule ? JSON.stringify(rule) : "";
}

export function decodeRecurrence(cell: string): RecurrenceRule | undefined {
  if (!cell.trim()) return undefined;
  try {
    const parsed = JSON.parse(cell) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as RecurrenceRule) : undefined;
  } catch { return undefined; }
}

export function encodeExceptions(list: readonly EventException[] | undefined): string {
  return list && list.length ? JSON.stringify(list) : "";
}

export function decodeExceptions(cell: string): EventException[] | undefined {
  if (!cell.trim()) return undefined;
  try {
    const parsed = JSON.parse(cell) as unknown;
    return Array.isArray(parsed) ? (parsed as EventException[]) : undefined;
  } catch { return undefined; }
}

export function encodeAttendees(ids: readonly number[] | undefined): string {
  return ids && ids.length ? ids.join("|") : "";
}

export function decodeAttendees(cell: string): number[] | undefined {
  if (!cell.trim()) return undefined;
  // The `Number.isInteger(n) && n > 0` filter is incidental to PARSING a
  // delimited string cell (a split token is unavoidably `unknown` numeric
  // input), not a second validation layer — it does not contradict the
  // decoded-output-is-untrusted note above. sanitizeAttendees still re-checks
  // ids against the live workspace when the assembled event is sanitized.
  const out = cell.split("|").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  return out.length ? out : undefined;
}
