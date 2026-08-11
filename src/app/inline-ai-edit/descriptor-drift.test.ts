import { describe, it, expect } from "vitest";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { RICH_FIELDS } from "./plan";
import { sanitizeRaidItem, sanitizeChangeItem, sanitizeMilestone, sanitizeStakeholder } from "../sanitize";
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
// set but unreached — CASES covers the four sanitizer-backed entities only.

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

const CASES = [
  { entity: "raid" as const, base: RAID_BASE, values: RAID_VALUES, sanitize: sanitizeRaidItem },
  { entity: "change" as const, base: CHANGE_BASE, values: CHANGE_VALUES, sanitize: sanitizeChangeItem },
  { entity: "milestone" as const, base: MILE_BASE, values: MILE_VALUES, sanitize: sanitizeMilestone },
  { entity: "stakeholder" as const, base: STK_BASE, values: STK_VALUES, sanitize: sanitizeStakeholder },
];

describe("descriptor diffFields are dispatcher-writable", () => {
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
