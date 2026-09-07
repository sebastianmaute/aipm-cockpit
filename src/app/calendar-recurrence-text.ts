// src/app/calendar-recurrence-text.ts — one human line for a RecurrenceRule.
//
// ★★★ IT EXISTS FOR THE REVIEW CARD. `describeEntityCalls` renders a FieldDiff
// as before/after STRINGS, so without this a staged recurrence change reaches
// the card as a JSON blob — on the one surface whose whole job is letting a
// user refuse a write they understand.
//
// ★★ DOM-FREE AND i18n-FREE BY CONTRACT, like every engine under this app's
// pure-module convention. It is fed by a MODEL patch, so it must accept
// `unknown` and answer "" rather than throwing: the descriptor then renders its
// own empty state instead of the string "undefined".

import type { RecurrenceRule } from "./calendar-event";

const FREQ_UNIT: Readonly<Record<string, [string, string]>> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
};

function isRule(v: unknown): v is RecurrenceRule {
  if (typeof v !== "object" || v === null) return false;
  const freq = (v as { freq?: unknown }).freq;
  return typeof freq === "string" && freq in FREQ_UNIT;
}

// Mirrors `intInRange(r.interval, 1, 52, 1)` in `calendar-event.ts`'s
// `sanitizeRecurrence` — the ONLY thing that decides what actually gets
// written. Anything that is not an integer in 1..52 is clamped to 1 there,
// so this projection clamps identically: a non-integer, sub-1 or over-52
// value from a model patch must render as "Every day", never as the raw
// value, or the review card overstates what the write will store. A literal
// mirror, not an import — the sanitizer pulls in more than this pure,
// DOM-free module needs.
function clampInterval(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 52 ? v : 1;
}

/** `Every day` · `Every 2 weeks on MO, WE` · `Every month on the last FR`,
 *  with an optional ` until <date>` or `, N times` tail. "" for a non-rule. */
export function recurrenceText(rule: unknown): string {
  if (!isRule(rule)) return "";
  const r = rule as RecurrenceRule & {
    byDay?: unknown;
    byMonthDay?: unknown;
    until?: unknown;
    count?: unknown;
  };
  const interval = clampInterval(r.interval);
  const [one, many] = FREQ_UNIT[r.freq];
  let out = interval === 1 ? `Every ${one}` : `Every ${interval} ${many}`;

  if (r.freq === "weekly" && Array.isArray(r.byDay) && r.byDay.length > 0) {
    out += ` on ${r.byDay.join(", ")}`;
  }
  if (r.freq === "monthly") {
    if (typeof r.byMonthDay === "number") {
      // An out-of-range byMonthDay writes a day DERIVED FROM THE EVENT'S
      // startDate (`intInRange(r.byMonthDay, 1, 31, fallbackDom)` in
      // calendar-event.ts's `sanitizeRecurrence`), which this module cannot
      // see — the descriptor engine's `forPreview(entity, field, value)`
      // (inline-ai-edit/plan.ts) hands a field projection only the VALUE,
      // never the entity. Printing a guessed day would be a false statement
      // about the write; omitting the clause is a true but incomplete one —
      // and between overstating and understating a write the user is being
      // asked to approve, understating is the only safe direction. DO NOT
      // "complete" this by printing a guessed fallback day.
      if (Number.isInteger(r.byMonthDay) && r.byMonthDay >= 1 && r.byMonthDay <= 31) {
        out += ` on day ${r.byMonthDay}`;
      }
    } else if (typeof r.byDay === "object" && r.byDay !== null) {
      const { ordinal, day } = r.byDay as { ordinal?: unknown; day?: unknown };
      if (typeof day === "string" && typeof ordinal === "number") {
        const which = ordinal === -1 ? "last" : `${ordinal}`;
        out += ` on the ${which} ${day}`;
      }
    }
  }

  if (typeof r.until === "string" && r.until !== "") return `${out} until ${r.until}`;
  if (typeof r.count === "number") return `${out}, ${r.count} times`;
  return out;
}
