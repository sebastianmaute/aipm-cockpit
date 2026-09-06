// src/app/sanitize-records.ts — per-record object sanitizers (Milestone,
// Change, RAID, Stakeholder, ProjectMeta, SteeringCommittee, timezone).
// Built on sanitize-core.ts primitives + a couple of helpers from
// sanitize-entities.ts; re-exported via sanitize.ts.
import {
  type Milestone,
  RAID_CATEGORIES,
  RAID_SEVERITIES,
  RISK_STATUSES,
  ASSUMPTION_STATUSES,
  ISSUE_STATUSES,
  DEPENDENCY_STATUSES,
  type RaidItem,
  type RaidCategory,
  type RaidSeverity,
  type RaidStatus,
  type RiskScale,
  CHANGE_TYPES,
  CHANGE_STATUSES,
  type ChangeItem,
  type ChangeType,
  type ChangeStatus,
  STAKEHOLDER_CATEGORIES,
  RACI_ROLES,
  type Stakeholder,
  type RaciRole,
  type StakeholderCategory,
  type InfluenceInterest,
  type ContactPerson,
  type ProjectMeta,
  type IdentityType,
  type Deployment,
  type RegulatoryRequirement,
  type SteeringCommittee,
  type CommitteeMeeting,
  type InfoSchedule,
  type MeetingReport,
} from "./types";
import {
  IDENTITY_TYPE_SET,
  DEPLOYMENT_SET,
  REGULATORY_SET,
  REGULATORY_NOT_APPLICABLE,
} from "./project-options";
import {
  NACE_SECTION_SET,
} from "./nace-sections";

import {
  sanitizeKnowledgeLinks,
} from "./document-link";
import {
  isValidTimeZone,
} from "./timezone";
import {
  TASK_NAME_MAX,
  TEXTAREA_MAX,
  toNumber,
  sanitizeText,
  sanitizeEmail,
  sanitizeIsoDate,
  fkIdOrUndefined,
  isPlainObject,
} from "./sanitize-core";
import {
  BUDGET_NAME_MAX,
  sanitizeIdList,
} from "./sanitize-entities";
import { sanitizeRichText } from "./rich-text-plain";
import { RICH_SINK } from "./html-start";

/** The milestone's OWN linked-task rule. ★★ It is deliberately NOT
 *  `sanitizeIdList`: it accepts an array only (a delimited string yields `[]`,
 *  where raid/change parse one) and it does NOT dedupe. Exported so the preview
 *  can call the real rule instead of approximating it with the raid/change one,
 *  which would show links a milestone write drops. */
export function sanitizeMilestoneTaskIds(v: unknown): number[] {
  return Array.isArray(v) ? v.map((n) => toNumber(n)).filter((n) => Number.isFinite(n) && n > 0) : [];
}

/** ★★★ THE ONE DATE PREDICATE FOR EVERY MERGE-SITE GUARD — raid, change and
 *  milestone. It was three copies until a cold review pointed out that the
 *  defect below would then have to be fixed in three places.
 *
 *  ★★★ THE `rendersAsClear` LEG IS THE DEFECT ITSELF, and the first cut got it
 *  wrong by writing `v === ""` alone. The PREVIEW renders a diff's `after` with
 *  `str(v)` (`inline-ai-edit/plan.ts`), which yields "" for `null`, `undefined`
 *  and `[]` as well as for `""`. All four therefore appear on the card as a
 *  DISCLOSED CLEAR — and `null` is the shape a model actually reaches for when
 *  it means "clear this date", arriving raw because `patchWithoutId` does no
 *  coercion. Refusing them here made the write silently KEEP the stored value
 *  against a card promising a clear: the same class this guard exists to close,
 *  pointing the other way.
 *
 *  ★★ Worse, it made ONE approved card behave differently per apply path. The
 *  inline consumer rebuilds its patch from `FieldDiff.raw`, which is the
 *  rendered `""`, so it cleared; the two REPLAYING consumers resend the raw
 *  `null` and did not. Measured end-to-end in review, not reasoned.
 *
 *  ★ Anything else non-empty still has to satisfy the writer's own
 *  `sanitizeIsoDate`, which returns its input verbatim or "" — so this is that
 *  rule delegated, not a second parser. */
const rendersAsClear = (v: unknown): boolean =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

const acceptsPatchDate = (v: unknown): boolean => rendersAsClear(v) || sanitizeIsoDate(v) !== "";

/** Accept only well-formed milestones from untrusted JSON. id>0, name+date
 *  required; linkedTaskIds reduced to positive finite ints. */
type MilestoneFieldGuard = (value: unknown) => boolean;

/** ★★★ THE MERGE-SITE GUARD. `sanitizeMilestone` assigns its optional fields
 *  CONDITIONALLY (`if (achievedDate) m.achievedDate = ...`), and it rebuilds the
 *  whole record — so a value it does not accept does not merely fail to apply,
 *  it OMITS the key and CLEARS a populated field. The AI edit preview refuses
 *  the same value, so the card reads "unchanged" while the write wipes the date.
 *  Two of the three apply paths replay the original tool input and never consult
 *  the preview, so that wipe really lands.
 *
 *  The rule, shared with `dropUnacceptedRaidFields` and
 *  `dropUnacceptedChangeFields`: hoist the sanitizer's OWN acceptance predicate
 *  to the patch level and drop the key when it fails, so a refused value means
 *  "unchanged" rather than "cleared". It lives here rather than at the call site
 *  because the predicates below are this module's, and re-spelling them
 *  elsewhere is how the two copies drift apart.
 *
 *  ★★ NOT IN THE TABLE, deliberately:
 *  • `name` / `date` — required. An unaccepted value makes `sanitizeMilestone`
 *    return null and `updateMilestone` throws, which is a REFUSAL the user sees,
 *    not a silent clear. Guarding them would convert a loud failure into a
 *    silent partial write.
 *  • `linkedTaskIds` — assigned UNCONDITIONALLY via `sanitizeMilestoneTaskIds`,
 *    so a garbage value stores `[]`. The preview models that exact function and
 *    shows the emptying, so the two already agree; guarding it would make the
 *    card promise a clear the write no longer performs.
 *  • `description` — a RICH field. It has the same drop-key shape (a non-string
 *    clears it), but the preview PROJECTS a non-string rather than refusing it,
 *    so guarding it here would create this slice's own defect pointing the other
 *    way. Closing it needs a coordinated change on both sides; filed, not
 *    patched. Pinned in `sanitize-milestone-patch.test.ts`.
 *  • `localModifiedAt` / `outlookEventId` — unreachable because `patchWithoutId`
 *    STRIPS them (`TOKEN_EXCLUDED.milestone`), NOT because they are absent from
 *    `milestoneFields`. ★★ Corrected in cold review: `patchWithoutId` has no
 *    whitelist, so absence from the tool schema protects nothing by itself.
 *  • `knowledgeLinks` — REACHABLE, and deliberately still unguarded. It is
 *    neither stripped nor declared, so a patch carrying it wipes the stored
 *    links, and the preview cannot show that (it is neither a `diffField` nor a
 *    `linkField`). Pre-existing rather than introduced here, and outside this
 *    guard's scope — recorded because this list previously claimed "no AI patch
 *    can reach them", which is the kind of false assurance that stops the next
 *    audit. Same shape on raid's `ownerResourceId`. */
const MILESTONE_FIELD_GUARDS: Readonly<Record<string, MilestoneFieldGuard>> = {
  // ★ The clear carve-out inside `acceptsPatchDate` is load-bearing: the
  //  preview's date rule is `after !== "" && sanitizeIsoDate(after) !== after`,
  //  so anything it RENDERS as "" is disclosed to the user as a clear. Refusing
  //  those here inverts the defect — the card promises a clear the write no
  //  longer makes. Read the predicate, not this summary: the first cut checked
  //  `v === ""` alone and missed `null`, which is the shape a model actually
  //  sends.
  // ★ For everything the clear carve-out does NOT catch, `acceptsPatchDate`
  //  consults `sanitizeIsoDate` — the SAME parser `sanitizeMilestone` itself
  //  calls to fill `achievedDate`. So the guard and the sanitizer are not two
  //  independent rules that happen to agree: they share one leg on purpose,
  //  and the guard is wider only by the clear carve-out layered on top of it.
  achievedDate: acceptsPatchDate,
};

export function dropUnacceptedMilestoneFields<T extends object>(patch: T): T {
  const raw = patch as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const [field, accepts] of Object.entries(MILESTONE_FIELD_GUARDS)) {
    if (!(field in raw) || accepts(raw[field])) continue;
    out ??= { ...raw };
    delete out[field];
  }
  return (out ?? patch) as T;
}

export function sanitizeMilestone(input: unknown): Milestone | null {
  if (!isPlainObject(input)) return null;
  const o = input;
  const id = toNumber(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = sanitizeText(o.name, BUDGET_NAME_MAX);
  if (!name) return null;
  const date = sanitizeIsoDate(o.date);
  if (!date) return null;
  const m: Milestone = {
    id: Math.floor(id),
    name,
    date,
    linkedTaskIds: sanitizeMilestoneTaskIds(o.linkedTaskIds),
  };
  // ★ `acceptsPatchDate` is the GUARD's rule and is deliberately WIDER than this
  //  one: it admits a rendered-clear (null/""/[]) because the card discloses
  //  those as a clear. The sanitizer stores a date or nothing, so it consults
  //  `sanitizeIsoDate` — the leg `acceptsPatchDate` itself delegates to. One
  //  parser, two policies, and the policies differ on purpose.
  const achievedDate = sanitizeIsoDate(o.achievedDate);
  if (achievedDate) m.achievedDate = achievedDate;
  const description = sanitizeRichText(o.description, TEXTAREA_MAX, RICH_SINK);
  if (description) m.description = description;
  const localModifiedAt = sanitizeText(o.localModifiedAt, TEXTAREA_MAX);
  if (localModifiedAt) m.localModifiedAt = localModifiedAt;
  const dl = sanitizeKnowledgeLinks((input as Record<string, unknown>).knowledgeLinks ?? (input as Record<string, unknown>).documentLinks);
  if (dl.length) m.knowledgeLinks = dl;
  // Microsoft Graph event ids are long base64 (>300 chars); a tighter cap truncates
  // them and yields a 404 on PATCH/DELETE. Cap at 1024 to be safe.
  const outlookEventId = typeof o.outlookEventId === "string" ? o.outlookEventId.slice(0, 1024) : "";
  if (outlookEventId) m.outlookEventId = outlookEventId;
  return m;
}

// --- Change-log sanitizer --------------------------------------------------

const CHANGE_TYPE_SET = new Set<string>(CHANGE_TYPES);
const CHANGE_STATUS_SET = new Set<string>(CHANGE_STATUSES);
const CHANGE_IMPACT_SET = new Set<string>(["Low", "Medium", "High", "Critical"]);

/** Accept only well-formed change items from untrusted JSON. id>0 + title required. */
export function sanitizeChangeItem(input: unknown): ChangeItem | null {
  if (!isPlainObject(input)) return null;
  const o = input;
  const id = toNumber(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const title = sanitizeText(o.title, BUDGET_NAME_MAX);
  if (!title) return null;

  const type = (typeof o.type === "string" && CHANGE_TYPE_SET.has(o.type)) ? (o.type as ChangeType) : "Other";
  const status = (typeof o.status === "string" && CHANGE_STATUS_SET.has(o.status)) ? (o.status as ChangeStatus) : "Proposed";

  const item: ChangeItem = {
    id: Math.floor(id),
    title,
    description: sanitizeRichText(o.description, TEXTAREA_MAX, RICH_SINK),
    type,
    status,
    raisedDate: sanitizeIsoDate(o.raisedDate),
    linkedTaskIds: sanitizeIdList(o.linkedTaskIds),
    linkedRaidIds: sanitizeIdList(o.linkedRaidIds),
    stakeholderIds: sanitizeIdList(o.stakeholderIds),
  };
  if (typeof o.impact === "string" && CHANGE_IMPACT_SET.has(o.impact)) item.impact = o.impact as ChangeItem["impact"];
  const impactDesc = sanitizeRichText(o.impactDescription, TEXTAREA_MAX, RICH_SINK); if (impactDesc) item.impactDescription = impactDesc;
  if (acceptsScheduleDays(o.scheduleImpactDays)) item.scheduleImpactDays = toNumber(o.scheduleImpactDays);
  if (acceptsCostAmount(o.costImpact)) item.costImpact = toNumber(o.costImpact);
  const reqBy = sanitizeText(o.requestedBy, BUDGET_NAME_MAX); if (reqBy) item.requestedBy = reqBy;
  const decBy = sanitizeText(o.decisionBy, BUDGET_NAME_MAX); if (decBy) item.decisionBy = decBy;
  const decDate = sanitizeIsoDate(o.decisionDate); if (decDate) item.decisionDate = decDate;
  const notes = sanitizeRichText(o.resolutionNotes, TEXTAREA_MAX, RICH_SINK); if (notes) item.resolutionNotes = notes;
  const lma = sanitizeText(o.localModifiedAt, TEXTAREA_MAX); if (lma) item.localModifiedAt = lma;
  const dl = sanitizeKnowledgeLinks((input as Record<string, unknown>).knowledgeLinks ?? (input as Record<string, unknown>).documentLinks);
  if (dl.length) item.knowledgeLinks = dl;
  const oeid = sanitizeText(o.outlookEventId, 1024); if (oeid) item.outlookEventId = oeid;
  return item;
}

/** One guarded field's acceptance rule, read from `sanitizeChangeItem` above.
 *  Unlike the RAID table's, these take the value ALONE: no change field is
 *  validated against another, so there is no stored context to thread. */
type ChangeFieldGuard = (value: unknown) => boolean;

/** ★ `""` is ACCEPTED. The AI edit preview's date guard is `after !== "" &&
 *  sanitizeIsoDate(after) !== after`, so an empty string sails through it and is
 *  DISCLOSED to the user as a clear. Refusing it here would make the card
 *  promise a clear the write silently declined — the same preview/apply
 *  disagreement this guard exists to close, pointing the other way. */
const acceptsChangeDate: ChangeFieldGuard = acceptsPatchDate;

/** ★★ `toNumber`, NOT `typeof v === "number"`. The sanitizer coerces with
 *  `toNumber` and so does the preview's `numberPreview`, so a stricter rule here
 *  would refuse a value the card shows as accepted. Two consequences this
 *  deliberately does NOT change: `toNumber(true)` is `1` and `toNumber(false)`
 *  is `0`, both of which the `[0, ∞)` range admits; and the sanitizer gates on
 *  `Number.isFinite`, where the preview's `intRangeFields` guard demands
 *  `Number.isInteger` — so `1.5` previews as rejected and still applies. Closing
 *  that would mean abandoning the sanitizer's own predicate, which is the
 *  property that makes every row of this table checkable against it.
 *
 *  ★★ Split into `acceptsScheduleDays` and `acceptsCostAmount` below because the
 *  two fields do NOT share a precision rule: `change-edit-modal.tsx` clamps
 *  `scheduleImpactDays` with `describeClamp(..., { round: 0 })` and `costImpact`
 *  with `{ round: 2 }`. One shared predicate could not express that divergence.
 *
 *  The schedule-impact rule. Today it is the historical predicate verbatim;
 *  To be tightened to integers by the commit that closes §399. */
export const acceptsScheduleDays: ChangeFieldGuard = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) && n >= 0;
};

/** The cost-impact rule. Today it is the historical predicate verbatim;
 *  To be bounded by the commit that closes §399. */
export const acceptsCostAmount: ChangeFieldGuard = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) && n >= 0;
};

/** ★★★ `status` IS ABSENT ON PURPOSE, and adding it would be a REGRESSION, not
 *  a completion. `updateChange` runs `applyModelChangeStatus` (`change-log.ts`)
 *  after the sanitizer: it gates on the model's RAW status, restores the stored
 *  one when the value is unrecognised, and routes a recognised one through
 *  `applyChangeStatus` so the coupled `decisionDate` moves with it. Dropping the
 *  key here would take that raw value away and turn "the model sent a status" into
 *  "the model sent nothing", skipping the transition. */
const CHANGE_FIELD_GUARDS: Readonly<Record<string, ChangeFieldGuard>> = {
  type: (v) => typeof v === "string" && CHANGE_TYPE_SET.has(v),
  impact: (v) => typeof v === "string" && CHANGE_IMPACT_SET.has(v),
  raisedDate: acceptsChangeDate,
  decisionDate: acceptsChangeDate,
  scheduleImpactDays: acceptsScheduleDays,
  costImpact: acceptsCostAmount,
};

/**
 * Drop the keys of a MODEL-supplied CHANGE patch whose values
 * `sanitizeChangeItem` would not accept, so an unaccepted value means "leave the
 * stored value alone" rather than "wipe it".
 *
 * ★★★ THIS IS A MERGE-SITE GUARD AND MUST NOT MIGRATE INTO THE SANITIZER.
 * `sanitizeChangeItem` REBUILDS a whole record from an untrusted blob, so a
 * value it refuses is not left alone: the key is DROPPED (`impact`,
 * `decisionDate`, `scheduleImpactDays`, `costImpact`), written as `""`
 * (`raisedDate`), or reset to a HARDCODED DEFAULT (`type` -> "Other").
 * `updateChange` feeds it `{...stored, ...patch}`, so a refused patch value
 * wipes the STORED one — while the AI edit preview refuses that same value and
 * shows the field as unchanged. That fallback is CORRECT on the paths the
 * sanitizer also serves (JSON load, CSV decode, template apply, AI proposal),
 * where there is no prior value to preserve; the divergence is only ever about
 * an UPDATE.
 *
 * ★ Takes NO stored row, which is the one structural difference from
 * `dropUnacceptedRaidFields`: that one threads `category` because `status` is
 * validated against it, and no change field is validated against another.
 *
 * ★ Mirrors `applyModelChangeStatus` (`change-log.ts`), which does this for the
 * one `change.status` field — the field this table therefore leaves alone.
 * Written over a predicate TABLE rather than one branch per field so a new
 * guarded field is a row, not a new code path.
 *
 * ★ Copy-on-write like `withAiRichFields`: the common case (nothing refused)
 * returns the argument itself and allocates nothing.
 */
export function dropUnacceptedChangeFields<T extends object>(patch: T): T {
  const raw = patch as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const [field, accepts] of Object.entries(CHANGE_FIELD_GUARDS)) {
    if (!(field in raw) || accepts(raw[field])) continue;
    out ??= { ...raw };
    delete out[field];
  }
  return (out ?? patch) as T;
}

// --- RAID sanitizer --------------------------------------------------------

const RAID_CATEGORY_SET = new Set<string>(RAID_CATEGORIES);
const RAID_SEVERITY_SET = new Set<string>(RAID_SEVERITIES);
const RISK_STATUS_SET = new Set<string>(RISK_STATUSES);
const ASSUMPTION_STATUS_SET = new Set<string>(ASSUMPTION_STATUSES);
const ISSUE_STATUS_SET = new Set<string>(ISSUE_STATUSES);
const DEPENDENCY_STATUS_SET = new Set<string>(DEPENDENCY_STATUSES);

function statusSetForCategory(cat: RaidCategory): { set: Set<string>; statuses: RaidStatus[] } {
  switch (cat) {
    case "A": return { set: ASSUMPTION_STATUS_SET, statuses: ASSUMPTION_STATUSES };
    case "I": return { set: ISSUE_STATUS_SET, statuses: ISSUE_STATUSES };
    case "D": return { set: DEPENDENCY_STATUS_SET, statuses: DEPENDENCY_STATUSES };
    default:  return { set: RISK_STATUS_SET, statuses: RISK_STATUSES };
  }
}

/** Accept only well-formed RAID items from untrusted JSON. id>0 + title required. */
export function sanitizeRaidItem(input: unknown): RaidItem | null {
  if (!isPlainObject(input)) return null;
  const o = input;
  const id = toNumber(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const title = sanitizeText(o.title, TASK_NAME_MAX);
  if (!title) return null;

  const category: RaidCategory =
    typeof o.category === "string" && RAID_CATEGORY_SET.has(o.category)
      ? (o.category as RaidCategory)
      : "R";

  const { set: statusSet, statuses } = statusSetForCategory(category);
  const status: RaidStatus =
    typeof o.status === "string" && statusSet.has(o.status)
      ? (o.status as RaidStatus)
      : statuses[0];

  const item: RaidItem = {
    id: Math.floor(id),
    category,
    title,
    status,
    raisedDate: sanitizeIsoDate(o.raisedDate),
    linkedTaskIds: sanitizeIdList(o.linkedTaskIds),
    causedByRaidIds: sanitizeIdList(o.causedByRaidIds),
    stakeholderIds: sanitizeIdList(o.stakeholderIds),
  };

  const description = sanitizeRichText(o.description, TEXTAREA_MAX, RICH_SINK);
  if (description) item.description = description;
  const mitigation = sanitizeRichText(o.mitigation, TEXTAREA_MAX, RICH_SINK);
  if (mitigation) item.mitigation = mitigation;
  const owner = sanitizeText(o.owner, BUDGET_NAME_MAX);
  if (owner) item.owner = owner;
  const ownerEmail = sanitizeEmail(o.ownerEmail);
  if (ownerEmail) item.ownerEmail = ownerEmail;
  const ownerResourceId = fkIdOrUndefined(o.ownerResourceId);
  if (ownerResourceId !== undefined) item.ownerResourceId = ownerResourceId;
  else if (o.ownerResourceId === null) item.ownerResourceId = null;

  if (typeof o.severity === "string" && RAID_SEVERITY_SET.has(o.severity)) {
    item.severity = o.severity as RaidSeverity;
  }

  if (acceptsRiskScale(o.probability, category)) item.probability = toNumber(o.probability) as RiskScale;
  if (acceptsRiskScale(o.impact, category)) item.impact = toNumber(o.impact) as RiskScale;

  const targetDate = sanitizeIsoDate(o.targetDate);
  if (targetDate) item.targetDate = targetDate;
  const closedDate = sanitizeIsoDate(o.closedDate);
  if (closedDate) item.closedDate = closedDate;
  const lma = sanitizeText(o.localModifiedAt, TEXTAREA_MAX);
  if (lma) item.localModifiedAt = lma;

  const dl = sanitizeKnowledgeLinks((input as Record<string, unknown>).knowledgeLinks ?? (input as Record<string, unknown>).documentLinks);
  if (dl.length) item.knowledgeLinks = dl;

  const outlookEventId = typeof o.outlookEventId === "string" ? o.outlookEventId.slice(0, 1024) : "";
  if (outlookEventId) item.outlookEventId = outlookEventId;

  // Sparse: only a positive integer count is kept (mirrors Task.inquiriesSent);
  // zero/negative/absent -> undefined so legacy items stay byte-identical.
  const inq = toNumber(o.inquiriesSent);
  if (Number.isFinite(inq) && inq > 0) item.inquiriesSent = Math.floor(inq);

  return item;
}

/** One guarded field's acceptance rule, read from `sanitizeRaidItem` above.
 *  `category` is threaded rather than closed over because `status` is validated
 *  against the EFFECTIVE category — the patch's when that is itself accepted,
 *  the stored one otherwise — exactly as the sanitizer does it. */
type RaidFieldGuard = (value: unknown, category: RaidCategory) => boolean;

/** ★ `""` is ACCEPTED. The AI edit preview's date guard is `after !== "" &&
 *  sanitizeIsoDate(after) !== after`, so an empty string sails through it and is
 *  DISCLOSED to the user as a clear. Refusing it here would make the card
 *  promise a clear the write silently declined — the same preview/apply
 *  disagreement this guard exists to close, pointing the other way. */
const acceptsRaidDate: RaidFieldGuard = acceptsPatchDate;

/** The [1,5] risk-scale rule, and the ONE spelling of it.
 *
 *  ★★★ THE SANITIZER CALLS THIS; THIS DOES NOT RESTATE THE SANITIZER. That
 *  direction is the whole point (open-followups §405): the merge-site guard and
 *  `sanitizeRaidItem` used to hold two copies of one rule 50 lines apart, with
 *  nothing tying them together and no test able to see a drift, because every
 *  it.each row asserts a chosen value against both sides at once.
 *
 *  ★★ `toNumber`, NOT `typeof v === "number"` — the preview's `numberPreview`
 *  coerces with `toNumber`, so a stricter rule here refuses a value the card
 *  shows as accepted. */
export const acceptsRiskScale: RaidFieldGuard = (v) => {
  const n = toNumber(v);
  return Number.isInteger(n) && n >= 1 && n <= 5;
};

const RAID_FIELD_GUARDS: Readonly<Record<string, RaidFieldGuard>> = {
  category: (v) => typeof v === "string" && RAID_CATEGORY_SET.has(v),
  status: (v, category) => typeof v === "string" && statusSetForCategory(category).set.has(v),
  severity: (v) => typeof v === "string" && RAID_SEVERITY_SET.has(v),
  probability: acceptsRiskScale,
  impact: acceptsRiskScale,
  raisedDate: acceptsRaidDate,
  targetDate: acceptsRaidDate,
  closedDate: acceptsRaidDate,
};

/**
 * Drop the keys of a MODEL-supplied RAID patch whose values `sanitizeRaidItem`
 * would not accept, so an unaccepted value means "leave the stored value
 * alone" rather than "wipe it".
 *
 * ★★★ THIS IS A MERGE-SITE GUARD AND MUST NOT MIGRATE INTO THE SANITIZER.
 * `sanitizeRaidItem` REBUILDS a whole record from an untrusted blob, so a value
 * it refuses is not left alone: the key is DROPPED (`severity`, `probability`,
 * `impact`, `targetDate`, `closedDate`), written as `""` (`raisedDate`), or
 * reset to a HARDCODED DEFAULT (`category`, and `status` with it, since
 * `statusSetForCategory` is keyed off the category the fallback just chose).
 * `updateRaid` feeds it `{...stored, ...patch}`, so a refused patch value wipes
 * the STORED one — while the AI edit preview refuses that same value and shows
 * the field as unchanged. That fallback is CORRECT on the paths the sanitizer
 * also serves (JSON load, CSV decode, template apply, AI proposal), where there
 * is no prior value to preserve; the divergence is only ever about an UPDATE.
 *
 * ★★ It is a per-field guard and does not pretend otherwise: an ACCEPTED
 * category change narrows the status set, so a stored status the new category
 * does not have is still reset by the sanitizer. There is no prior value to
 * keep in that case.
 *
 * ★ Mirrors `applyModelChangeStatus` (`change-log.ts`), which does this for the
 * one `change.status` field and whose docstring carries the same reasoning.
 * Written over a predicate TABLE rather than one branch per field so a new
 * guarded field is a row, not a new code path.
 *
 * ★ Copy-on-write like `withAiRichFields`: the common case (nothing refused)
 * returns the argument itself and allocates nothing.
 */
export function dropUnacceptedRaidFields<T extends object>(
  patch: T,
  stored: Pick<RaidItem, "category">,
): T {
  const raw = patch as Record<string, unknown>;
  const category =
    "category" in raw && RAID_FIELD_GUARDS.category(raw.category, stored.category)
      ? (raw.category as RaidCategory)
      : stored.category;
  let out: Record<string, unknown> | null = null;
  for (const [field, accepts] of Object.entries(RAID_FIELD_GUARDS)) {
    if (!(field in raw) || accepts(raw[field], category)) continue;
    out ??= { ...raw };
    delete out[field];
  }
  return (out ?? patch) as T;
}

// --- Stakeholder + RACI ----------------------------------------------------

const STAKEHOLDER_CATEGORY_SET = new Set<string>(STAKEHOLDER_CATEGORIES);
const INFLUENCE_INTEREST_SET = new Set<string>(["Low", "Medium", "High"]);
const RACI_SET = new Set<string>(RACI_ROLES);
const RACI_KEY_RE = /^\d+$/;

/** Encode a RACI map "milestoneId=letter|…"; drops malformed entries. */
export function encodeRaciMap(map: Record<string, RaciRole> | undefined): string {
  if (!map) return "";
  return Object.entries(map)
    .filter(([k, v]) => RACI_KEY_RE.test(k) && RACI_SET.has(v))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
}

/** Decode "k=v|k=v" back to a RACI map; drops malformed keys/letters. */
export function decodeRaciMap(s: unknown): Record<string, RaciRole> {
  if (typeof s !== "string" || !s) return {};
  const out: Record<string, RaciRole> = {};
  for (const part of s.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (RACI_KEY_RE.test(key) && RACI_SET.has(val)) out[key] = val as RaciRole;
  }
  return out;
}

function coerceRaciMap(input: unknown): Record<string, RaciRole> {
  if (typeof input === "string") return decodeRaciMap(input);
  if (!isPlainObject(input)) return {};
  const out: Record<string, RaciRole> = {};
  for (const [k, v] of Object.entries(input)) {
    if (RACI_KEY_RE.test(k) && typeof v === "string" && RACI_SET.has(v)) {
      out[k] = v as RaciRole;
    }
  }
  return out;
}

/** Accept only well-formed stakeholders from untrusted JSON. id>0 + name required. */
type StakeholderFieldGuard = (value: unknown) => boolean;

/** ★★★ THE MERGE-SITE GUARD FOR STAKEHOLDER — the fourth, and the one the
 *  parity sweep could not see. Its three enums RESET to a hardcoded fallback
 *  rather than dropping a key, and `STK_BASE` in
 *  `plan.sanitizer-parity.test.ts` happens to hold exactly those fallbacks, so a
 *  refused value read back as the value already there and the sweep recorded
 *  agreement. A review probe that moved the fixture off its defaults measured
 *  **27 mismatch pairs**.
 *
 *  The user-visible defect: a stakeholder stored as "Sponsor" whose patch
 *  carries an unrecognised `category` is silently demoted to "Other" — and
 *  because `influence`/`interest` reset the same way, one refused value can move
 *  a field the model never named. The card shows nothing, since the preview
 *  refuses the value and the two REPLAYING consumers resend it anyway.
 *
 *  ★ Only the three enums are guarded, and they are the only fields this
 *  sanitizer RESETS to a fallback; everything else drops or throws. `name` is
 *  required, so an unaccepted value makes the sanitizer return null and
 *  `updateStakeholder` throws — a refusal the user sees.
 *  `organization`/`title`/`email`/`notes` are drop-key text fields whose preview
 *  ALSO renders the clear (`sanitizeText` blanks a non-string and the preview
 *  shows ""), so those two already agree and guarding them would make the card
 *  promise a clear the write stops making.
 *
 *  ★★ THAT LIST COVERS THE TOOL-DECLARED FIELDS ONLY, and saying so is the
 *  point: `raci`, `resourceId` and `knowledgeLinks` are REACHABLE and unguarded.
 *  `patchWithoutId` has no whitelist — it strips `id`, `expectedToken` and
 *  `TOKEN_EXCLUDED.stakeholder` (`localModifiedAt`) and forwards the rest — so a
 *  patch carrying them lands, `raci` is overwritten unconditionally by
 *  `coerceRaciMap` (junk wipes the map) and the other two drop on a refused
 *  value. None is a `diffField` or a `linkField`, so the preview shows nothing
 *  either way. Pre-existing and out of this guard's scope, recorded because the
 *  milestone list one entity over made exactly this omission and had to be
 *  corrected for it — an exclusion list that reads as exhaustive and is not is
 *  the false assurance that stops the next audit. */
const STAKEHOLDER_FIELD_GUARDS: Readonly<Record<string, StakeholderFieldGuard>> = {
  category: (v) => typeof v === "string" && STAKEHOLDER_CATEGORY_SET.has(v),
  influence: (v) => typeof v === "string" && INFLUENCE_INTEREST_SET.has(v),
  interest: (v) => typeof v === "string" && INFLUENCE_INTEREST_SET.has(v),
};

export function dropUnacceptedStakeholderFields<T extends object>(patch: T): T {
  const raw = patch as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const [field, accepts] of Object.entries(STAKEHOLDER_FIELD_GUARDS)) {
    if (!(field in raw) || accepts(raw[field])) continue;
    out ??= { ...raw };
    delete out[field];
  }
  return (out ?? patch) as T;
}

export function sanitizeStakeholder(input: unknown): Stakeholder | null {
  if (!isPlainObject(input)) return null;
  const o = input;
  const id = toNumber(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = sanitizeText(o.name, BUDGET_NAME_MAX);
  if (!name) return null;

  const category = (typeof o.category === "string" && STAKEHOLDER_CATEGORY_SET.has(o.category))
    ? (o.category as StakeholderCategory) : "Other";
  const influence = (typeof o.influence === "string" && INFLUENCE_INTEREST_SET.has(o.influence))
    ? (o.influence as InfluenceInterest) : "Medium";
  const interest = (typeof o.interest === "string" && INFLUENCE_INTEREST_SET.has(o.interest))
    ? (o.interest as InfluenceInterest) : "Medium";

  const item: Stakeholder = {
    id: Math.floor(id),
    name,
    category,
    influence,
    interest,
    raci: coerceRaciMap(o.raci),
  };
  const org = sanitizeText(o.organization, BUDGET_NAME_MAX); if (org) item.organization = org;
  const title = sanitizeText(o.title, BUDGET_NAME_MAX); if (title) item.title = title;
  const email = sanitizeText(o.email, BUDGET_NAME_MAX); if (email) item.email = email;
  const notes = sanitizeText(o.notes, TEXTAREA_MAX); if (notes) item.notes = notes;
  const rid = toNumber(o.resourceId);
  if (Number.isFinite(rid) && rid > 0) item.resourceId = Math.floor(rid);
  const lma = sanitizeText(o.localModifiedAt, TEXTAREA_MAX); if (lma) item.localModifiedAt = lma;
  const dl = sanitizeKnowledgeLinks((input as Record<string, unknown>).knowledgeLinks ?? (input as Record<string, unknown>).documentLinks);
  if (dl.length) item.knowledgeLinks = dl;
  return item;
}

// --- Project meta sanitizer ------------------------------------------------

function sanitizeContactPerson(input: unknown): ContactPerson | null {
  if (!isPlainObject(input)) return null;
  const name = sanitizeText(input.name, BUDGET_NAME_MAX);
  if (!name) return null;
  const email = sanitizeEmail(input.email);
  const synced = typeof input.synced === "boolean" ? input.synced : false;
  const resourceId = fkIdOrUndefined(input.resourceId);
  return resourceId === undefined ? { name, email, synced } : { name, email, synced, resourceId };
}

/** Coerce an unknown value to a string array, map through text sanitizer,
 *  drop empties, and de-dupe (case-sensitive). */
function sanitizeStringArray(input: unknown, cap: number): string[] {
  const arr: unknown[] = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    const s = sanitizeText(item, cap);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Full-record sanitizer for inbound ProjectMeta data (file imports, chat
 * tools, form round-trips). Returns null when any required field is absent
 * or invalid.
 */
/** Keep a valid IANA timezone string; drop empty/junk/non-string. */
export function sanitizeTimezone(raw: unknown): string | undefined {
  return typeof raw === "string" && isValidTimeZone(raw) ? raw : undefined;
}

export function sanitizeProjectMeta(
  input: unknown,
  opts: { lenientRequiredArrays?: boolean } = {},
): ProjectMeta | null {
  if (!isPlainObject(input)) return null;
  const o = input;

  // Required short-text fields — empty string means invalid.
  const name = sanitizeText(o.name, BUDGET_NAME_MAX);
  if (!name) return null;
  const code = sanitizeText(o.code, BUDGET_NAME_MAX);
  if (!code) return null;
  const projectManager = sanitizeText(o.projectManager, BUDGET_NAME_MAX);
  if (!projectManager) return null;
  const customer = sanitizeText(o.customer, BUDGET_NAME_MAX);
  if (!customer) return null;
  const products = sanitizeText(o.products, BUDGET_NAME_MAX);
  if (!products) return null;
  const profitCenter = sanitizeText(o.profitCenter, BUDGET_NAME_MAX);
  if (!profitCenter) return null;

  // Required enum fields.
  const naceSectionRaw = sanitizeText(o.naceSection, 4);
  if (!NACE_SECTION_SET.has(naceSectionRaw)) return null;
  const naceSection = naceSectionRaw;

  const deploymentRaw = sanitizeText(o.deployment, BUDGET_NAME_MAX);
  if (!DEPLOYMENT_SET.has(deploymentRaw)) return null;
  const deployment = deploymentRaw as Deployment;

  // startDate is required; endDate is OPTIONAL (since 0.74) — keep a valid ISO
  // date, otherwise "" (no end date). Rejecting a blank endDate here would make
  // a complete form silently unsubmittable, since validateProjectMeta (which
  // gates the Save/Next button) treats endDate as optional.
  const startDate = sanitizeIsoDate(o.startDate);
  if (!startDate) return null;
  const endDate = sanitizeIsoDate(o.endDate) ?? "";

  // Key stakeholders (internal / external) are OPTIONAL — accept any sanitized
  // array, including empty. Contacts are the mandatory people field now, but
  // that is enforced at the form layer (validateProjectMeta) only: sanitize must
  // stay lenient here so existing projects saved without contacts still decode
  // (decode call sites use strict mode).
  const keyStakeholdersInternal = sanitizeStringArray(o.keyStakeholdersInternal, BUDGET_NAME_MAX);
  const keyStakeholdersExternal = sanitizeStringArray(o.keyStakeholdersExternal, BUDGET_NAME_MAX);

  // Required array: regulatory — filter to known set, de-dupe, collapse "Not applicable".
  const rawRegArr: unknown[] = Array.isArray(o.regulatory) ? o.regulatory : [];
  const regulatoryFiltered: RegulatoryRequirement[] = [];
  const regulatorySeen = new Set<string>();
  for (const item of rawRegArr) {
    if (typeof item !== "string" || !REGULATORY_SET.has(item)) continue;
    if (regulatorySeen.has(item)) continue;
    regulatorySeen.add(item);
    regulatoryFiltered.push(item as RegulatoryRequirement);
  }
  if (!opts.lenientRequiredArrays && regulatoryFiltered.length === 0) return null;
  const regulatory: RegulatoryRequirement[] = regulatoryFiltered.includes(REGULATORY_NOT_APPLICABLE)
    ? [REGULATORY_NOT_APPLICABLE]
    : regulatoryFiltered;

  // Optional enum array: identityTypes — filter + de-dupe; empty [] is allowed.
  const rawIdArr: unknown[] = Array.isArray(o.identityTypes) ? o.identityTypes : [];
  const identityTypesSeen = new Set<string>();
  const identityTypes: IdentityType[] = [];
  for (const item of rawIdArr) {
    if (typeof item !== "string" || !IDENTITY_TYPE_SET.has(item)) continue;
    if (identityTypesSeen.has(item)) continue;
    identityTypesSeen.add(item);
    identityTypes.push(item as IdentityType);
  }

  // contactPersons — keep only valid entries; empty [] is allowed.
  const rawCp: unknown[] = Array.isArray(o.contactPersons) ? o.contactPersons : [];
  const contactPersons: ContactPerson[] = rawCp
    .map(sanitizeContactPerson)
    .filter((cp): cp is ContactPerson => cp !== null);

  // Build required-fields-first object (sanitizeStakeholder style).
  const meta: ProjectMeta = {
    name,
    code,
    projectManager,
    keyStakeholdersInternal,
    keyStakeholdersExternal,
    customer,
    naceSection,
    identityTypes,
    products,
    deployment,
    startDate,
    endDate,
    profitCenter,
    contactPersons,
    regulatory,
  };

  // Optional text fields (short, trimmed).
  const description = sanitizeText(o.description, TEXTAREA_MAX); if (description) meta.description = description;
  const sponsor = sanitizeText(o.sponsor, BUDGET_NAME_MAX); if (sponsor) meta.sponsor = sponsor;
  const platform = sanitizeText(o.platform, BUDGET_NAME_MAX); if (platform) meta.platform = platform;
  const quotes = sanitizeText(o.quotes, TEXTAREA_MAX); if (quotes) meta.quotes = quotes;
  const salesforceUrl = sanitizeText(o.salesforceUrl, BUDGET_NAME_MAX); if (salesforceUrl) meta.salesforceUrl = salesforceUrl;
  const sharepointUrl = sanitizeText(o.sharepointUrl, BUDGET_NAME_MAX); if (sharepointUrl) meta.sharepointUrl = sharepointUrl;
  const confluenceUrl = sanitizeText(o.confluenceUrl, BUDGET_NAME_MAX); if (confluenceUrl) meta.confluenceUrl = confluenceUrl;
  const jiraUrl = sanitizeText(o.jiraUrl, BUDGET_NAME_MAX); if (jiraUrl) meta.jiraUrl = jiraUrl;
  const operatingTimezone = sanitizeTimezone(o.operatingTimezone); if (operatingTimezone) meta.operatingTimezone = operatingTimezone;
  const docRepoLocation = sanitizeText(o.docRepoLocation, BUDGET_NAME_MAX); if (docRepoLocation) meta.docRepoLocation = docRepoLocation;
  const notes = sanitizeText(o.notes, TEXTAREA_MAX); if (notes) meta.notes = notes;

  // Optional identityCount — coerce, require finite >= 0, floor.
  if (o.identityCount !== undefined && o.identityCount !== null && o.identityCount !== "") {
    const n = toNumber(o.identityCount);
    if (Number.isFinite(n) && n >= 0) meta.identityCount = Math.floor(n);
  }

  // Optional stakeholderCount — coerce, require finite >= 0, floor.
  if (o.stakeholderCount !== undefined && o.stakeholderCount !== null && o.stakeholderCount !== "") {
    const n = toNumber(o.stakeholderCount);
    if (Number.isFinite(n) && n >= 0) meta.stakeholderCount = Math.floor(n);
  }

  // Optional knowledgeLinks — pass through sanitized array (empty → omit).
  const dl = sanitizeKnowledgeLinks((input as Record<string, unknown>).knowledgeLinks ?? (input as Record<string, unknown>).documentLinks);
  if (dl.length) meta.knowledgeLinks = dl;

  return meta;
}

const REPORT_HTML_MAX = 100_000;

/** Defensive decode for a per-meeting status report. Returns undefined unless a
 *  non-empty `html` string and a string `updatedAt` are present. Pure/SSR-safe:
 *  it does NOT sanitize the HTML (that happens at write time), only caps size. */
function sanitizeMeetingReport(raw: unknown): MeetingReport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rr = raw as Record<string, unknown>;
  if (typeof rr.html !== "string" || rr.html.length === 0) return undefined;
  if (typeof rr.updatedAt !== "string") return undefined;
  const out: MeetingReport = { html: rr.html.slice(0, REPORT_HTML_MAX), updatedAt: rr.updatedAt };
  if (typeof rr.sentAt === "string") out.sentAt = rr.sentAt;
  return out;
}

/** Defensive decode for the optional Workspace.steeringCommittee field. Never
 *  throws: bad dates / non-number ids / negative leadDays are dropped or
 *  clamped, strings are capped, and absent/garbage input returns undefined. */
export function sanitizeSteeringCommittee(raw: unknown): SteeringCommittee | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, cap: number) => (typeof v === "string" ? v.slice(0, cap) : "");
  const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const members = Array.isArray(r.memberResourceIds)
    ? [...new Set(r.memberResourceIds.filter((x): x is number => typeof x === "number"))]
    : [];
  const meetings = Array.isArray(r.meetings)
    ? r.meetings.flatMap((m): CommitteeMeeting[] => {
        if (!m || typeof m !== "object") return [];
        const mm = m as Record<string, unknown>;
        if (typeof mm.id !== "number" || !isDate(mm.date)) return [];
        const out: CommitteeMeeting = { id: mm.id, date: mm.date, title: str(mm.title, 200) };
        if (typeof mm.agenda === "string") out.agenda = mm.agenda.slice(0, 2000);
        if (typeof mm.location === "string") out.location = mm.location.slice(0, 300);
        if (typeof mm.outlookEventId === "string") out.outlookEventId = mm.outlookEventId.slice(0, 1024);
        const report = sanitizeMeetingReport(mm.report);
        if (report) out.report = report;
        return [out];
      })
    : [];
  const infoSchedules = Array.isArray(r.infoSchedules)
    ? r.infoSchedules.flatMap((s): InfoSchedule[] => {
        if (!s || typeof s !== "object") return [];
        const ss = s as Record<string, unknown>;
        if (typeof ss.id !== "number") return [];
        const lead = Number(ss.leadDays);
        return [{ id: ss.id, label: str(ss.label, 200), leadDays: Number.isFinite(lead) && lead >= 0 ? Math.round(lead) : 0 }];
      })
    : [];
  const eventIds: Record<string, string> = {};
  if (r.infoReminderEventIds && typeof r.infoReminderEventIds === "object") {
    for (const [k, v] of Object.entries(r.infoReminderEventIds as Record<string, unknown>)) {
      if (typeof v === "string") eventIds[k] = v.slice(0, 1024);
    }
  }
  const pendingDelete = Array.isArray(r.pendingDeleteEventIds)
    ? [...new Set(r.pendingDeleteEventIds.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 1024)))]
    : [];
  return {
    name: str(r.name, 200),
    memberResourceIds: members,
    meetings,
    infoSchedules,
    ...(Object.keys(eventIds).length ? { infoReminderEventIds: eventIds } : {}),
    ...(pendingDelete.length ? { pendingDeleteEventIds: pendingDelete } : {}),
  };
}
