import { describe, it, expect } from "vitest";
import { describeEntityCalls, RICH_FIELDS, type ToolUseLike } from "./plan";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./entity-descriptor";
import {
  sanitizeChangeItem,
  sanitizeMilestone,
  sanitizeRaidItem,
  sanitizeResource,
  sanitizeStakeholder,
} from "../sanitize";
import { buildTaskCleanPatch } from "../chat-task-patch";
import { TASK_STATUSES, type Task } from "../types";
import type { Workspace } from "../workspace";

// ★★★ THE DIFFERENTIAL GATE ON `fieldSanitizers`. For EVERY entity, EVERY
// `diffField` and a hostile probe set, this pushes one value through the
// PREVIEW (`describeEntityCalls` — the production path behind both the chat
// review card and `insights/recommend-plan.ts`) and through that field's REAL
// apply-path sanitizer, and asserts the two agree.
//
// It exists because §373 closed the divergence for the four email-shaped fields
// its title named and left a dozen open: twelve fields were clipped by their
// sanitizer and absent from the descriptor, and the one non-string `diffField`
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
 *  composes `buildTaskCleanPatch` with `applyStatusChange`, guarded by a private
 *  `isTaskStatus`. Mirrored here in the same shape, because the composition is
 *  what actually runs; `status` is the one field `buildTaskCleanPatch`
 *  deliberately does not handle (its own docstring says why). */
const taskReader: StoredReader = (field, value) => {
  if (field === "status") {
    const kept = typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
    return String(kept ? value : TASK_BASE.status);
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
  const normalize = d.fieldSanitizers[field];
  return {
    rejected: false,
    shown: normalize ? normalize(base[field]) : String(base[field] ?? ""),
  };
}

const fieldsUnderTest = (entity: InlineEntity): string[] =>
  INLINE_DESCRIPTORS[entity].diffFields.filter(
    (f) => !RICH_FIELDS.has(`${entity}.${f}`) && !(`${entity}.${f}` in EXCLUDED_FIELDS),
  );

interface Sweep { mismatches: string[]; compared: number; previewOnlyRejects: number }

/** One entity's full sweep. Returns every disagreement rather than throwing at
 *  the first, so a broken normalisation shows its whole blast radius at once. */
function sweep(entity: InlineEntity, base: Record<string, unknown>, read: StoredReader): Sweep {
  const out: Sweep = { mismatches: [], compared: 0, previewOnlyRejects: 0 };
  for (const field of fieldsUnderTest(entity)) {
    const key = `${entity}.${field}`;
    for (const { label, value } of PROBES) {
      const stored = read(field, value);
      const preview = previewOf(entity, base, field, value);
      if (stored === null) {
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
    const totals = CASES.reduce(
      (acc, c) => {
        const s = sweep(c.entity, c.base, c.read);
        return { compared: acc.compared + s.compared, rejected: acc.rejected + s.previewOnlyRejects };
      },
      { compared: 0, rejected: 0 },
    );
    // ★★ BOTH HALVES MATTER. The first proves the differential ran at all; the
    // second proves rejection did not swallow it — an enum/date/range guard
    // that started rejecting everything would otherwise leave a green run over
    // almost no comparisons. MEASURED 2026-09-05 by over-raising each floor and
    // reading the failure: 192 compared, 175 preview-only rejections. Both
    // floors sit well under that so routine descriptor growth needs no
    // re-baseline, but a collapse to a handful still fails.
    expect(totals.compared).toBeGreaterThan(120);
    expect(totals.compared).toBeGreaterThan(totals.rejected / 2);
  });
});
