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
// blindness, and `trespassProbeFor` (deleted) produced exactly such values.
//
// A field whose probe the writer's sanitizer will not hold unchanged is
// reported `unmeasured`, BY NAME, in the sweep's both-directions ledger. It is
// never judged, and it is never green by default.
import { sanitizeCalendarEvent } from "../app/calendar-event";
import type { InlineEntity } from "../app/inline-ai-edit/entity-descriptor";
import { sanitizeAbsence, sanitizeResource } from "../app/sanitize-entities";
import {
  sanitizeChangeItem,
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
 *  `chat-proposal.ts`, the one write in this app that leaves the building.
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
  if (typeof v === "number") return v + 1;
  if (typeof v === "string") {
    if (DATE.test(v)) {
      const d = new Date(`${v}T00:00:00Z`);
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
const taskAtRest = (row: Row): Row | null =>
  asRow(jsonToWorkspace(JSON.stringify({ tasks: [row], raid: [] })).tasks[0]);

/** The sanitizer each entity's WRITER runs on the given arm — the oracle for
 *  "can this column hold this value". Typed over `InlineEntity`, so a new
 *  entity is a tsc error until it names its writer.
 *
 *  ★★ NOT `jsonToWorkspace` FOR ALL EIGHT: it CASTS raid and task rows, so it
 *  would admit almost anything there. Task alone falls back to it, because
 *  `create_task` has no row sanitizer — its writer builds the row field by
 *  field. That oracle is WEAK on purpose and pinned as such in
 *  `sweep-probes.test.ts`. `change` differs by arm: the create writer repairs
 *  through `sanitizeModelChangeItem` (`use-register-tools.ts`). */
export const ADMISSION_ORACLE: Readonly<Record<InlineEntity, Readonly<Record<Arm, (row: Row) => Row | null>>>> = {
  task: { create: taskAtRest, update: taskAtRest },
  raid: { create: (r) => asRow(sanitizeRaidItem(r)), update: (r) => asRow(sanitizeRaidItem(r)) },
  change: { create: (r) => asRow(sanitizeModelChangeItem(r)), update: (r) => asRow(sanitizeChangeItem(r)) },
  milestone: { create: (r) => asRow(sanitizeMilestone(r)), update: (r) => asRow(sanitizeMilestone(r)) },
  stakeholder: { create: (r) => asRow(sanitizeStakeholder(r)), update: (r) => asRow(sanitizeStakeholder(r)) },
  resource: { create: (r) => asRow(sanitizeResource(r)), update: (r) => asRow(sanitizeResource(r)) },
  absence: { create: (r) => asRow(sanitizeAbsence(r)), update: (r) => asRow(sanitizeAbsence(r)) },
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
  const kept = ADMISSION_ORACLE[entity][arm]({ ...reference, [field]: probe });
  if (!kept) return `the ${arm} writer's sanitizer refuses the whole row once ${field} is ${JSON.stringify(probe)}`;
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
 *  Source, most specific first: a declared `enum` member that differs from
 *  the reference; the reference value changed in kind; the SEEDED value — sent
 *  as is where the reference carries none, because the fixture already proved
 *  the sanitizer accepts it; otherwise nothing, and the field is `dead`. */
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

  let candidate: unknown;
  const members = declared ? schemaProperty(entity, arm, field).enum : undefined;
  if (members && members.length > 0) {
    candidate = members.find((m) => !eq(m, ref));
  } else if (!isBlank(ref)) {
    candidate = changedInKind(ref);
  } else if (!isBlank(seedRow[field])) {
    candidate = eq(seedRow[field], ref) ? changedInKind(seedRow[field]) : seedRow[field];
  }

  if (candidate === undefined) return { kind: "dead", reason: "nothing to derive a distinguishable probe from" };
  if (eq(candidate, ref)) return { kind: "dead", reason: "the derived probe equals the reference value" };
  const refusal = admitProbe(entity, arm, field, reference, candidate, compare);
  return refusal === undefined ? { kind: "probe", value: candidate } : { kind: "unmeasured", reason: refusal };
}
