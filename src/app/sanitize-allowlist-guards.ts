// src/app/sanitize-allowlist-guards.ts — the two ALLOWLIST merge-site guards
// (absence, calendar event). Moved out of sanitize-records.ts, which sat at the
// file-size LIMIT with zero headroom (§447); the five DENYLIST tables stay
// there. Re-exported via the `./sanitize` barrel.
import { ABSENCE_TYPES } from "./types";
import { isPlainObject } from "./sanitize-core";
// ★ Type-only would not do: `acceptsEventDuration` is consulted at runtime by
//  `CALENDAR_EVENT_FIELD_GUARDS`. It composes `calendar-event.ts`'s own
//  `intInRange` over that module's private bounds, which is why the range has
//  one spelling across the guard, the sanitizer and the preview.
// ★★★ THIS CLOSES AN IMPORT CYCLE — `calendar-event.ts` imports the `./sanitize`
//  barrel, which re-exports THIS module — and it is safe for one specific
//  reason: `acceptsEventDuration` is a hoisted FUNCTION DECLARATION, so its
//  binding is initialised before either module body runs and
//  `CALENDAR_EVENT_FIELD_GUARDS` (a module-level const) can read it whichever
//  side of the cycle is evaluated first. Re-spelling it as a `const` arrow in
//  `calendar-event.ts` would put that read in the TDZ and throw at import time,
//  in one evaluation order only — i.e. intermittently, and never in a
//  typecheck. Keep it a `function`.
import { acceptsEventDuration } from "./calendar-event";

// --- Absence + calendar event merge-site guards -----------------------------
//
// ★★★ THESE TWO ARE ALLOWLISTS, NOT DENYLISTS — the opposite shape from the
// five guard tables in sanitize-records.ts. `MILESTONE_FIELD_GUARDS` /
// `CHANGE_FIELD_GUARDS` / `RAID_FIELD_GUARDS` / `STAKEHOLDER_FIELD_GUARDS` /
// `RESOURCE_FIELD_GUARDS` (★ enumerate rather than trust this line:
// `grep -n "_FIELD_GUARDS: Readonly" src/app/sanitize-records.ts src/app/sanitize-allowlist-guards.ts`
// — the rows in sanitize-records.ts are the denylists, the two in this file the
// allowlists) all iterate their OWN
// entries and `delete` a field that fails its guard — a field with no entry in
// the table is left alone, because those sanitizers already have a closed,
// hand-enumerated set of writable fields elsewhere in the load/update path.
// Absences and calendar events have no such enumeration: BOTH strip helpers
// (`patchWithoutId`, `createInputWithoutId`) forward whatever the model emitted
// minus `id`/`expectedToken`/the token exclusions (docs/open-followups.md §418),
// so a field this table does not name is one the model can write on EITHER path.
// Iterating the PATCH and keeping entries with a passing guard closes that gap,
// including against a field invented by a future model or added to the entity
// after this table was written, which a denylist here could not do.

/** Which model-supplied absence fields survive the merge.
 *
 *  ★★★ IT EXISTS BECAUSE BOTH STRIP HELPERS FORWARD EVERYTHING. The model's
 *   patch reaches the writer with only `id`, `expectedToken` and the token
 *   exclusions removed, on create as well as update (§418), so any key absent
 *   from this table is one the model can write. `outlookEventId` and
 *   `localModifiedAt` are owned by sync and are why this is not optional.
 *   ★★ UNLIKE the milestone/stakeholder guards
 *   in sanitize-records.ts, though, the strip is NOT what makes those two
 *   unreachable here: this
 *   ALLOWLIST names neither, so it refuses both first and the strip is inert
 *   defence-in-depth. Keep it — `ai-entity-token.ts` says that row is
 *   legitimate ONLY while this allowlist holds.
 *
 *  ★★ `type` is dropped rather than corrected when unrecognised. `sanitizeAbsence`
 *   RESETS an unknown type to a fallback, and a reset is invisible on the review
 *   card — the same silent-demotion shape `dropUnacceptedStakeholderFields`
 *   exists for.
 *
 *  ★★★ `resourceId: null` IS THE MODEL'S ONLY WAY TO UNLINK A RESOURCE, not a
 *   dead branch — `Absence.resourceId` is typed `number | undefined` because
 *   `null` is a WIRE value the sanitizer normalises away, never a stored one.
 *   `sanitizeAbsence` (sanitize-entities.ts) feeds `raw.resourceId` through
 *   `fkIdOrUndefined` (sanitize-core.ts), which is `toNumber` gated on
 *   `Number.isFinite(n) && n > 0`; `toNumber(null)` is `NaN`, so `null` comes
 *   out the other side as `undefined` — the clear. Dropping this branch would
 *   silently remove the unlink capability. A STRING is refused on purpose even
 *   though `fkIdOrUndefined` itself would accept one (`toNumber("5")` is a
 *   real number): this guard is stricter so the review card cannot show a
 *   link the model spelled as text. */
/** ★★★ EXPORTED so the AI review card can MODEL this table rather than restate
 *  it (`INLINE_DESCRIPTORS.absence.rawTypeGuards`). It is an ALLOW-LIST — see
 *  `dropUnacceptedAbsenceFields` below — so a field it refuses never reaches
 *  `sanitizeAbsence` and the STORED value survives. A preview that ran the
 *  refused value through the sanitizer instead would show a clear the write
 *  does not make; measured, on `assigneeEmail` and `note`, by
 *  `plan.sanitizer-parity.test.ts`. */
export const ABSENCE_FIELD_GUARDS: Readonly<Record<string, (v: unknown) => boolean>> = {
  assignee: (v) => typeof v === "string",
  assigneeEmail: (v) => typeof v === "string",
  startDate: (v) => typeof v === "string",
  endDate: (v) => typeof v === "string",
  type: (v) => typeof v === "string" && (ABSENCE_TYPES as readonly string[]).includes(v),
  note: (v) => typeof v === "string",
  resourceId: (v) => typeof v === "number" || v === null,
};

export function dropUnacceptedAbsenceFields<T extends object>(patch: T): T {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    const accepts = ABSENCE_FIELD_GUARDS[field];
    if (accepts && accepts(value)) out[field] = value;
  }
  return out as T;
}

/** Which model-supplied calendar-event fields survive the merge.
 *
 *  ★★★ `sendInvitations` IS DELIBERATELY PRESENT. Once the Outlook push lands it
 *   would mail attendees — the one effect here that leaves the building — and the
 *   user's scope decision was to allow the model to set it and force any such
 *   call through the staged review card (`shouldStage`). Dropping it here would
 *   make that staging rule unreachable.
 *
 *  ★★ PRESENT TENSE WOULD BE FALSE TODAY, and three comments across this slice
 *   used it. The flag is persisted and INERT: no consumer outside the codecs,
 *   this table, the tool schema and the review descriptor reads it, and the push
 *   slice is unstarted (`calendar-event-modal.tsx` says the field stays on the
 *   model with no UI). Reproduce with
 *   `grep -rln sendInvitations src --include=*.ts --include=*.tsx | grep -v test`.
 *   KEEP the staging rule regardless — it is cheap, it is correct the day the
 *   push lands, and arming it later is the edit most likely to be forgotten.
 *
 *  ★★ `exceptions` is ABSENT on purpose: per-occurrence skip/move bookkeeping
 *   the UI writes when a user edits one instance. There is no phrasing a model
 *   could use for it that a reviewer could check at a glance.
 *
 *  ★★ `recurrence` uses `isPlainObject`, NOT a hand-rolled `typeof v ===
 *   "object" && v !== null` — that looser form is also true of an ARRAY, and
 *   `RecurrenceRule` (calendar-event.ts) is a union of plain objects, never an
 *   array. `isPlainObject` (sanitize-core.ts) already excludes `Array.isArray`;
 *   re-deriving the check here would just be a second spelling to drift from
 *   the first. */
/** ★★★ EXPORTED for the review card, exactly as `ABSENCE_FIELD_GUARDS` above,
 *  and it matters MORE here: `sendInvitations` is the one field in the app
 *  whose write leaves the building. Refused (a non-boolean), the stored flag
 *  survives — so a preview projecting the refusal renders "invitations: on →
 *  off" for a write that keeps them ON, which is the one direction a user must
 *  never be misled in. */
export const CALENDAR_EVENT_FIELD_GUARDS: Readonly<Record<string, (v: unknown) => boolean>> = {
  title: (v) => typeof v === "string",
  startDate: (v) => typeof v === "string",
  startTime: (v) => typeof v === "string",
  // ★★★ THE WRITER'S OWN RANGE, NOT A BARE `typeof number`, and the tightening
  //  is §384's shape closed writer-side — the direction §396 records as the
  //  right one. `sanitizeCalendarEvent` CLAMPS an out-of-range duration to the
  //  60-minute default rather than refusing it, so while this guard admitted
  //  any finite number, `update_calendar_event({durationMinutes: 3})` silently
  //  demoted a stored 90-minute meeting to 60. `dropUnaccepted*` exists so an
  //  unaccepted value means "leave the stored value alone"; a type check alone
  //  could not deliver that here. Same shape as `probability`/`impact` in
  //  `RAID_FIELD_GUARDS`, which use `acceptsRiskScale` for the same reason.
  //  Found by `plan.sanitizer-parity.test.ts` the day `calendarEvent` was added
  //  to its sweep, reported as "preview REJECTS, apply moves 90 -> 60".
  durationMinutes: acceptsEventDuration,
  location: (v) => typeof v === "string",
  notes: (v) => typeof v === "string",
  attendeeResourceIds: (v) => Array.isArray(v) && v.every((n) => typeof n === "number"),
  sendInvitations: (v) => typeof v === "boolean",
  recurrence: (v) => isPlainObject(v),
};

export function dropUnacceptedCalendarEventFields<T extends object>(patch: T): T {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    const accepts = CALENDAR_EVENT_FIELD_GUARDS[field];
    if (accepts && accepts(value)) out[field] = value;
  }
  return out as T;
}
