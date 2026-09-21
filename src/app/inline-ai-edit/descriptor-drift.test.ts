import { describe, it, expect } from "vitest";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { RICH_FIELDS } from "./plan";
import { sanitizeRaidItem, sanitizeChangeItem, sanitizeMilestone, sanitizeStakeholder, sanitizeResource, sanitizeAbsence } from "../sanitize";
import { sanitizeCalendarEvent } from "../calendar-event";
import { descriptionHtml } from "../rich-text-plain";

// The RICH-TEXT diff fields (slice B). Their sanitizers UPGRADE a legacy plain
// value to HTML, so "survives" means the field arrives in its upgraded form —
// not byte-identical. Every other field still round-trips verbatim. This test is
// about WRITABILITY (the dispatcher can set the field and the sanitizer does not
// silently drop it), so the expectation is expressed as the upgrade itself
// rather than a hard-coded "<p>…</p>".
//
// ★★ Imported from plan.ts rather than re-listed here. A local copy is what let
// plan.ts's set drift to bare field names and start projecting the plain-text
// `stakeholder.notes`. Sharing it also makes THIS test the guard on the list:
// a wrong entry (e.g. "stakeholder.notes") flips the expectation to an upgrade
// its sanitizer never performs, and the case fails. `task.description` is in the
// set but unreached — CASES covers the sanitizer-backed entities only, i.e.
// every `InlineEntity` except `task`, whose apply path is `buildTaskCleanPatch`
// rather than a full-record sanitizer.
//
// ★★ NO ROW COUNT IS QUOTED HERE ANY MORE. This sentence read "the FOUR
// sanitizer-backed entities" while the array held FIVE — it rotted the day
// `resource` was added and nothing could see it — and adding `absence` and
// `calendarEvent` would have rotted it again. Derive it:
//   grep -c "entity: \"" src/app/inline-ai-edit/descriptor-drift.test.ts
// ★★★ AND THE ARRAY IS A HAND-COPY, NOT AN ENUMERATION over
// `INLINE_DESCRIPTORS`: a new entity silently falls OUTSIDE this file's promise
// while every test in it stays green. Add the row by hand, or the describe
// block's name is a claim the file no longer honours.

// One valid full item per entity + a valid replacement value per diff field.
// Each field is set on a valid base, run through the sanitizer, and must survive
// with the replacement value (proving the sanitizer keeps it — no silent drop).
const RAID_BASE = { id: 1, category: "R", title: "T", status: "Open", raisedDate: "2026-01-01" };
// status "Mitigated" is a RISK status — valid for the base category R (per-field
// cases set ONE field on the R base, so an Issue-only status would be coerced).
const RAID_VALUES: Record<string, unknown> = {
  category: "I", title: "New", status: "Mitigated", description: "d", mitigation: "m",
  owner: "Ann", ownerEmail: "a@b.co", severity: "High", probability: 3, impact: 4,
  raisedDate: "2026-02-02", targetDate: "2026-03-03", closedDate: "2026-04-04",
};
const CHANGE_BASE = { id: 1, title: "T", type: "Other", status: "Proposed", raisedDate: "2026-01-01" };
// ★★ `decisionDate` HERE IS CURRENTLY UNREAD — RETAINED ON PURPOSE, NOT DEAD DATA.
//  The loop below iterates `INLINE_DESCRIPTORS[entity].diffFields` and looks each
//  member up in this map (one-directional: every diff field needs a value, never
//  the reverse). `change.decisionDate` was WITHDRAWN from `diffFields` on
//  2026-09-09 because it is DERIVED, so no `change.decisionDate survives sanitize`
//  case is generated any more and this row is not read by anything.
//  ★ Kept against a re-offer: restore the field to `diffFields` and the case comes
//  back with its fixture already in place. `refactor-cleaner` and any dead-data
//  sweep should leave it — the same call `field-labels.test.ts` makes for
//  `FIELD_LABEL_KEY["change.decisionDate"]`, and for the same one-directional
//  reason. Do NOT add a test to make it read.
const CHANGE_VALUES: Record<string, unknown> = {
  title: "New", description: "d", type: "Scope", status: "Approved", impact: "High",
  impactDescription: "id", scheduleImpactDays: 5, costImpact: 100, requestedBy: "Ann",
  raisedDate: "2026-02-02", decisionBy: "Bob", decisionDate: "2026-03-03", resolutionNotes: "r",
};
const MILE_BASE = { id: 1, name: "M", date: "2026-01-01" };
const MILE_VALUES: Record<string, unknown> = { name: "New", date: "2026-02-02", description: "d", achievedDate: "2026-03-03" };
const STK_BASE = { id: 1, name: "S", category: "Other", influence: "Medium", interest: "Medium", raci: {} };
const STK_VALUES: Record<string, unknown> = {
  name: "New", organization: "Org", title: "CTO", email: "a@b.co",
  category: "Sponsor", influence: "High", interest: "Low", notes: "n",
};

// ★★ The base needs BOTH name parts: `sanitizeResource` returns null when both
// are empty, so a base carrying only one would make the per-field case for the
// OTHER part ("blank it") return null and fail for the right reason but the
// wrong reason to a reader. `isExternal` is stored present-or-absent (the
// sanitizer accepts only `true` / "true"), which is why the case value is
// `true` — a `false` here would assert the sanitizer keeps a key it drops.
const RES_BASE = { id: 1, firstName: "A", lastName: "B" };
const RES_VALUES: Record<string, unknown> = {
  firstName: "New", lastName: "Fam", title: "CTO", email: "a@b.co",
  department: "Delivery", company: "Example Co", location: "Berlin",
  businessPhone: "+49 30 1234", isExternal: true, notes: "n",
  // ★ TWO distinct addresses, and RES_BASE deliberately carries no primary
  //  `email` — `sanitizeEmailList` drops any extra equal to the primary, so a
  //  one-element value that happened to match would make a DROPPED list read as
  //  a survival. The `String(array)` comparison this file uses pins the order
  //  as well as the membership.
  emails: ["c@d.co", "e@f.co"],
};

// ★★ THE BASE PAIR IS DELIBERATELY WIDE (Jan 1 → Dec 31) and the two
// replacement dates sit INSIDE it. `sanitizeAbsence` SWAPS the pair rather than
// rejecting it when `endDate < startDate`, so a narrow base would make the
// per-field case for one date silently write the OTHER field and read as a drop
// — a fixture defect indistinguishable from the sanitizer losing the value.
const ABS_BASE = { id: 1, assignee: "Ada", startDate: "2026-01-01", endDate: "2026-12-31" };
const ABS_VALUES: Record<string, unknown> = {
  assignee: "New", assigneeEmail: "a@b.co", startDate: "2026-02-02", endDate: "2026-03-03",
  type: "sick", note: "n",
};

// ★ `sendInvitations` is stored present-or-absent (only `true` survives), so
// the case value must be `true` — `false` would assert the sanitizer keeps a
// key it drops, the same trap `RES_VALUES.isExternal` documents above.
// ★★ `recurrence` is compared through `String(...)`, so both sides render
// "[object Object]" and this row proves SURVIVAL, not shape: a dropped rule
// reads "undefined" and reds, a mis-shaped one does not. The shape is owned by
// `calendar-recurrence-text`'s own differential tests and by the parity sweep.
const EVT_BASE = { id: 1, title: "T", startDate: "2026-01-01" };
const EVT_VALUES: Record<string, unknown> = {
  title: "New", startDate: "2026-02-02", startTime: "14:30", durationMinutes: 90,
  location: "Berlin", notes: "n", sendInvitations: true,
  recurrence: { freq: "weekly", interval: 2 },
};

const CASES = [
  { entity: "raid" as const, base: RAID_BASE, values: RAID_VALUES, sanitize: sanitizeRaidItem },
  { entity: "change" as const, base: CHANGE_BASE, values: CHANGE_VALUES, sanitize: sanitizeChangeItem },
  { entity: "milestone" as const, base: MILE_BASE, values: MILE_VALUES, sanitize: sanitizeMilestone },
  { entity: "stakeholder" as const, base: STK_BASE, values: STK_VALUES, sanitize: sanitizeStakeholder },
  { entity: "resource" as const, base: RES_BASE, values: RES_VALUES, sanitize: sanitizeResource },
  { entity: "absence" as const, base: ABS_BASE, values: ABS_VALUES, sanitize: sanitizeAbsence },
  { entity: "calendarEvent" as const, base: EVT_BASE, values: EVT_VALUES, sanitize: sanitizeCalendarEvent },
];

/** Entities the descriptor map declares that CASES deliberately omits, each
 *  with the reason it cannot be covered here.
 *
 *  ★ `task` has no single `sanitizeTask` to call — verify with
 *    `grep -rn "export function sanitizeTask\b" src/app`, which returns
 *    nothing. Every other descriptor entity has one exported sanitizer that
 *    takes the whole row, which is what a case needs. */
const NO_SINGLE_SANITIZER: readonly string[] = ["task"];

describe("descriptor diffFields are dispatcher-writable", () => {
  // ★★★ THE ANTI-ROT ASSERTION, and the reason this file is no longer the
  //  hand-copy its own header warns about. `CASES` is still written by hand —
  //  it has to be, since each row needs a base object and a per-field
  //  replacement value that nothing can derive — but it is now COMPARED against
  //  the descriptor map, in BOTH directions:
  //    · a new `INLINE_DESCRIPTORS` entry with no row reds here BY NAME, where
  //      it used to fall silently outside this describe block's promise while
  //      every test in the file stayed green;
  //    · a row for an entity the map no longer declares reds too;
  //    · and an entry in the exception list that stops being a real exception
  //      (someone exports a `sanitizeTask`) reds as well, so the carve-out
  //      cannot outlive its reason.
  //  ★ It cannot catch a union member with NO descriptor entry — nothing at
  //  runtime can, because the union is a type. That case is a hard tsc error on
  //  `Record<InlineEntity, EntityDescriptor>` instead, which is the one site of
  //  the four in open-followups §434 that announces itself.
  it("covers every entity the descriptor map declares, or names it as an exception", () => {
    const covered = CASES.map((c) => c.entity as string);
    expect([...covered, ...NO_SINGLE_SANITIZER].sort()).toEqual(
      Object.keys(INLINE_DESCRIPTORS).sort(),
    );
  });

  for (const { entity, base, values, sanitize } of CASES) {
    for (const field of INLINE_DESCRIPTORS[entity].diffFields) {
      it(`${entity}.${field} survives sanitize`, () => {
        expect(field in values).toBe(true); // test data must cover every diff field
        const out = sanitize({ ...base, [field]: values[field] }) as Record<string, unknown> | null;
        expect(out).not.toBeNull();
        const raw = String(values[field]);
        const want = RICH_FIELDS.has(`${entity}.${field}`) ? descriptionHtml(raw, "rich") : raw;
        expect(String(out![field])).toBe(want);
      });
    }
  }
});
