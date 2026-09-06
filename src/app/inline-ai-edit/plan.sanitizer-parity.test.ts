import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { describeEntityCalls, previewNormalizerFor, RICH_FIELDS, type ToolUseLike } from "./plan";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./entity-descriptor";
import {
  dropUnacceptedChangeFields,
  dropUnacceptedMilestoneFields,
  dropUnacceptedRaidFields,
  dropUnacceptedStakeholderFields,
  sanitizeChangeItem,
  sanitizeMilestone,
  sanitizeRaidItem,
  sanitizeResource,
  sanitizeStakeholder,
} from "../sanitize";
import { buildTaskCleanPatch } from "../chat-task-patch";
import { applyModelChangeStatus } from "../change-log";
import { applyStatusChange, isTaskStatus } from "../task-status";
import { type ChangeStatus, type RaidItem, type Task } from "../types";
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
// THE CONTRACT, IN BOTH DIRECTIONS:
//  • the preview ACCEPTS a field ⇒ the string it shows (and puts in
//    `FieldDiff.raw`) is what the apply path would STORE;
//  • the preview REJECTS a field ⇒ the replayed write leaves that field where it
//    was. Enumerated gaps in `PREVIEW_REJECTS_APPLY_WRITES`.
// A third relation — "the preview rejects everything apply would throw on" — is
// a DIFFERENT contract again; its gaps go in `APPLY_ONLY_REJECTS`.
//
// ★★★ THE SECOND BULLET IS NEW, AND ITS ABSENCE MADE THIS FILE VACUOUS AGAINST
// THE VERY DEFECT THE SLICE IS NAMED AFTER. The rejects branch used to
// `continue` under a comment reading "the safe direction — nothing is written",
// which is true of the REBUILDING consumer (`use-inline-entity-edit.ts` rebuilds
// its patch from `plan.updates`) and false of both REPLAYING ones
// (`chat-proposal-apply.ts`, `use-insight-recommendations.ts` resend the
// ORIGINAL `ProposedCall.input` and never read the plan). Measured, not argued:
// running the mutant that RESTORES §384 turned five `plan.test.ts` tests red
// while this differential stayed GREEN throughout, because it `continue`d before
// comparing anything.
//
// ★★★ WHAT THIS SWEEP STILL CANNOT SEE, measured 2026-09-05:
//  (1) it compares the preview against the SANITIZER, never against a REPLAY, so
//      a DISPATCHER-level derivation (`use-chat-dispatcher.ts` re-deriving the
//      name parts via `splitName`) is invisible here. ★ `plan.write-path.test.ts`
//      now owns that: it replays through the REAL dispatcher (`runTool` over
//      `useChatDispatcher`, via the shared `src/test/chat-dispatcher-fixture.tsx`)
//      and reads back from the LIVE workspace, so the split, the joint guard and
//      the single-FK link are all exercised for real. `use-chat-dispatcher.test.tsx`
//      still owns the per-writer unit assertions.
//      ★★ THAT FILE DID NOT EXIST WHEN THIS COMMENT WAS FIRST WRITTEN, and the
//      comment said so — correctly at the time, and falsely one commit later.
//      A filename in a test comment is ungated either way (`docs:symbols:check`
//      reads only AGENTS.md + `docs/AGENTS/*.md`), so re-check it, do not trust it.
//  (2) `previewOf` overrides exactly ONE key per probe, so a JOINT guard
//      (`!firstName && !lastName`) is never exercised jointly — every group
//      member's sibling stays populated, so `requiredNonEmptyGroups` never
//      refuses and `sanitizeResource`'s own OR gate never returns null.
//  (3) no probe sets `name` on the RESOURCE entity — it is absent from that
//      descriptor's `diffFields` — so the `splitName` WRITE ALIAS is never
//      exercised, on either side. ★ Read that as the resource alias ALONE:
//      `milestone.name` and `stakeholder.name` ARE probed, but there `name` is a
//      stored field rather than an alias, so they say nothing about it.
//      ★ (2) and (3) remain true OF THIS SWEEP and are no longer uncovered:
//      `plan.write-path.test.ts`'s mononym case exercises the joint guard and
//      the `name` alias together, against the real dispatcher. Read them as this
//      file's boundaries, not as holes in the suite.
//  (4) EVERY REQUIRED ENUM'S FIXTURE VALUE COINCIDES WITH ITS SANITIZER'S
//      HARDCODED FALLBACK, so the silent-reset half of the rejects direction is
//      unexercised. `task.status`/`priority`, `raid.category`/`status`,
//      `change.type`/`status`, `stakeholder.category`/`influence`/`interest` all
//      read back the value they already held when fed a refused value, and
//      `change.impact` — an OPTIONAL key with no fallback — used to be the one
//      that moved and the one enum in the exception list. A row whose enum is
//      NOT the default would be silently RESET with the card showing nothing.
//      Do NOT "fix" this by editing a fixture: that manufactures reds outside
//      the direction under test. Reproduce by printing `base[f]` beside
//      `read(f, 42)` for each `enumFields` key.
//      ★★ THE RAID AND CHANGE ENUMS ARE NO LONGER A BLIND SPOT, though this
//      sweep still cannot SEE that: `dropUnacceptedRaidFields` drops a refused
//      `category`/`status` and `dropUnacceptedChangeFields` a refused
//      `type`/`impact` at the MERGE SITE, so the stored value survives whatever
//      the fixture happens to hold — including raid's coupling, where an
//      unrecognised category used to fall back to "R" and drag a non-risk
//      `status` to "Open" with it. `sanitize-raid-patch.test.ts` and
//      `sanitize-change-patch.test.ts` pin those on NON-default rows, which are
//      the fixtures this file must not grow.
//      ★ `change.status` is the one guarded by neither table: `updateChange`
//      hands it to `applyModelChangeStatus` after the sanitizer, which is why
//      `changeReader` composes that too.
//  (5) WAS a blind spot and is now the sweep's proof for §396, so do NOT strip
//      `lastUpdateDate` back out of `TASK_BASE`. While the fixture carried none,
//      `taskReader`'s `?? ""` fallback rendered "" for a dropped key and the
//      preview rendered "" for the clear, so `update_task({lastUpdateDate: ""})`
//      compared "" against "" and said nothing — green before AND after the
//      writer changed, for the same non-reason. This is (4)'s shape only in
//      form: (4) forbids editing a fixture to manufacture a red OUTSIDE the
//      direction under test, whereas a populated `lastUpdateDate` puts a real
//      stored value on the other side of the one probe that IS the direction
//      under test. Mutation-proved: revert `buildTaskCleanPatch`'s clear branch
//      and this file reds naming `task.lastUpdateDate on the empty string`.
//      ★ It moves no count — the other nine probes are preview-only rejections
//      either way, and `unchanged` simply becomes the stored date instead of "".
//  (6) IT CANNOT SEE A MERGE-SITE GUARD IT DOES NOT COMPOSE, which is (1) narrowed
//      to the shape that has actually shipped twice. Every reader but `resource`
//      composes one because one exists; `resource` has none to compose, so its
//      reader is faithful TODAY and would go silently stale the day that changes
//      — exactly how the raid guard left four stale `PREVIEW_REJECTS_APPLY_WRITES`
//      entries excusing closed defects, and the change guard two. Closed for
//      `resource` by the source assertion at the BOTTOM of this file, which reds
//      when anything is inserted between the model's patch and `sanitizeResource`.
//      ★★ That arms the RECURRENCE, not the blindness: the sweep still could not
//      evaluate such a guard, it can only no longer fail to hear about one.
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
  // ★★★ THE ONLY PROBE ANY RISK-SCALE FIELD ACCEPTS, and it had to be added
  // when §395 landed. Until then `raid.probability`/`impact` reached a
  // COMPARISON on exactly one probe — the boolean `true`, which both sides
  // coerced to a fabricated 1. Refusing the boolean therefore left both fields
  // rejecting all nine probes, and the per-field silence check below caught it
  // BY NAME: the differential's entire coverage of those two fields had been
  // resting on the defect it exists to detect. 3 is inside [1,5] and >= 0, so
  // it is a comparison on all four number fields rather than a raid-only patch.
  { label: "the number 3", value: 3 },
  // ★★ THE "CLEAR THIS FIELD" VALUE, and the probe that found the number path's
  // divergence. `toNumber("")` is `0`, which a guard admitting 0 ACCEPTS — the
  // change fields previewed `""` where the sanitizer stores `0`. It is
  // also the one value `emailFormatFields` carves out explicitly (`after !== ""`),
  // so it exercises that exemption rather than the guard beside it.
  // ★ It splits the four number fields on their FLOOR, which is why it is worth
  // keeping on both: both change amounts admit 0 — §399 tightened them in other
  // respects (days to an integer, cost to two decimals under AMOUNT_MAX) but
  // left the floor where it was — so 0 is accepted and the pair is COMPARED (`"0"` on both
  // sides). `acceptsRiskScale` demands [1,5], so 0 falls out and the preview
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

// ★★ `lastUpdateDate` is NOT decoration — see limitation (5) at the top. Without
// a stored value here the empty-string probe compares "" against "" and the
// sweep is silent on the one field whose clear it is meant to police.
const TASK_BASE = {
  id: 1, taskName: "T", assignee: "Ann", assigneeEmail: "a@b.co", dueDate: "2026-01-01",
  lastUpdateDate: "2026-01-02",
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

/** The RAID apply path is NOT a bare full-record sanitizer either. `updateRaid`
 *  (`use-register-tools.ts`) runs the model's patch through
 *  `dropUnacceptedRaidFields` BEFORE merging it over the stored row, so a value
 *  `sanitizeRaidItem` would refuse leaves the stored one alone instead of
 *  clearing it (or resetting it to a hardcoded default).
 *
 *  ★★ COMPOSED FROM THE REAL FUNCTIONS, for the reason `taskReader` gives: a
 *  re-spelled guard is the exact drift this file exists to catch, and reading
 *  the raw sanitizer here made the sweep blind to the merge-site fix — the four
 *  raid entries in `PREVIEW_REJECTS_APPLY_WRITES` went on firing after the
 *  divergence they named was closed, i.e. the exception list would have kept
 *  granting cover to a defect that no longer existed. */
/** The MILESTONE apply path, composed for the same reason as the two below.
 *  `updateMilestone` runs the model's patch through
 *  `dropUnacceptedMilestoneFields` before merging it over the stored row, so a
 *  refused `achievedDate` leaves the stored date alone instead of clearing it.
 *
 *  ★★ This entity had NO stale entry to un-cover when the guard landed — the
 *  exception map was already empty by then — so the red-on-stale proof the raid
 *  and change readers earned was not available here. Composed anyway, and that
 *  is the point: a raw-sanitizer reader would leave milestone permanently blind
 *  to any future merge-site guard, and the absence of a failing test is exactly
 *  what makes that blindness cheap to ship. */
/** The STAKEHOLDER apply path. ★★★ This entity's guard was added LAST and only
 *  because a review probe went looking: its three enums RESET to a hardcoded
 *  fallback, and `STK_BASE` holds exactly those fallbacks, so every refused
 *  value read back as the value already there and this sweep recorded
 *  agreement. Moving the fixture off its defaults measured 27 mismatch pairs —
 *  a stored "Sponsor" silently demoted to "Other" by a card showing nothing.
 *  ★ Do NOT move `STK_BASE` off its defaults to "prove" that here: blind spot
 *  (4) above is about fixtures, and manufacturing a red inside this file is the
 *  thing it tells you not to do. `sanitize-stakeholder-patch.test.ts` pins it on
 *  a non-default row, which is where such a fixture belongs. */
const stakeholderReader: StoredReader = (field, value) => {
  const patch = dropUnacceptedStakeholderFields({ [field]: value });
  const out = sanitizeStakeholder({ ...STK_BASE, ...patch });
  return out ? readStored(out as unknown as Record<string, unknown>, field) : null;
};

const milestoneReader: StoredReader = (field, value) => {
  const patch = dropUnacceptedMilestoneFields({ [field]: value });
  const out = sanitizeMilestone({ ...MILE_BASE, ...patch });
  return out ? readStored(out as unknown as Record<string, unknown>, field) : null;
};

const raidReader: StoredReader = (field, value) => {
  const patch = dropUnacceptedRaidFields(
    { [field]: value },
    RAID_BASE as unknown as Pick<RaidItem, "category">,
  );
  const out = sanitizeRaidItem({ ...RAID_BASE, ...patch });
  return out ? readStored(out as unknown as Record<string, unknown>, field) : null;
};

/** The CHANGE apply path is not a bare full-record sanitizer either, and it is
 *  the one with TWO production steps around the sanitizer rather than one.
 *  `updateChange` (`use-register-tools.ts`) runs the model's patch through
 *  `dropUnacceptedChangeFields` BEFORE merging it over the stored row — so a
 *  value `sanitizeChangeItem` would refuse leaves the stored one alone instead
 *  of clearing it or resetting it to "Other" — and then hands the merged row to
 *  `applyModelChangeStatus`, which owns `status` and its coupled
 *  `decisionDate`. Both are composed here.
 *
 *  ★★ COMPOSED FROM THE REAL FUNCTIONS, for the reason `taskReader` gives: a
 *  re-spelled guard is the exact drift this file exists to catch, and reading
 *  the raw sanitizer here made the sweep blind to the merge-site fix — the two
 *  change entries in `PREVIEW_REJECTS_APPLY_WRITES` went on firing after the
 *  divergence they named was closed, i.e. the exception list would have kept
 *  granting cover to defects that no longer existed.
 *
 *  ★ `raw` is the probe value ONLY on the `status` field. Everywhere else the
 *  model sent no status, which is exactly the `undefined` that makes
 *  `applyModelChangeStatus` keep the stored pair — passing the probe value
 *  unconditionally would make every field's read look like a status write. */
const changeReader: StoredReader = (field, value) => {
  const merged = sanitizeChangeItem({
    ...CHANGE_BASE,
    ...dropUnacceptedChangeFields({ [field]: value }),
  });
  if (!merged) return null;
  const stamped = applyModelChangeStatus(
    merged,
    field === "status" ? value : undefined,
    CHANGE_BASE.status as ChangeStatus,
    "2026-01-01",
  );
  return readStored(stamped as unknown as Record<string, unknown>, field);
};

/** The RESOURCE apply path — the ONE reader here that wraps its sanitizer in
 *  nothing, deliberately, and now pinned so it cannot STAY that way by accident.
 *
 *  ★★★ EVERY SIBLING ABOVE COMPOSES A MERGE-SITE STEP BECAUSE ONE EXISTS.
 *  `updateResource` (`use-chat-dispatcher.ts`) has no guard to compose: it
 *  spreads the model's patch RAW over the stored row and hands the result
 *  straight to `sanitizeResource`. So this reader IS the real write path for
 *  every swept field, not a cheaper stand-in for it — and adding a `dropUnaccepted…`
 *  call here to match the siblings would be a MIRROR of a guard production does
 *  not have, which is the drift this file exists to catch.
 *
 *  ★★ THE ONE STEP THE WRITER DOES HAVE CANNOT FIRE HERE, which is why its
 *  absence is not a gap: the dispatcher re-derives the name parts via
 *  `splitName`, and that branch needs `patch.name` — absent from this
 *  descriptor's `diffFields`, reached by no probe, and gated on BOTH parts being
 *  non-strings, which `previewOf`'s one-key override can never produce. Blind
 *  spots (2) and (3) at the top of this file say the same thing from the probe
 *  side; `plan.write-path.test.ts` owns it against the real dispatcher.
 *
 *  ★★★ SO THE HOLE IS THE FUTURE, NOT TODAY, and that is what the source
 *  assertion at the bottom of this file closes. A raw-sanitizer reader is
 *  structurally BLIND to a merge-site guard: measured on `raid`, where the fix
 *  landed, this sweep stayed green throughout, and four stale
 *  `PREVIEW_REJECTS_APPLY_WRITES` entries went on excusing defects that no
 *  longer existed. `change` repeated it with two. `resource` cannot repeat it
 *  silently — the moment anything filters the patch before `sanitizeResource`,
 *  that assertion reds and composing this reader is the fix. */
const resourceReader: StoredReader = sanitizerReader(RES_BASE, sanitizeResource as never);

const CASES: ReadonlyArray<{
  entity: InlineEntity;
  base: Record<string, unknown>;
  read: StoredReader;
}> = [
  { entity: "task", base: TASK_BASE as unknown as Record<string, unknown>, read: taskReader },
  { entity: "raid", base: RAID_BASE, read: raidReader },
  { entity: "change", base: CHANGE_BASE, read: changeReader },
  { entity: "milestone", base: MILE_BASE, read: milestoneReader },
  { entity: "stakeholder", base: STK_BASE, read: stakeholderReader },
  { entity: "resource", base: RES_BASE, read: resourceReader },
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

/** ★★★ PREVIEW REJECTS WHERE THE REPLAYED WRITE MOVES THE FIELD — §384's OWN
 *  SHAPE, and the direction this file used to `continue` past under a comment
 *  calling it "the safe direction — nothing is written".
 *
 *  That comment held for the REBUILDING consumer (`use-inline-entity-edit.ts`
 *  rebuilds its patch from `plan.updates`, so a rejected field is genuinely
 *  absent) and was false for both REPLAYING ones: `chat-proposal-apply.ts` and
 *  `use-insight-recommendations.ts` resend the ORIGINAL `ProposedCall.input` and
 *  never read the plan, so the dispatcher merges + sanitizes the model's value
 *  and stores whatever falls out. §384 is exactly that — a mononym rename
 *  previewed `lastName` as rejected while the write stored `""`.
 *
 *  ★★ THE COMPARISON IS AGAINST THE FIELD'S OWN UNCHANGED VALUE, not against
 *  "was anything written". A write always happens on the replay path, so
 *  `stored !== null` would flag all 185 preview-only rejections and make the
 *  exception list bigger than the gate. What the preview's rejection actually
 *  PROMISES the reader is that THIS FIELD does not move; the sweep therefore
 *  pushes the field's CURRENT value through the same apply path and compares.
 *  Note this is measured on the WRITER's output, never on a consumer's
 *  behaviour — "nothing is written" is the reasoning that shipped §384.
 *
 *  ★★★ EVERY ENTRY BELOW IS AN OPEN DEFECT IN THE PRODUCT, NOT A PROPERTY OF
 *  THE TEST, and every one that has ever sat here was one mechanism: the preview
 *  refuses a value the WRITER does not refuse — the writer silently coerces or
 *  drops it, clearing a populated field. The card says "unchanged"; the replay
 *  wipes it. Fixing them belongs in the writer or the descriptor and is out of
 *  this file's scope; they are enumerated so a NEW member of the class is a red
 *  run.
 *
 *  ★★★ IT IS NOW EMPTY, AND THAT IS A MEASUREMENT RATHER THAN A DELETION — the
 *  totals test asserts this set is exactly the set that FIRES, so an entry whose
 *  defect gets fixed goes red as a stale exception rather than quietly granting
 *  cover to the next one, and both survivors did. It is kept, like
 *  `APPLY_ONLY_REJECTS` above, because the sweep must have somewhere to put such
 *  a pair other than a silent skip.
 *
 *  ★★ MEASURED 2026-09-05, printed from inside the totals test rather than
 *  derived: of 181 preview-only rejections, 0 now move the field, so all 181
 *  leave it where it was and are genuine agreement.
 *
 *  ★★★ IT WAS 17 / TWO UNTIL `change.impact` AND `change.raisedDate` WERE FIXED,
 *  and the way the numbers moved is again the point. `updateChange` now runs the
 *  model's patch through `dropUnacceptedChangeFields` before merging, so those
 *  two stopped moving and their 17 pairs left the EXCUSED bucket for the
 *  agreeing one — 17 → 0 excused, 164 → 181 remaining, `previewOnlyRejects`
 *  itself UNMOVED at 181. ★★ Nothing here would have moved on the fix alone: the
 *  change reader used to be a bare `sanitizerReader(CHANGE_BASE,
 *  sanitizeChangeItem)`, so the sweep could not see a merge-site guard at all
 *  and went on excusing two closed defects. `changeReader` composes the real
 *  guard AND the real `applyModelChangeStatus`, for the same reason `raidReader`
 *  and `taskReader` compose theirs.
 *
 *  ★★★ IT WAS 50 / SIX UNTIL THE FOUR RAID FIELDS WERE FIXED, by the same
 *  mechanism one register over. `updateRaid` runs the model's patch through
 *  `dropUnacceptedRaidFields` before merging, so `raid.severity`,
 *  `raid.probability`, `raid.impact` and `raid.raisedDate` stopped moving and
 *  their 33 pairs left the EXCUSED bucket — 50 → 17 excused, 131 → 164
 *  remaining, `previewOnlyRejects` UNMOVED at 181 (a rejection is still a
 *  rejection; only what the write then does to the field changed). The raid
 *  reader had the same blind spot the change one did, and `raidReader` closed it
 *  the same way.
 *
 *  ★★★ IT WAS 185 / 54 / SEVEN UNTIL `task.taskName` WAS FIXED, and the way the
 *  numbers moved is the point rather than a footnote. `buildTaskCleanPatch` now
 *  THROWS on a blank name, so `taskReader`'s catch returns null and those four
 *  pairs (`true`, `false`, `42`, `""`) left the preview-only bucket for the
 *  APPLY-REJECTS one — 185 → 181 and 43 apply-rejects — where preview and write
 *  agree outright and nothing needs excusing. `remaining` was UNCHANGED at 131
 *  because the four were excused, not compared. The three bucket counters and
 *  every floor are UNMOVED by ALL THREE fixes (compared 244, applyRejects 43,
 *  possible 288, enumerated 468) — a figure elsewhere in this file that changed
 *  with this work would be a bug.
 *  Re-print, never re-derive: `console.log` the reduce results in the totals
 *  test and run this file alone — ★★ WITH `--disable-console-intercept`, or the
 *  line never appears and the recipe reads as "the numbers did not print"
 *  rather than "vitest swallowed them". Measured: a bare
 *  `npx vitest run <this file>` shows nothing at all. */
const PREVIEW_REJECTS_APPLY_WRITES: Readonly<Record<string, string>> = {
};

// --- the differential ------------------------------------------------------

interface Outcome { rejected: boolean; shown: string }

/** ★★★ A REJECTION DETAIL IS NOT ALWAYS `${field}=…`, and reading it as one is a
 *  SILENT blind spot rather than a loud one. `describeEntityCalls` spells a JOINT
 *  `requiredNonEmptyGroups` refusal as `${members.join("+")}=empty`, so the
 *  obvious `detail.startsWith(`${field}=`)` misses it — measured 2026-09-05
 *  against a both-parts-blank `update_resource`, which yields
 *  `["firstName+lastName=empty", …]` and `startsWith("lastName=") === false`.
 *
 *  A MISSED rejection does not read as "no outcome": `previewOf` falls through to
 *  its no-diff branch and returns the field's BEFORE value, i.e. the sweep would
 *  record the preview as ACCEPTING what it in fact refused. In the apply-rejects
 *  branch that inverts into a mismatch the code does not have — `sanitizeResource`
 *  returns null for a both-blank row, so the pair would be reported as "apply
 *  REJECTS, preview accepts" when the preview rejected it too.
 *
 *  ★ It cannot fire TODAY only because `previewOf` overrides exactly ONE key
 *  (see the sweep's stated limits), so the surviving member always keeps the row
 *  alive. That is a property of the probe shape, not of the detector — fixed here
 *  rather than left to the first probe that sets two keys. */
const rejectsField = (detail: string, field: string): boolean => {
  const eq = detail.indexOf("=");
  return eq >= 0 && detail.slice(0, eq).split("+").includes(field);
};

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
  if (plan.rejected.some((r) => rejectsField(r.detail, field))) return { rejected: true, shown: "" };
  const diff = plan.updates.find((u) => u.field === field);
  if (diff) return { rejected: false, shown: diff.raw ?? diff.after };
  // NO diff is itself a claim — "applying this stores what is already there" —
  // so it is compared like any other outcome. Reading it as "nothing to check"
  // is how a preview that silently drops a field passes a parity test.
  // ★ DELEGATED, not restated: `previewNormalizerFor` is the production
  // resolution order (descriptor entry → numeric coercion → verbatim), so a
  // field moving between those three cannot leave this branch behind.
  // ★ The row an entry reads is the MERGED one, exactly as the production loop
  // builds it — `resource.emails` sanitizes against the row's primary, which a
  // probe may be changing in the same call.
  const normalize = previewNormalizerFor(d, field);
  return {
    rejected: false,
    shown: normalize ? normalize(base[field], { ...base, [field]: value }) : String(base[field] ?? ""),
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
  /** The `APPLY_ONLY_REJECTS` keys that actually fired. ★★ Added after a gate
   *  audit pointed out that of the three exception containers here, only ONE
   *  had a stale-entry check — and granting permanent silent cover to a closed
   *  defect is precisely the failure this file was rewritten to end. Both sets
   *  are empty today, so this is latent; the first entry added to either is the
   *  one that would otherwise rot. */
  excusedApplyRejects: string[];
  /** The `PREVIEW_REJECTS_APPLY_WRITES` keys that actually fired, so the totals
   *  test can red on a stale entry as well as on a new divergence. */
  excusedRejectWrites: string[];
}

/** One entity's full sweep. Returns every disagreement rather than throwing at
 *  the first, so a broken normalisation shows its whole blast radius at once. */
function sweep(entity: InlineEntity, base: Record<string, unknown>, read: StoredReader): Sweep {
  const out: Sweep = {
    mismatches: [], compared: 0, previewOnlyRejects: 0, applyRejects: 0,
    comparedByField: {}, excusedRejectWrites: [], excusedApplyRejects: [],
  };
  for (const field of fieldsUnderTest(entity)) {
    const key = `${entity}.${field}`;
    // The field's value after a NO-OP write: its own stored value pushed back
    // through the same apply path. `null` would mean the fixture itself is a
    // row the sanitizer rejects, which would make every rejection below
    // unreadable — so it is reported rather than silently compared against.
    const unchanged = read(field, base[field]);
    if (unchanged === null) {
      out.mismatches.push(`${key}: FIXTURE DEFECT — the stored value is rejected by its own apply path`);
      continue;
    }
    for (const { label, value } of PROBES) {
      const stored = read(field, value);
      const preview = previewOf(entity, base, field, value);
      if (stored === null) {
        out.applyRejects += 1;
        // Apply would reject outright. The preview must reject too, unless the
        // pair is one of the enumerated known gaps.
        if (APPLY_ONLY_REJECTS.has(key)) { out.excusedApplyRejects.push(key); continue; }
        if (!preview.rejected) out.mismatches.push(`${key} on ${label}: apply REJECTS, preview accepts "${preview.shown}"`);
        continue;
      }
      if (preview.rejected) {
        // ★★★ NOT A SAFE DIRECTION, and the comment this replaces said it was:
        // "nothing is written". That holds only for the REBUILDING consumer.
        // The two REPLAYING ones resend the original tool input, so a field the
        // preview calls rejected is still put through the writer — §384.
        // Enumerated known gaps live in `PREVIEW_REJECTS_APPLY_WRITES`.
        out.previewOnlyRejects += 1;
        if (stored !== unchanged) {
          if (key in PREVIEW_REJECTS_APPLY_WRITES) { out.excusedRejectWrites.push(key); continue; }
          out.mismatches.push(
            `${key} on ${label}: preview REJECTS, apply moves ${JSON.stringify(unchanged)} -> ${JSON.stringify(stored)}`,
          );
        }
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
    // MEASURED 2026-09-06: 265 comparisons over 32 comparable fields × 10
    // probes = 320 possible, i.e. 83%.
    // ★★ THIS LINE SAID 269/84% AND WAS ALREADY STALE WHEN §396 ARRIVED — the
    // numerator had drifted under a sibling commit and no gate could see it,
    // which is the failure the paragraph below describes happening again.
    // Attributed by measurement, not by reading the log: printed with and
    // without §396's `TASK_BASE.lastUpdateDate` and it is 265 BOTH WAYS, so
    // neither that fixture value nor the writer change moved it. The other
    // three figures here (32 / 320 / 520) re-printed unchanged.
    // (It was 244/288/85% until §395 refused a
    // boolean risk scale and added the `3` probe — the probe is why the
    // denominator moved by 32, and the two raid fields it rescued from total
    // silence are why the numerator moved by more than the four number fields
    // alone would explain.) (It was 234/279/84% until §383 added
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
    // `console.log` the reduce results here and run this file alone — ★★ WITH
    // `--disable-console-intercept`, or nothing prints and the run looks green
    // and silent (measured 2026-09-06; the flag is what recovered 265).
    const possible = CASES.reduce((n, c) => n + comparableFields(c.entity).length * PROBES.length, 0);
    // ★★★ THE DENOMINATOR NEEDS ITS OWN FLOOR, and this line was added after a
    // mutant proved the first cut vacuous: narrowing `comparableFields` to
    // return NOTHING left `silent` empty and `possible` zero, so both floors
    // above passed with the whole differential switched off (measured: 7 passed,
    // EXIT=0). Pinning the comparable pairs to a majority of the ENUMERATED ones
    // — 320 of 520, i.e. 62%, on 2026-09-06 — means the denominator cannot be
    // shrunk to make the numerator look good.
    expect(possible).toBeGreaterThan(enumerated / 2);
    expect(compared).toBeGreaterThan(possible / 2);

    // (4) THE EXCEPTION LIST IS EXACTLY THE SET THAT FIRES. An entry whose
    // defect is fixed goes red as STALE rather than silently covering the next
    // field to acquire the same shape — the failure mode the register records
    // for every enumerated allow-set. The reverse direction is already covered:
    // an unlisted divergence lands in `mismatches`.
    const fired = [...new Set(sweeps.flatMap(({ s }) => s.excusedRejectWrites))].sort();
    expect(fired).toEqual(Object.keys(PREVIEW_REJECTS_APPLY_WRITES).sort());

    // ★★ THE SAME CHECK FOR THE OTHER EXCEPTION SET. A gate audit found that of
    // the three containers here only `PREVIEW_REJECTS_APPLY_WRITES` had one, and
    // an exception that outlives its defect is the exact rot this file exists to
    // stop — four raid and two change entries were doing precisely that a few
    // commits ago. Both sets are empty today, so this is latent by design: it
    // arms itself the moment somebody adds the first entry.
    const firedApplyOnly = [...new Set(sweeps.flatMap(({ s }) => s.excusedApplyRejects))].sort();
    expect(firedApplyOnly).toEqual([...APPLY_ONLY_REJECTS].sort());
  });

  /** ★★★ THE TRIPWIRE UNDER `resourceReader`, and the reason that reader is
   *  allowed to stay a bare sanitizer call.
   *
   *  A raw-sanitizer reader cannot SEE a merge-site guard, so the entity it
   *  reads goes quietly stale the moment one lands: `raid` proved it (the guard
   *  shipped, this sweep stayed green, four stale exception entries went on
   *  excusing defects that no longer existed) and `change` proved it again with
   *  two. Both were caught by a person looking, which is not a gate.
   *
   *  This closes the RECURRENCE rather than the blindness — the distinction
   *  matters and the difference is what a reader must not paraphrase away. The
   *  sweep still cannot evaluate a resource merge-site guard; it can now only
   *  fail to be TOLD one exists. Adding anything between the model's patch and
   *  `sanitizeResource` breaks the shape below, and the fix at that point is to
   *  compose `resourceReader` the way `raidReader` and `changeReader` are
   *  composed — not to re-anchor this assertion.
   *
   *  ★★ SLICED TO ONE WRITER, never matched over the whole file: `createResource`
   *  a few lines up calls `sanitizeResource` too, and a whole-file regex would
   *  pass on ITS unguarded spread while `updateResource` grew a guard — a
   *  tripwire that reports success is worse than none. */
  describe("the resource merge site stays unguarded, or this reader must be composed", () => {
    it("hands sanitizeResource the model's patch with nothing in between", () => {
      // ★ Anchored to THIS file rather than the cwd, matching
      //  `tool-input-coverage.test.ts`. Use `join(import.meta.dirname, …)`, not
      //  `new URL(…, import.meta.url)` — under this vitest config the latter
      //  throws `The URL must be of scheme file`, which surfaces as "no tests"
      //  at a non-zero exit rather than as a readable failure.
      const src = readFileSync(join(import.meta.dirname, "..", "use-chat-dispatcher.ts"), "utf8");
      const start = src.indexOf("updateResource: (id: number, patch: Partial<ResourceInput>) => {");
      const end = src.indexOf("deleteResource: (id: number) => {", start);
      // ★ ANTI-VACUITY FIRST. Both `indexOf` calls return -1 on a rename, and a
      //  -1/-1 slice is `""` — against which every "no guard here" assertion
      //  below passes for the wrong reason. Assert the slice was really found,
      //  really bounded, and really contains the writer's own landmark.
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const body = src.slice(start, end);
      expect(body).toContain("splitName(patch.name)");

      // The POSITIVE shape: the stored row and the RAW patch spread straight
      // into the sanitizer. Any filter — wrapping the spread, or pre-computing a
      // guarded patch under another name — removes this and reds.
      const raw = body.match(/sanitizeResource\(\{\s*\.\.\.existing,\s*\.\.\.patch,/g) ?? [];
      expect(raw).toHaveLength(1);
      // And the NEGATIVE, naming the thing: no `dropUnaccepted*Fields` sibling
      // has reached this writer. Redundant with the line above today, on purpose
      // — it is the half that still fires if the spread shape is refactored for
      // an unrelated reason.
      expect(body).not.toMatch(/dropUnaccepted\w*Fields/);
    });
  });
});
