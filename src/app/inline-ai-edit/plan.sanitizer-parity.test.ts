import { describe, it, expect } from "vitest";
import { describeEntityCalls, previewNormalizerFor, RICH_FIELDS, type ToolUseLike } from "./plan";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./entity-descriptor";
import {
  sanitizeChangeItem,
  sanitizeMilestone,
  sanitizeRaidItem,
  sanitizeResource,
  sanitizeStakeholder,
} from "../sanitize";
import { buildTaskCleanPatch } from "../chat-task-patch";
import { applyStatusChange, isTaskStatus } from "../task-status";
import { type Task } from "../types";
import type { Workspace } from "../workspace";

// ★★★ THE DIFFERENTIAL GATE ON `fieldSanitizers`. For EVERY entity, EVERY
// `diffField` and a hostile probe set, this pushes one value through the
// PREVIEW (`describeEntityCalls` — the production path behind both the chat
// review card and `insights/recommend-plan.ts`) and through that field's REAL
// apply-path sanitizer, and asserts the two agree.
//
// It exists because §373 closed the divergence for the four email-shaped fields
// its title named and left a dozen open: twelve fields were clipped by their
// sanitizer and absent from the descriptor, and the one BOOLEAN `diffField`
// was blanked outright, which — since `FieldDiff.raw` becomes the write patch —
// dropped a flag on APPLY rather than only in the card. Closing a class one
// member at a time is the register's best-recorded way to ship a false closure,
// so the contract is enumerated over `diffFields` rather than over a list
// somebody maintains: a new field, or a new entity, is covered the moment it is
// declared.
//
// THE CONTRACT: when the preview ACCEPTS a field, the string it shows (and puts
// in `FieldDiff.raw`) is what the apply path would STORE. Rejection parity —
// "the preview rejects everything apply would throw on" — is a DIFFERENT
// contract; the one place the two diverge today is enumerated in
// `APPLY_ONLY_REJECTS` rather than skipped silently.
//
// ★★ NO CROSS-TEST STATE. The totals check below recomputes the whole sweep
// inside its own body rather than reading counters the per-entity tests
// incremented — `npm run test:shuffle` shuffles test order WITHIN a file, so an
// accumulate-then-assert shape is a seed-dependent failure waiting to happen.

// --- probes ----------------------------------------------------------------

// ★ The surrogate probes are the shape §373's first cut got wrong: a cap landing
// between the two halves of an astral character. A bare `slice(0, cap)` keeps
// the LONE HIGH SURROGATE; `clipText` backs the cut off by one and drops the
// character whole. 319 fillers straddle EMAIL_MAX (320), 199 straddle
// BUDGET_NAME_MAX (200) — the caps in play here are 100 / 200 / 320 / 500 /
// 5000, so between them the two probes hit a real boundary on most fields and
// land mid-string on the rest.
const PROBES: ReadonlyArray<{ label: string; value: unknown }> = [
  { label: "a 6000-char string", value: "x".repeat(6000) },
  { label: "a surrogate straddling EMAIL_MAX", value: `${"f".repeat(319)}\u{1F600}` },
  { label: "a surrogate straddling BUDGET_NAME_MAX", value: `${"f".repeat(199)}\u{1F600}` },
  { label: "a padded string", value: "  padded  " },
  { label: "a CRLF multiline string", value: "  first\r\nsecond  " },
  { label: "the boolean true", value: true },
  { label: "the boolean false", value: false },
  { label: "the number 42", value: 42 },
  // ★★ THE "CLEAR THIS FIELD" VALUE, and the probe that found the number path's
  // divergence. `Number("")` is `0`, so an int-range guard starting at 0 ACCEPTS
  // it — the change fields previewed `""` where the sanitizer stores `0`. It is
  // also the one value `emailFormatFields` carves out explicitly (`after !== ""`),
  // so it exercises that exemption rather than the guard beside it.
  // ★ It splits the four number fields on their RANGE, which is why it is worth
  // keeping on both: `change.scheduleImpactDays`/`costImpact` range `[0, ∞)`, so
  // 0 is in range and the pair is COMPARED (`"0"` on both sides). `raid.
  // probability`/`impact` range `[1, 5]`, so 0 falls out and the preview
  // REJECTS — while `sanitizeRaidItem` would have dropped the key, i.e. cleared
  // the field. Preview refusing where apply would clear is the safe direction,
  // so it is counted as a preview-only rejection rather than a mismatch.
  { label: "the empty string", value: "" },
];

// --- fixtures --------------------------------------------------------------
//
// One VALID stored row per entity — the full-record sanitizers reject a row
// missing a required field, and a rejected row cannot tell a normalisation
// defect from a fixture defect. Each carries a non-empty value for as many diff
// fields as it can, so `before` is a real value and a preview that dropped the
// field entirely could not read as agreement.

const TASK_BASE = {
  id: 1, taskName: "T", assignee: "Ann", assigneeEmail: "a@b.co", dueDate: "2026-01-01",
  status: "To Do", priority: "Medium", description: "", blockers: "b", group: "G", labels: [],
} as unknown as Task;
const RAID_BASE = {
  id: 1, category: "R", title: "T", status: "Open", raisedDate: "2026-01-01",
  owner: "Ann", ownerEmail: "a@b.co", severity: "High", probability: 3, impact: 4,
};
const CHANGE_BASE = {
  id: 1, title: "T", type: "Other", status: "Proposed", raisedDate: "2026-01-01",
  impact: "High", requestedBy: "Ann", decisionBy: "Bob",
};
const MILE_BASE = { id: 1, name: "M", date: "2026-01-01" };
const STK_BASE = {
  id: 1, name: "S", category: "Other", influence: "Medium", interest: "Medium", raci: {},
  organization: "Org", title: "CTO", email: "a@b.co", notes: "n",
};
// ★ BOTH name parts: `sanitizeResource` returns null when both are empty, so a
// one-part base would make every probe on the OTHER part read as a rejection.
const RES_BASE = {
  id: 1, firstName: "Ada", lastName: "Lovelace", title: "CTO", email: "a@b.co",
  department: "Delivery", company: "AIPM", location: "Berlin", businessPhone: "+49 30 1",
  notes: "n",
};

/** What the field holds after the apply path runs, rendered as the preview
 *  renders it — or `null` when the write would be REJECTED outright (the
 *  sanitizer returns null, or the patch builder throws), which is not a value. */
type StoredReader = (field: string, value: unknown) => string | null;

/** ★★ `isExternal` IS READ AS A PREDICATE, NOT AS A KEY, and that asymmetry is
 *  the field's storage shape rather than a convenience: `sanitizeResource` sets
 *  the key ONLY when the flag is true, so an internal resource has no key at all
 *  and `String(out.isExternal ?? "")` would render `""` for a stored `false`.
 *  The preview renders the same predicate, via `isExternalFlag`. */
function readStored(out: Record<string, unknown>, field: string): string {
  if (field === "isExternal") return String(out.isExternal === true);
  return String(out[field] ?? "");
}

function sanitizerReader(
  base: Record<string, unknown>,
  sanitize: (input: unknown) => Record<string, unknown> | null,
): StoredReader {
  return (field, value) => {
    const out = sanitize({ ...base, [field]: value });
    return out ? readStored(out, field) : null;
  };
}

/** The task apply path is NOT a full-record sanitizer — `use-chat-dispatcher.ts`
 *  composes `buildTaskCleanPatch` with `applyStatusChange`, guarded by
 *  `isTaskStatus`. `status` is the one field `buildTaskCleanPatch` deliberately
 *  does not handle (its own docstring says why), so it is composed here.
 *
 *  ★★ COMPOSED FROM THE REAL FUNCTIONS, NOT MIRRORED. An earlier cut re-spelled
 *  the guard as an inline `TASK_STATUSES.includes(...)`, which is the exact
 *  drift class this file exists to catch: a predicate that stopped agreeing with
 *  the dispatcher's would have made the sweep agree with a preview that no
 *  longer matched the write. `isTaskStatus` was private to the dispatcher and is
 *  now exported from `task-status.ts` beside `applyStatusChange` — the two are
 *  one unit — so both halves of the composition below are the production ones.
 *  `today` is irrelevant to the returned `status` (it only stamps
 *  `completedDate`), so a fixed date is passed. */
const taskReader: StoredReader = (field, value) => {
  if (field === "status") {
    const merged = isTaskStatus(value)
      ? applyStatusChange(TASK_BASE, value, "2026-01-01")
      : TASK_BASE;
    return merged.status;
  }
  try {
    const patch = buildTaskCleanPatch({ [field]: value } as Partial<Task>, TASK_BASE);
    const stored = field in patch
      ? (patch as Record<string, unknown>)[field]
      : (TASK_BASE as unknown as Record<string, unknown>)[field];
    return String(stored ?? "");
  } catch {
    return null; // the dispatcher surfaces the throw as a failed tool call
  }
};

const CASES: ReadonlyArray<{
  entity: InlineEntity;
  base: Record<string, unknown>;
  read: StoredReader;
}> = [
  { entity: "task", base: TASK_BASE as unknown as Record<string, unknown>, read: taskReader },
  { entity: "raid", base: RAID_BASE, read: sanitizerReader(RAID_BASE, sanitizeRaidItem as never) },
  { entity: "change", base: CHANGE_BASE, read: sanitizerReader(CHANGE_BASE, sanitizeChangeItem as never) },
  { entity: "milestone", base: MILE_BASE, read: sanitizerReader(MILE_BASE, sanitizeMilestone as never) },
  { entity: "stakeholder", base: STK_BASE, read: sanitizerReader(STK_BASE, sanitizeStakeholder as never) },
  { entity: "resource", base: RES_BASE, read: sanitizerReader(RES_BASE, sanitizeResource as never) },
];

// --- explicit exclusions ---------------------------------------------------
//
// ★★★ EVERY EXCLUSION IS NAMED WITH ITS REASON AND ITS OWNER. A field skipped
// silently is indistinguishable from a field nobody thought about — which is
// exactly how §373 shipped covering four fields of sixteen.
//
// The RICH HTML fields are excluded as a class, enumerated from `RICH_FIELDS`
// rather than listed: their apply-path sanitizer is `sanitizeAiRichText` (DOM-
// bound, and this file is DOM-free) and their preview is deliberately a
// PLAIN-TEXT PROJECTION of the value rather than the value itself —
// `FieldDiff.raw` carries the verbatim HTML for precisely that reason.
// `descriptor-drift.test.ts` owns that pair.
const EXCLUDED_FIELDS: Readonly<Record<string, string>> = {
  // `sanitizeLabels` returns a string[] while the preview renders a comma-joined
  // string, and the two do not even split alike ("|" on apply, ", " shown). Not
  // a string-to-string comparison; pre-existing, outside §373, and owned by
  // `arrayFields` and its own tests.
  "task.labels": "array-valued: sanitizeLabels returns string[]; the preview joins with ', '",
};

/** ★★★ APPLY REJECTS WHERE THE PREVIEW ACCEPTS — a divergence in the OTHER
 *  direction, and this set is DELIBERATELY EMPTY. It is kept, rather than the
 *  branch deleted, because the sweep must have somewhere to put such a pair
 *  other than a silent skip.
 *
 *  ★★ IT WAS NOT EMPTY WHEN THIS FILE WAS WRITTEN. `task.assigneeEmail` sat
 *  here: `buildTaskCleanPatch` throws "assigneeEmail is invalid" when
 *  `isValidEmail` fails, nothing in `describeEntityCalls` checked an address's
 *  FORMAT (only its length, via `sanitizeEmail`), and a throw on apply fails
 *  the WHOLE patch — so a malformed address previewed as an accepted diff and
 *  then destroyed every other field in the same edit. That is now closed by
 *  `emailFormatFields`, so the exception was removed rather than kept.
 *
 *  ★ ADDING A NAME HERE IS A LAST RESORT, never the way to make a red run
 *  green: the entry's own reason has to say why the preview cannot mirror the
 *  rejection, and "it is inconvenient" is not one. */
const APPLY_ONLY_REJECTS: ReadonlySet<string> = new Set<string>([
]);

// --- the differential ------------------------------------------------------

interface Outcome { rejected: boolean; shown: string }

function previewOf(
  entity: InlineEntity,
  base: Record<string, unknown>,
  field: string,
  value: unknown,
): Outcome {
  const d = INLINE_DESCRIPTORS[entity];
  const ws = { [d.wsKey]: [base] } as unknown as Workspace;
  const block: ToolUseLike = { type: "tool_use", name: d.updateTool, input: { id: 1, [field]: value } };
  const plan = describeEntityCalls([block], { descriptor: d, item: base as { id: number }, ws });
  if (plan.rejected.some((r) => r.detail.startsWith(`${field}=`))) return { rejected: true, shown: "" };
  const diff = plan.updates.find((u) => u.field === field);
  if (diff) return { rejected: false, shown: diff.raw ?? diff.after };
  // NO diff is itself a claim — "applying this stores what is already there" —
  // so it is compared like any other outcome. Reading it as "nothing to check"
  // is how a preview that silently drops a field passes a parity test.
  // ★ DELEGATED, not restated: `previewNormalizerFor` is the production
  // resolution order (descriptor entry → numeric coercion → verbatim), so a
  // field moving between those three cannot leave this branch behind.
  const normalize = previewNormalizerFor(d, field);
  return {
    rejected: false,
    shown: normalize ? normalize(base[field]) : String(base[field] ?? ""),
  };
}

const fieldsUnderTest = (entity: InlineEntity): string[] =>
  INLINE_DESCRIPTORS[entity].diffFields.filter(
    (f) => !RICH_FIELDS.has(`${entity}.${f}`) && !(`${entity}.${f}` in EXCLUDED_FIELDS),
  );

/** The fields the probe set can actually get a COMPARISON out of — everything
 *  under test except the enum and date fields.
 *
 *  ★★ THE EXCLUSION IS DELIBERATELY WIDER THAN THE SET THAT YIELDS NOTHING, and
 *  the two numbers must not be conflated. It drops 20 of the 52 fields under
 *  test (11 enum + 9 date); only 13 of those actually contribute zero
 *  comparisons — the 11 enum fields plus `task.dueDate` and `milestone.date`.
 *  The other SEVEN date fields each contribute exactly one: `raid.raisedDate`,
 *  `raid.targetDate`, `raid.closedDate`, `change.raisedDate`,
 *  `change.decisionDate`, `milestone.achievedDate`, `task.lastUpdateDate`. The date guard is
 *  `after !== "" && sanitizeIsoDate(after) !== after`, so the EMPTY-STRING probe
 *  sails straight through it, and the two fields that still yield nothing are
 *  the ones `requiredNonEmpty` catches first.
 *
 *  ★★★ THAT IS WHY THIS PARAGRAPH NO LONGER CLAIMS "ZERO BY CONSTRUCTION". It
 *  did, and said so as a MEASUREMENT — "exactly the 11 enum fields plus
 *  `task.dueDate` and `milestone.date`, 13 of the 50" — which was true when
 *  written and was falsified by the empty-string probe added in the SAME round,
 *  a few hundred lines up. Excluding a field that does compare is conservative
 *  (it shrinks the denominator, never the numerator) so no floor was wrong; the
 *  sentence was. Re-measure both counts whenever `PROBES` changes.
 *
 *  ★ Derived from the descriptor rather than listed, so a new enum/date field
 *  classifies itself and a new TEXT field is held to the floor the moment it is
 *  declared. */
const comparableFields = (entity: InlineEntity): string[] => {
  const d = INLINE_DESCRIPTORS[entity];
  return fieldsUnderTest(entity).filter((f) => !(f in d.enumFields) && !d.dateFields.has(f));
};

/** ★ The three buckets PARTITION the enumerated pairs, and the totals test below
 *  asserts exactly that — so a pair the sweep silently failed to classify is a
 *  red run rather than a quietly smaller comparison count. `comparedByField`
 *  carries the per-field split the structural floor needs. */
interface Sweep {
  mismatches: string[];
  compared: number;
  previewOnlyRejects: number;
  applyRejects: number;
  comparedByField: Record<string, number>;
}

/** One entity's full sweep. Returns every disagreement rather than throwing at
 *  the first, so a broken normalisation shows its whole blast radius at once. */
function sweep(entity: InlineEntity, base: Record<string, unknown>, read: StoredReader): Sweep {
  const out: Sweep = { mismatches: [], compared: 0, previewOnlyRejects: 0, applyRejects: 0, comparedByField: {} };
  for (const field of fieldsUnderTest(entity)) {
    const key = `${entity}.${field}`;
    for (const { label, value } of PROBES) {
      const stored = read(field, value);
      const preview = previewOf(entity, base, field, value);
      if (stored === null) {
        out.applyRejects += 1;
        // Apply would reject outright. The preview must reject too, unless the
        // pair is one of the enumerated known gaps.
        if (APPLY_ONLY_REJECTS.has(key)) continue;
        if (!preview.rejected) out.mismatches.push(`${key} on ${label}: apply REJECTS, preview accepts "${preview.shown}"`);
        continue;
      }
      if (preview.rejected) {
        // Preview rejects where apply would have stored something. The safe
        // direction — nothing is written — and the enum/date/range guards
        // deliberately over-reject; the descriptor's own comments say so.
        out.previewOnlyRejects += 1;
        continue;
      }
      out.compared += 1;
      out.comparedByField[field] = (out.comparedByField[field] ?? 0) + 1;
      if (preview.shown !== stored) {
        out.mismatches.push(`${key} on ${label}: preview ${JSON.stringify(preview.shown)} ≠ stored ${JSON.stringify(stored)}`);
      }
    }
  }
  return out;
}

describe("preview normalisation matches the apply path's sanitizer", () => {
  for (const { entity, base, read } of CASES) {
    it(`${entity}: every diffField previews what apply stores`, () => {
      const result = sweep(entity, base, read);
      expect(result.mismatches).toEqual([]);
      // Per-entity anti-vacuity: a fixture whose every probe got rejected, or a
      // mistyped tool name that produced an empty plan, would otherwise pass.
      expect(result.compared).toBeGreaterThan(0);
      expect(fieldsUnderTest(entity).length).toBeGreaterThan(0);
    });
  }

  // ★ Recomputed here rather than accumulated across the tests above, so the
  // file is order-independent under `npm run test:shuffle`.
  it("compares a meaningful number of value pairs overall", () => {
    const sweeps = CASES.map((c) => ({ entity: c.entity, s: sweep(c.entity, c.base, c.read) }));
    const sum = (pick: (s: Sweep) => number): number => sweeps.reduce((n, x) => n + pick(x.s), 0);
    const compared = sum((s) => s.compared);

    // ★★★ THREE DERIVED FLOORS, NONE OF THEM A PINNED COUNTER. The previous pair
    // was a hardcoded 120 plus `compared > rejected / 2`; at the MEASURED 192/175
    // the second one held all the way down to 88 comparisons, so it could not
    // have noticed the sweep losing half of them. Every floor below is computed
    // from `diffFields` × `PROBES`, so adding a field, a probe or an entity moves
    // the floor with it and needs no re-baseline — and none of them can be
    // satisfied by a sweep that quietly stopped comparing.

    // (1) PARTITION. Every enumerated pair lands in exactly one bucket, so a
    // pair the sweep skipped — a `continue` added to the wrong branch, a probe
    // swallowed by an early return — makes the arithmetic fail rather than
    // silently shrinking the comparison count.
    const enumerated = CASES.reduce((n, c) => n + fieldsUnderTest(c.entity).length * PROBES.length, 0);
    expect(compared + sum((s) => s.previewOnlyRejects) + sum((s) => s.applyRejects)).toBe(enumerated);
    expect(enumerated).toBeGreaterThan(0);

    // (2) STRUCTURAL, per field and reported BY NAME. Every comparable field
    // (see `comparableFields`) must get at least one probe all the way through
    // to a comparison. This is the tight one: a guard that starts rejecting
    // everything for ONE field fails here naming that field, where any aggregate
    // floor would absorb it as a few percent.
    const silent = sweeps.flatMap(({ entity, s }) =>
      comparableFields(entity)
        .filter((f) => (s.comparedByField[f] ?? 0) === 0)
        .map((f) => `${entity}.${f}`),
    );
    expect(silent).toEqual([]);

    // (3) AGGREGATE, as a fraction of what the comparable fields could yield.
    // MEASURED 2026-09-05: 244 comparisons over 32 comparable fields × 9 probes
    // = 288 possible, i.e. 85%. (It was 234/279/84% until §383 added
    // `resource.emails` — a 32nd comparable field, +9 — and `task.lastUpdateDate`,
    // a DATE field that is NOT comparable yet still contributes its one
    // empty-string comparison, +1: which is why the numerator moved by 10 and
    // the denominator by 9.) (It was 226/81% until §384 turned the resource
    // name parts' joint rule into a group: the four probes that blank a part —
    // `true`, `false`, `42`, `""` — used to be preview-only REJECTIONS on both
    // `firstName` and `lastName`, and are now comparisons that agree. The floor
    // is computed, so nothing had to move with them; the COMMENT did.)
    // Half is the floor, so a ~38% collapse fails
    // while the ordinary churn of a probe that a new field happens to reject
    // does not.
    // ★★ THE FOUR FIGURES ABOVE WERE WRONG ON FIRST WRITING (37 fields / 333
    // possible / 68% / and 74% below) and were caught by a review that printed
    // them from inside this test rather than re-deriving them. The floors are
    // computed, so nothing went red — a wrong denominator in a COMMENT is
    // invisible to every gate. Print them, do not reason them:
    // `console.log` the reduce results here and run this file alone.
    const possible = CASES.reduce((n, c) => n + comparableFields(c.entity).length * PROBES.length, 0);
    // ★★★ THE DENOMINATOR NEEDS ITS OWN FLOOR, and this line was added after a
    // mutant proved the first cut vacuous: narrowing `comparableFields` to
    // return NOTHING left `silent` empty and `possible` zero, so both floors
    // above passed with the whole differential switched off (measured: 7 passed,
    // EXIT=0). Pinning the comparable pairs to a majority of the ENUMERATED ones
    // — 288 of 468, i.e. 62%, on 2026-09-05 — means the denominator cannot be
    // shrunk to make the numerator look good.
    expect(possible).toBeGreaterThan(enumerated / 2);
    expect(compared).toBeGreaterThan(possible / 2);
  });
});
