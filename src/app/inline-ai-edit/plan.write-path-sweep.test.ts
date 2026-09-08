// src/app/inline-ai-edit/plan.write-path-sweep.test.ts
//
// THE MECHANICAL SWEEP over the inline-AI-edit write path, and the deliberate
// sibling of `plan.write-path.test.ts`.
//
// ★★★ THE TWO ARE NOT MERGED, AND MERGING THEM BACK IS A REGRESSION. That file
// is narrow and DEEP: each of its cases names a specific defect, and that name
// is what a red run tells you ("a refused category leaves the coupled status
// alone"). This file is broad and MECHANICAL: it names nothing and enumerates
// everything, so a red run here says an ENTITY's coverage moved rather than
// which behaviour broke. Folded together they would trade a legible failure for
// a uniform one — a case-shaped assertion buried in a `describe.each` over eight
// entities reads as "the sweep is red" and costs a bisect to get back the name
// the split gives away for free.
//
// ★★ THE COST WAS PAID KNOWINGLY. A third `environment: "jsdom"` test file is
// roughly 25-30s of environment setup that the merged file did not pay, and it
// was accepted in exchange for headroom: the combined file stood at 1354 lines
// against the 1600 `LIMIT` in `scripts/check-file-sizes.mjs` (it is not
// baselined, so the limit alone governs it) with a probe layer and three parity
// relations still to land. Do not "helpfully" re-merge them to win the setup
// back — the next slice would immediately breach the ratchet, and the ratchet is
// the thing that forced this split in the first place.
//
// It exists for the gap between the two detectors that already existed:
// `plan.sanitizer-parity.test.ts` is exhaustive and shallow (it compares the
// preview against each field's SANITIZER, so it cannot see a merge-site guard
// it does not compose), and the `CASES` in `plan.write-path.test.ts` are narrow
// and deep. The gap is a divergence at a layer the sanitizer cannot show, in a
// field nobody wrote a case for — which is `docs/open-followups.md` §394 and
// §418.
//
// ★ Everything it drives lives in `src/test/inline-sweep-fixtures.ts`, shared
// with its sibling so the two suites cannot seed different rows and disagree
// about what was covered. The docstrings there are load-bearing; read them
// before touching a seeded value.
import { describe, expect, it } from "vitest";
import {
  AXIS_FIELDS,
  JUNK_KEY,
  SWEEP,
  sweepPlumbing,
  sweptFields,
} from "../../test/inline-sweep-fixtures";
import { TOKEN_ROW_SOURCE } from "../chat-proposal-apply";
import { emptyWorkspace, type Workspace } from "../workspace";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";

describe("the sweep's own coverage", () => {
  // ★★ THE ONE MAINTAINED THING IN THE SWEEP, AND ITS GUARD. A new FIELD is
  //  covered the moment it exists, because the axis is derived at runtime. A new
  //  ENTITY is not — nothing would enumerate it — so the table is asserted exact
  //  rather than merely non-empty. `plan.sanitizer-parity.test.ts` uses the same
  //  trick on its own CASES; copying it is deliberate.
  it("has a row for every INLINE_DESCRIPTORS entity, and no others", () => {
    expect(SWEEP.map((s) => s.entity).sort()).toEqual(Object.keys(INLINE_DESCRIPTORS).sort());
  });

  // ★★★ THE GUARD AGAINST A FABRICATED CLEAN, and it is not hypothetical: the
  //  first cut of this table carried `id: 7` for the resource row against a
  //  seed that mints 4. Nothing consumed it yet, so every gate was green. Had
  //  the sweep landed on top of it, that entity would have reported perfect
  //  preview/write agreement over a row the fixture never wrote — the sweep
  //  would have certified itself across one of eight entities.
  //  An id is the ONE column production code cannot supply, so it is the one
  //  that needs a positive observable rather than a derivation.
  it("seeds the row each entity claims to drive", () => {
    const missing = SWEEP.filter((s) => {
      const { wsKey } = sweepPlumbing(s.entity);
      const rows = (s.seed as Record<string, readonly { id: number }[] | undefined>)[wsKey];
      return !rows?.some((r) => r.id === s.id);
    }).map((s) => `${s.entity}#${s.id}`);
    expect(missing).toEqual([]);
    // Anti-vacuity: prove the check above ran over a non-empty set, so a seed
    // shape change that silently emptied SWEEP could not read as agreement.
    expect(SWEEP.length).toBe(Object.keys(INLINE_DESCRIPTORS).length);
  });

  // ★★★ THE GENERAL FORM OF THE SEED HOLE, across all eight entities. A probe
  //  on a field the seed left absent or blank compares the refusal against
  //  nothing and scores AGREEMENT — the sweep would certify the very divergence
  //  it exists to find. `seedGuardedTask` was written because the task row had
  //  this hole in `group` and `labels`; this assertion is what stops the next
  //  entity from acquiring it silently.
  //
  //  ★★★ IT ITERATES THE WHOLE `sweptFields` AXIS, NOT `diffFields`. That is not
  //   a widening at the margin: `diffFields` and `linkFields` are DISJOINT by
  //   construction, so the narrow form could not see a single FK or relationship
  //   array on any entity, nor anything reaching the axis through the §418
  //   stored-row half. Every hole it was silent on fell in exactly those two
  //   classes — the FKs (`resource.roleId` null, `absence.resourceId` absent),
  //   the id lists (`[]` on raid, change, milestone and the meeting's
  //   attendees) and the maps (`stakeholder.raci`, `resource.utilization`, both
  //   `{}`). NO TALLY IS QUOTED: every seed edit moves it. Reproduce by
  //   reverting a seed value and reading the names this test prints.
  //
  //  ★★★ AN EMPTY ARRAY IS A HOLE, AND THE COMMENT THAT SAID OTHERWISE WAS HALF
  //   RIGHT. It read: "a link list that starts empty still distinguishes refused
  //   from stored, because a successful write makes it non-empty." That is true
  //   of the ACCEPT direction and FALSE of the CLEAR direction — every id list
  //   here is assigned UNCONDITIONALLY (`sanitizeIdList`, `sanitizeMilestone-
  //   TaskIds`, `sanitizeAttendees(v) ?? []`), so a REFUSED clear stores `[]`,
  //   which against an empty seed is the value already there. The seeds now
  //   carry non-empty lists instead of the blind spot being recorded.
  //  ★★ `{}` is the same argument for a MAP (`raci`, `utilization`,
  //   `absenceOverride`): `coerceRaciMap`/`coercePeriodMap` return `{}` for
  //   anything unrecognised, so an empty seed is the refusal's own output.
  //
  //  ★★ WHAT THIS CANNOT SEE, and it is not a small residue: an ENUM or a
  //   SCALAR sitting on its sanitizer's fallback is a hole of exactly the same
  //   kind and is indistinguishable from a legitimate value here — nothing in
  //   this loop knows that `"percent"` is `sanitizeUtilizationMode`'s default or
  //   that `"Other"` is `sanitizeStakeholder`'s. Those are held by hand, in each
  //   `seedGuarded*` docstring, and `resource.utilizationMode` was one of them.
  it("seeds a distinguishable value for every swept field", () => {
    const holes: string[] = [];
    for (const s of SWEEP) {
      const { wsKey } = sweepPlumbing(s.entity);
      const rows = (s.seed as Record<string, readonly Record<string, unknown>[] | undefined>)[wsKey];
      const row = rows?.find((r) => r.id === s.id);
      if (!row) continue; // the seeded-row test above owns that failure
      for (const field of sweptFields(s.entity, row)) {
        const v = row[field];
        const empty =
          v === undefined ||
          v === null ||
          v === "" ||
          (Array.isArray(v) && v.length === 0) ||
          (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
        if (empty) holes.push(`${s.entity}.${field}`);
      }
    }
    expect(holes).toEqual([]);
  });

  // Every entity must be REPLAYABLE. `sweepPlumbing` throws on a tool with no
  // TOKEN_ROW_SOURCE entry, so this is the assertion that turns "we never ran
  // it" into a red rather than into silence.
  it("derives replayable plumbing for every entity from production declarations", () => {
    for (const s of SWEEP) {
      const { tool, kind, wsKey } = sweepPlumbing(s.entity);
      expect(tool).toBe(INLINE_DESCRIPTORS[s.entity].updateTool);
      expect(wsKey).toBe(INLINE_DESCRIPTORS[s.entity].wsKey);
      expect(TOKEN_ROW_SOURCE[tool].kind).toBe(kind);
    }
  });

  // ★★ WHAT THIS FORBIDS IS A SWEEP OVER A STARVED AXIS, which passes
  //  everything it does not run. The recorded sets are PER ENTITY so one rich
  //  entity cannot carry a narrowed one, and each names its members rather than
  //  counting them — see `AXIS_FIELDS` for why a count and a flat floor were
  //  both rejected.
  it.each(SWEEP)("$entity sweeps every field its recorded axis names", ({ entity, id, seed }) => {
    // `wsKey` is DERIVED — it is not a field on SweepEntity. See sweepPlumbing.
    const { wsKey } = sweepPlumbing(entity);
    const ws = { ...emptyWorkspace(), ...seed } as unknown as Workspace;
    const rows = ws[wsKey] as ReadonlyArray<{ id: number }> | undefined;
    const before = rows?.find((r) => r.id === id);
    expect(before, `fixture did not seed ${wsKey} #${id}`).toBeDefined();
    const fields = sweptFields(entity, before as unknown as Record<string, unknown>);
    // A SUBSET check, so growth is free and only a shrink is red. Reported as
    // the missing NAMES rather than as two numbers: a count says an axis moved,
    // a name says which field stopped being swept.
    const dropped = AXIS_FIELDS[entity].filter((f) => !fields.includes(f));
    expect(
      dropped,
      `${entity} no longer sweeps ${dropped.join(", ")} — a SHRINKING axis un-sweeps fields silently`,
    ).toEqual([]);
    expect(fields).not.toContain("id");
    expect(fields).not.toContain(JUNK_KEY);
  });
});
