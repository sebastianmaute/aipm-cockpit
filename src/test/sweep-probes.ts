// src/test/sweep-probes.ts
//
// ★★★ ONE PROBE DERIVATION FOR BOTH OFFERED-SURFACE RELATIONS, AND EVERY PROBE
// ADMITTED BY THE WRITER'S OWN SANITIZER BEFORE A RELATION MAY JUDGE IT.
//
// Relation A asks whether an UNDECLARED value is stopped; Relation B asks
// whether a DECLARED one lands. Both need the same kind of value: one the
// column can hold, which the writer would not produce on its own. An invalid
// value is stopped by the sanitizer whether or not the guard runs, so it
// proves nothing to either relation — that was §441's whole probe-shape
// blindness, and `trespassProbeFor`, the derivation this module replaced,
// produced exactly such values. It is GONE: the sweep is repointed here, and
// every surviving mention of the name is a COMMENT marking it as removed.
//
// ★★ VERIFY THE CLAIM, NEVER A TALLY. `grep -rn trespassProbeFor src scripts e2e`
// must return no declaration, no import and no call — that is the whole of what
// is being asserted, and it holds however many comments mention the name. This
// sentence used to pin the hit count at two, and this slice's own next test
// commit added a third mention in `plan.offered-surface-sweep.test.ts`, leaving
// a verified-2026-09-12 enumeration false the day after it was written. Any
// comment that names the removed derivation re-breaks a count; none of them can
// re-break the claim.
//
// A field whose probe the writer's sanitizer will not hold unchanged is
// reported `unmeasured`, BY NAME, in the sweep's both-directions ledger. It is
// never judged, and it is never green by default.
import { sanitizeCalendarEvent } from "../app/calendar-event";
import type { InlineEntity } from "../app/inline-ai-edit/entity-descriptor";
import { rebuildAbsenceForUpdate, sanitizeAbsence, sanitizeResource } from "../app/sanitize-entities";
import {
  rebuildChangeForUpdate,
  rebuildMilestoneForUpdate,
  rebuildRaidForUpdate,
  sanitizeMilestone,
  sanitizeModelChangeItem,
  sanitizeRaidItem,
  sanitizeStakeholder,
} from "../app/sanitize-records";
import { jsonToWorkspace } from "../app/workspace";
import { schemaProperty } from "./offered-surface-axis";

export type Row = Record<string, unknown>;
export type Arm = "create" | "update";
/** `row` is the row the comparison is made against, for normalisers that read siblings. */
export type Compare = (a: unknown, b: unknown, row: Row) => boolean;
export type ProbeOutcome =
  | { kind: "probe"; value: unknown }
  | { kind: "dead"; reason: string }
  | { kind: "unmeasured"; reason: string };

/** ★★★ THE ONE FIELD NO PROBE MAY DRIVE, AND THE ONLY REASON IS MAIL.
 *  `calendarEvent.sendInvitations` true trips `shouldStage` in
 *  `chat-proposal.ts` — the staging rule for the one write that WOULD leave the
 *  building the day the push slice lands.
 *
 *  ★★ PRESENT TENSE WOULD BE FALSE TODAY, and `sanitize-records.ts` records
 *  beside `CALENDAR_EVENT_FIELD_GUARDS` that three comments across this slice
 *  used it anyway. The flag is persisted and INERT: nothing outside the codecs,
 *  that table, the tool schema and the review descriptor reads it, and the push
 *  slice is unstarted. Reproduce with
 *  `grep -rln sendInvitations src --include=*.ts --include=*.tsx | grep -v test`.
 *
 *  ★★ THE SWEEP COULD NOT MAIL ANYTHING EVEN ONCE THE PUSH IS ARMED, and that
 *  is what makes this exclusion keepable rather than costly: `sendsInvitations`
 *  (`chat-proposal.ts`) reads the CALL INPUT to decide staging, and this sweep
 *  drives `runTool` and the dispatcher, never `shouldStage`. So the exclusion is
 *  POLICY — it keeps a probe off a flag whose arming is one slice away — not a
 *  live hazard being contained. Keep it for the same reason the staging rule
 *  itself is kept: it is cheap, it is correct the day the push lands, and arming
 *  it later is the edit most likely to be forgotten.
 *
 *  A SAFETY EXCLUSION, not an exemption: the field stays on the axis and
 *  reports `dead`, so it is visibly unmeasured. Do NOT widen this set to make a
 *  red run green (§443). */
export const MAIL_UNSAFE_BOOLEANS: ReadonlySet<string> = new Set(["calendarEvent.sendInvitations"]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;
const TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T/;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DAY_MS = 86_400_000;

export function isBlank(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/** Lower ranks are changed first inside a structured value. A free-text leaf
 *  is the change most likely to be refused there (a closed vocabulary such as
 *  a recurrence `freq`), so it goes last. Shape only — never a field name. */
function leafRank(v: unknown): number {
  if (typeof v === "number") return 0;
  if (typeof v === "boolean") return 1;
  if (typeof v === "string" && (DATE.test(v) || HHMM.test(v))) return 2;
  if (Array.isArray(v)) return 3;
  if (v !== null && typeof v === "object") return 4;
  return 5;
}

/** A value of the same KIND as `v` and different from it, or `undefined` when
 *  there is nothing to derive one from. Recognised by the value's SHAPE, as
 *  dates always were — there is no per-field override map, which would rot
 *  into an exemption list one rename at a time. */
export function changedInKind(v: unknown): unknown {
  if (typeof v === "boolean") return !v;
  // `Infinity + 1 === Infinity`, and `NaN` is never "different from it" —
  // both would silently violate this function's own contract.
  if (typeof v === "number") return Number.isFinite(v) ? v + 1 : undefined;
  if (typeof v === "string") {
    if (DATE.test(v)) {
      const d = new Date(`${v}T00:00:00Z`);
      // A regex-valid YYYY-MM-DD can still be calendar-invalid ("2026-13-01",
      // "2026-01-32") — `Date.parse` rejects an out-of-range month or day
      // (unlike a day that merely overflows its own month, which rolls over
      // silently; see `isoDateOrUndefined` in calendar-event.ts). Such a
      // `Date` is Invalid, and `.toISOString()` throws a RangeError.
      if (Number.isNaN(d.getTime())) return undefined;
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    if (HHMM.test(v)) {
      const [h, m] = v.split(":");
      return `${String((Number(h) + 1) % 24).padStart(2, "0")}:${m}`;
    }
    if (TIMESTAMP_PREFIX.test(v)) {
      const t = Date.parse(v);
      if (!Number.isNaN(t) && new Date(t).toISOString() === v) return new Date(t + DAY_MS).toISOString();
    }
    if (EMAIL_SHAPE.test(v)) {
      const at = v.indexOf("@");
      return `${v.slice(0, at)}+probed${v.slice(at)}`;
    }
    return v.length > 0 ? `${v} probed` : undefined;
  }
  // ★★ AN ARRAY DROPS A KNOWN-GOOD ELEMENT; IT NEVER APPENDS AN INVENTED ONE.
  //  Every element that remains is one the store already holds, so no type or
  //  foreign-key check can legitimately refuse it.
  if (Array.isArray(v)) {
    if (v.length >= 2) return v.slice(1);
    if (v.length === 1) return [];
    return undefined;
  }
  if (v !== null && typeof v === "object") {
    const obj = v as Row;
    const keys = Object.keys(obj).sort((a, b) => leafRank(obj[a]) - leafRank(obj[b]));
    for (const k of keys) {
      const changed = changedInKind(obj[k]);
      if (changed !== undefined) return { ...obj, [k]: changed };
    }
    return undefined;
  }
  return undefined;
}

const asRow = (r: unknown): Row | null => (r === null || r === undefined ? null : (r as Row));
/** Runs under jsdom (`vitest.config.ts` `environment: "jsdom"`) — the rich-field
 *  pass this round trip's task decode runs (`sanitizeNoteFields` →
 *  `sanitizeRichHtml`) is DOM-dependent.
 *
 *  `{ strict: true }` deliberately: non-strict `jsonToWorkspace` swallows ANY
 *  construction-time exception into `emptyWorkspace()`, so a genuine failure
 *  here (a missing DOM, chiefly) would read as `.tasks[0] === undefined` —
 *  indistinguishable from "the create writer's sanitizer refuses the whole
 *  row", the exact wrong diagnosis `admitProbe` would then report. Strict is
 *  safe for this envelope: `{tasks:[row], raid:[]}` always satisfies both
 *  shape checks (`Array.isArray` on `tasks`/`raid`), the JSON is built by
 *  `JSON.stringify` so it never fails to parse, and the two other strict-only
 *  throws in `jsonToWorkspace` guard `p.documents`/`p.documentVersions`, keys
 *  this envelope never sets — so the only strict throw this call can ever hit
 *  is the outer catch-all re-raising a REAL construction exception, which is
 *  exactly what should surface rather than be swallowed.
 *
 *  ★ EXPORTED ONLY so `sweep-probes.test.ts` can pin, by REFERENCE, that this
 *  weak oracle is reached from `task` and nothing else. A name comparison
 *  cannot do it, and a ninth entity pointed here on "it has no row sanitizer
 *  either" reasoning is the drift that pin exists to catch. */
export const taskAtRest = (row: Row): Row | null =>
  asRow(jsonToWorkspace(JSON.stringify({ tasks: [row], raid: [] }), { strict: true }).tasks[0]);

/** The sanitizer each entity's WRITER runs on the given arm — the oracle for
 *  "can this column hold this value". Typed over `InlineEntity`, so a new
 *  entity is a tsc error until it names its writer.
 *
 *  ★★ NOT `jsonToWorkspace` FOR ALL EIGHT: it CASTS raid and task rows, so it
 *  would admit almost anything there. Task alone falls back to it, because
 *  `create_task` has no row sanitizer — its writer builds the row field by
 *  field. That oracle is WEAK on purpose and pinned as such in
 *  `sweep-probes.test.ts`. `change` differs by arm: the create writer repairs
 *  through `sanitizeModelChangeItem` (`use-register-tools.ts`).
 *  ★★ The UPDATE arm of raid, change, milestone and absence is the writers' own
 *  `rebuild*ForUpdate(stored, merged)`, NOT the strict sanitizer: those writers
 *  carry an untouched stored date the load funnel kept raw, so a strict oracle
 *  judged a different writer than the one that runs. `stored` is the row the
 *  probe is merged into (`admitProbe`'s reference); the create arm ignores it. */
export const ADMISSION_ORACLE: Readonly<Record<InlineEntity, Readonly<Record<Arm, (row: Row, stored: Row) => Row | null>>>> = {
  task: { create: taskAtRest, update: taskAtRest },
  raid: { create: (r) => asRow(sanitizeRaidItem(r)), update: (r, s) => asRow(rebuildRaidForUpdate(s as never, r)) },
  change: { create: (r) => asRow(sanitizeModelChangeItem(r)), update: (r, s) => asRow(rebuildChangeForUpdate(s as never, r)) },
  milestone: { create: (r) => asRow(sanitizeMilestone(r)), update: (r, s) => asRow(rebuildMilestoneForUpdate(s as never, r)) },
  stakeholder: { create: (r) => asRow(sanitizeStakeholder(r)), update: (r) => asRow(sanitizeStakeholder(r)) },
  resource: { create: (r) => asRow(sanitizeResource(r)), update: (r) => asRow(sanitizeResource(r)) },
  absence: { create: (r) => asRow(sanitizeAbsence(r)), update: (r, s) => asRow(rebuildAbsenceForUpdate(s as never, r)) },
  calendarEvent: { create: (r) => asRow(sanitizeCalendarEvent(r)), update: (r) => asRow(sanitizeCalendarEvent(r)) },
};

/** `undefined` when the writer's sanitizer holds `probe` unchanged in `field`
 *  of `reference`; otherwise the reason it does not. */
export function admitProbe(
  entity: InlineEntity,
  arm: Arm,
  field: string,
  reference: Row,
  probe: unknown,
  compare: Compare,
): string | undefined {
  const kept = ADMISSION_ORACLE[entity][arm]({ ...reference, [field]: probe }, reference);
  if (!kept) return `the ${arm} writer's sanitizer refuses the whole row once ${field} is ${JSON.stringify(probe)}`;
  // Deliberately `kept`, not `reference`: this asks whether the SANITIZED row
  // — the probe's own post-sanitizer siblings — still carries the probe
  // unchanged, a different question from `probeFor`'s `eq`, which always
  // compares against the pre-sanitizer `reference`.
  if (!compare(kept[field], probe, kept)) {
    return `the ${arm} writer's sanitizer reshapes ${JSON.stringify(probe)} to ${JSON.stringify(kept[field])}`;
  }
  return undefined;
}

/** The probe for one field on one arm, or why there is none.
 *
 *  Reference: the CONTROL row (what `CREATE_BASE` produces on its own) on the
 *  create arm, the BEFORE row on the update arm — the row the probe will be
 *  judged against, so a probe can no longer be derived against one row and
 *  judged against another (§459's `absence.startDate`, §443's `startTime`).
 *
 *  Source: a declared `enum` is EXCLUSIVE of everything else — an enum field
 *  only accepts its declared members, so a value built by `changedInKind` or
 *  drawn from the seed could land outside that closed vocabulary and be
 *  refused for the wrong reason (an out-of-vocabulary value, not a
 *  same-vocabulary alternative). Within the enum, the FIRST member that
 *  DIFFERS from the reference is not necessarily one the writer will hold: a
 *  declared enum can be wider than what one row accepts — `raid.status`'s
 *  schema enum is the union of all four RAID categories' vocabularies, but
 *  `sanitizeRaidItem` accepts only the row's own category's subset and
 *  reshapes anything else. So the differing members are walked IN DECLARED
 *  ORDER and the first one `admitProbe` actually holds is taken; if none of
 *  them is held, the field is `unmeasured` with the FIRST differing member's
 *  refusal (the one derivation would have picked without this walk, so the
 *  reported reason matches what a reader would reproduce by hand). When the
 *  reference already equals every member, the field is correctly `dead` — a
 *  state that needs a single-member (or all-duplicate-member) enum and is
 *  unreachable today: `sweep-probes.test.ts`'s "has no declared enum with
 *  fewer than two distinct members" asserts that of every declared enum,
 *  across every entity and both arms.
 *
 *  Without a governing enum, the two remaining sources FALL THROUGH one to
 *  the next rather than excluding each other: the reference value changed in
 *  kind, THEN — only when that produced nothing — the seed row's value, sent
 *  as is where the reference carries none (the fixture already proved the
 *  sanitizer accepts it) or changed in kind where it does not. A reference
 *  that is a non-blank OBJECT with only blank leaves (`{ a: "" }`) is the case
 *  this matters for: `changedInKind` derives nothing from it, and an `else if`
 *  chain used to stop there even though the seed held a usable value.
 *
 *  Otherwise nothing, and the field is `dead`. */
export function probeFor(args: {
  entity: InlineEntity;
  arm: Arm;
  field: string;
  declared: boolean;
  reference: Row;
  seedRow: Row;
  compare: Compare;
}): ProbeOutcome {
  const { entity, arm, field, declared, reference, seedRow, compare } = args;
  if (MAIL_UNSAFE_BOOLEANS.has(`${entity}.${field}`)) {
    return { kind: "dead", reason: "unmeasured by mail-safety policy: a strict true would stage a real invitation (§443)" };
  }
  const ref = reference[field];
  const eq = (a: unknown, b: unknown) => compare(a, b, reference);

  const members = declared ? schemaProperty(entity, arm, field).enum : undefined;
  if (members && members.length > 0) {
    const differing = members.filter((m) => !eq(m, ref));
    if (differing.length === 0) {
      return { kind: "dead", reason: "nothing to derive a distinguishable probe from" };
    }
    let firstRefusal: string | undefined;
    for (const member of differing) {
      const refusal = admitProbe(entity, arm, field, reference, member, compare);
      if (refusal === undefined) return { kind: "probe", value: member };
      firstRefusal ??= refusal;
    }
    // `differing` is non-empty (checked above) and every iteration that did not
    // already return recorded a refusal, so `firstRefusal` is always set here.
    return { kind: "unmeasured", reason: firstRefusal! };
  }

  let candidate: unknown;
  if (!isBlank(ref)) candidate = changedInKind(ref);
  const seeded = seedRow[field];
  if (candidate === undefined && !isBlank(seeded)) {
    candidate = eq(seeded, ref) ? changedInKind(seeded) : seeded;
  }

  if (candidate === undefined) return { kind: "dead", reason: "nothing to derive a distinguishable probe from" };
  if (eq(candidate, ref)) return { kind: "dead", reason: "the derived probe equals the reference value" };
  const refusal = admitProbe(entity, arm, field, reference, candidate, compare);
  return refusal === undefined ? { kind: "probe", value: candidate } : { kind: "unmeasured", reason: refusal };
}
