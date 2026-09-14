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
  ABSENCE_TYPES,
} from "./types";
import {
  IDENTITY_TYPE_SET,
  DEPLOYMENT_SET,
  REGULATORY_SET,
  REGULATORY_NOT_APPLICABLE,
} from "./project-options";
import { NACE_SECTION_SET } from "./nace-sections";

import { sanitizeKnowledgeLinks } from "./document-link";
import { isValidTimeZone } from "./timezone";
import { sanitizeRaidEscalations } from "./raid-escalation";
import {
  TASK_NAME_MAX,
  TEXTAREA_MAX,
  toNumber,
  sanitizeText,
  sanitizeEmail, sanitizeLoadedEmail,
  sanitizeIsoDate,
  fkIdOrUndefined,
  isPlainObject,
} from "./sanitize-core";
import {
  BUDGET_NAME_MAX,
  AMOUNT_MAX,
  sanitizeIdList,
} from "./sanitize-entities";
import { sanitizeRichText } from "./rich-text-plain";
import { RENDER_SINK, RICH_SINK } from "./html-start";
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

/** The milestone's linked-task rule. ★★ It USED to be deliberately different
 *  from `sanitizeIdList` — array-only and non-deduping — which meant
 *  `linkedTaskIds: "1;2"` linked two tasks on a raid item and nothing on a
 *  milestone, and duplicates inflated the digest's `linkedTasks` count. Aligned
 *  by §403. Kept as a named export because the preview calls it by
 *  name and because a future milestone-specific rule has somewhere to live. */
export function sanitizeMilestoneTaskIds(v: unknown): number[] {
  return sanitizeIdList(v);
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
 *  rule delegated, not a second parser.
 *
 *  ★★ EXPORTED so the TASK writer can ask the same QUESTION. `chat-task-patch.
 *  ts` needs exactly this classification for `lastUpdateDate` (§396), and
 *  re-spelling it there would be a second copy of the very thing this helper was
 *  consolidated from — the `v === ""`-alone bug would then have two places to
 *  live again.
 *
 *  ★★★ WHAT IS SHARED IS THE PREDICATE, NEVER THE POLICY, and reading it the
 *  other way would undo work that cost a commit to explain. This answers ONE
 *  question — "does the card disclose this input as a clear?" — and each caller
 *  then does its own, different thing with the answer. `acceptsPatchDate` uses
 *  it to ACCEPT the key so the full-record sanitizer can clear the field, which
 *  is why it is deliberately WIDER than the sanitizer's own rule (the milestone
 *  guard below spells that out); `buildTaskCleanPatch` uses it to WRITE "" into
 *  a patch that is merged over the stored row, because a dropped key there means
 *  "unchanged" rather than "cleared". Same answer, opposite mechanisms. Do NOT
 *  "unify" the two call sites, and do NOT widen or narrow this predicate to suit
 *  one of them — a change here moves task, raid, change and milestone at once. */
export const rendersAsClear = (v: unknown): boolean =>
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
 *  • `localModifiedAt` / `outlookEventId` — unreachable because BOTH strip
 *    helpers remove them (`TOKEN_EXCLUDED.milestone`): `patchWithoutId` on
 *    update AND `createInputWithoutId` on create, neither whitelisted — NOT
 *    because they are absent from `milestoneFields`. ★★★ Naming one is the bug.
 *  • `knowledgeLinks` — REACHABLE, and deliberately still unguarded. It is
 *    neither stripped nor declared, so a patch carrying it wipes the stored
 *    links, and the preview cannot show that (it is neither a `diffField` nor a
 *    `linkField`). Pre-existing rather than introduced here, and outside this
 *    guard's scope — recorded because this list previously claimed "no AI patch
 *    can reach them", which is the kind of false assurance that stops the next
 *    audit. Same shape on raid's `ownerResourceId`. */
const MILESTONE_FIELD_GUARDS: Readonly<Record<string, MilestoneFieldGuard>> = {
  // ★★★ NOT MODEL-WRITABLE, AND THE ONLY THING THAT MAKES THAT TRUE IS THIS
  //  ENTRY. `knowledgeLinks` appears in NO tool schema (`grep -c knowledgeLinks
  //  src/app/chat-tool-defs.ts` -> 0), but NEITHER strip helper has a whitelist
  //  (`patchWithoutId` on update, `createInputWithoutId` on create), so absence
  //  from the schema protects nothing by itself — the comment above this table says so, and this field was the live instance of it.
  //  ★★ WHAT IT COST: the sanitizer reads the merged `{...existing, ...patch}`,
  //  so a patch value REPLACED the stored links before `sanitizeKnowledgeLinks`
  //  ran; garbage reduced to `[]`, the sparse `if (dl.length)` then omitted the
  //  key, and the stored links were GONE. The preview could not disclose any of
  //  it — `knowledgeLinks` is neither a `diffField` nor a `linkField` — so the
  //  card said nothing while the write destroyed user data.
  //  ★★ MEASURED, not reasoned: `plan.write-path-sweep.test.ts` drove it on all
  //  four registers that carry the field and reported the wipe on every one, for
  //  both an empty array and a non-array string. It is the first thing that
  //  demonstrated a defect this file had documented as a known risk since the
  //  merge-site guards landed.
  //  ★ `() => false` rather than a shape check ON PURPOSE. A predicate that
  //  accepted a well-formed array would still let the model CLEAR the links (a
  //  valid empty array is a legitimate shape), and the card still could not
  //  disclose it. Nothing may reach this field from a model patch until the
  //  descriptor can show what it does.
  knowledgeLinks: () => false,
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
  // ★★ ADDED WITH ITS PREVIEW HALF, NEVER ALONE. `sanitizeRichText` returns ""
  //  for a non-string and `if (description)` then omits the key, so the rebuilt
  //  record LOSES the stored rich text. This was deliberately left out of the
  //  first cut of this table because the preview PROJECTED a non-string rather
  //  than refusing it, and guarding only here would have made the write keep a
  //  value the card said was changing — this slice's own defect, pointing the
  //  other way (§398). The preview refusal lands in the same commit:
  //  `stringOnlyFields` on the milestone descriptor, checked in `plan.ts`.
  // ★★ NO CLEAR CARVE-OUT, unlike `acceptsPatchDate` above, and that asymmetry
  //  is what keeps the two sides in step rather than a gap in this predicate.
  //  `acceptsPatchDate` needs one because the preview shows null/""/[] as a
  //  DISCLOSED CLEAR for a date, so refusing them there would leave the card
  //  promising a clear the write declines. Here the preview refuses every
  //  non-string outright (`stringOnlyFields`), so null and [] are REFUSED on
  //  both sides and nothing is promised. `""` is the one clear that survives:
  //  it IS a string, so it passes here and reaches `if (description)`, which
  //  omits the key — and the card renders `str("")` as "" and discloses the
  //  same clear. Adding a carve-out for null/[] would BREAK that, not extend it.
  // ★★★ THE "BOTH SIDES AGREE" CLAIM IS ONLY TRUE WITH THIS GUARD NESTED
  //  OUTSIDE `withAiRichFields` AT THE CALL SITE, and the first cut of this
  //  comment asserted the agreement while the code could not deliver it.
  //  Nested inside, `sanitizeAiRichText` had already turned every non-string
  //  into "" before this predicate ran, so `typeof v === "string"` was
  //  unconditionally true, the key survived, and `if (description)` then
  //  dropped it — the card refused the value while the write CLEARED the stored
  //  text. Do not read the parity off this predicate alone; it is a property of
  //  the composition. Measured over the six shapes {true, null, [], 42,
  //  "<p>new</p>", ""} in `sanitize-milestone-patch.test.ts`'s "preview and
  //  write agree on every NON-STRING shape (§398's actual invariant)", which
  //  runs the real preview and the real write.
  // ★★★ THE "NON-STRING" QUALIFIER IS LOAD-BEARING AND AN EARLIER WORDING HERE
  //  DROPPED IT, citing a shorter title that exists in no test file and
  //  asserting a whole-input-space parity the cited block REFUTES on its own
  //  last row: a string whose only content is a disallowed element is previewed
  //  verbatim and WRITTEN AS A CLEAR, filed there as known, open and
  //  pre-existing. The parity claimed here holds over the six shapes named
  //  above and nowhere else — do not re-shorten the title when quoting it.
  // ★★ That wording also listed key-absent as a seventh measured shape. It is
  //  not in that block, and NOTHING measures it on both sides: it is pinned
  //  write-side only, by a peer test that calls `applyMilestoneUpdate` with the
  //  key omitted and never reaches the preview.
  description: (v) => typeof v === "string",
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
  // ★★★ VERBATIM, AND THE ABSENCE OF BOTH A REPAIR AND AN ACCEPT-GATE HERE IS
  //  THE POINT. This function's dominant population is ALREADY-STORED USER DATA
  //  — five of the six write paths' read side reach it (`buildChangeFromObj`
  //  serves CSV, Markdown and both Turso layouts; `jsonToWorkspace` the sixth
  //  slot's JSON) — and a loader must not rewrite a number a person saved. A
  //  cut of this branch ran `repairCostAmount` here and silently moved stored
  //  data on every load: 2_000_000_000 -> 1_000_000_000 and 1234.567 -> 1234.57.
  //  AMOUNT_MAX is 1e9, an ordinary project figure in JPY/KRW/IDR, so the clamp
  //  was not theoretical.
  // ★★★ REMOVING ONLY THE REPAIR IS WORSE THAN EITHER, which is the trap to
  //  understand before "restoring" half of this. The accept-gate would survive
  //  and turn the clamp into a DROP: a stored 1.5 or 2e9 would lose its key
  //  outright, on a path that cannot report it — the JSON loader takes no diag
  //  at all, and the CSV/MD `ImportDiag` is ROW-level, so a dropped FIELD is
  //  invisible to it. The repair and the gate come out together or not at all.
  // ★★ `isCoercibleNumber` STAYS, and it is the one thing not restored from the
  //  pre-branch loader. That one used a bare `toNumber`, so `true` stored as a
  //  fabricated 1 (§395). Verbatim means "do not rewrite a NUMBER", never "take
  //  a boolean's coercion".
  // ★ MODEL input is repaired instead, by `sanitizeModelChangeItem` below —
  //  acceptance, repair and refusal are three different questions asked by three
  //  different callers. The map is on that wrapper's docstring.
  const days = isCoercibleNumber(o.scheduleImpactDays) ? toNumber(o.scheduleImpactDays) : NaN;
  if (Number.isFinite(days) && days >= 0) item.scheduleImpactDays = days;
  const cost = isCoercibleNumber(o.costImpact) ? toNumber(o.costImpact) : NaN;
  if (Number.isFinite(cost) && cost >= 0) item.costImpact = cost;
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

/** One guarded field's acceptance rule for a MODEL PATCH.
 *  Unlike the RAID table's, these take the value ALONE: no change field is
 *  validated against another, so there is no stored context to thread.
 *  ★★ THESE ARE NO LONGER "READ FROM `sanitizeChangeItem` ABOVE", which is what
 *  this docstring said while that function shared their rules. It now stores the
 *  two numeric fields VERBATIM, so for `scheduleImpactDays` and `costImpact`
 *  these predicates are strictly TIGHTER than the loader: they are the rule for
 *  a model WRITE and for the preview that discloses it (§405), not a restatement
 *  of what load accepts. The enum and date rows still match the sanitizer. */
type ChangeFieldGuard = (value: unknown) => boolean;

/** ★ `""` is ACCEPTED. The AI edit preview's date guard is `after !== "" &&
 *  sanitizeIsoDate(after) !== after`, so an empty string sails through it and is
 *  DISCLOSED to the user as a clear. Refusing it here would make the card
 *  promise a clear the write silently declined — the same preview/apply
 *  disagreement this guard exists to close, pointing the other way. */
const acceptsChangeDate: ChangeFieldGuard = acceptsPatchDate;

/** Reject a boolean before coercing. Shared by every numeric predicate here.
 *  `toNumber(true)` is 1 and `toNumber(false)` is 0, both of which several
 *  ranges admit, so a boolean silently becomes a plausible number (§395).
 *
 *  ★ Deliberately a plain `boolean`, NOT a `v is number | string` type
 *  predicate. It shipped as one and the narrowing was formally UNTRUE — `null`,
 *  `undefined`, objects and arrays all pass this guard — which invites a later
 *  caller to trust it. Harmless today only because every caller's next step is
 *  `toNumber(v)`, which takes `unknown` and answers `NaN` for all of those. The
 *  narrowing bought nothing, so it is gone rather than made honest. */
const isCoercibleNumber = (v: unknown): boolean => typeof v !== "boolean";

/** ★★ `toNumber`, NOT `typeof v === "number"`. The sanitizer coerces with
 *  `toNumber` and so does the preview's `numberPreview`, so a rule here that
 *  refused a numeric STRING would refuse a value the card shows as accepted.
 *
 *  ★★ THE NON-INTEGER DIVERGENCE THIS USED TO RECORD IS STILL CLOSED, BUT NOT
 *  BY THE MECHANISM RECORDED HERE UNTIL NOW. The old wording said the preview
 *  "now accepts `1.5` exactly as the write does" — true when §395 replaced the
 *  preview's own `[min, max]` tuple with `numericFields`, whose `change`
 *  entries ARE these two functions, but it closed the gap at the LOOSE end.
 *  §399 closes it at the tight end instead: `acceptsScheduleDays` now REFUSES
 *  `1.5`, and the preview follows for free because it still calls this
 *  predicate. Both statements describe agreement; only one describes today's.
 *
 *  ★★★ "THE WRITE" IN THAT PARAGRAPH MEANS THE MODEL **UPDATE** AND NOTHING
 *  ELSE, and the three change writes now answer `1.5` three different ways.
 *  UPDATE refuses it (this predicate, via `dropUnacceptedChangeFields`, with the
 *  preview refusing in step). CREATE repairs it to 2 (`sanitizeModelChangeItem`,
 *  which the card cannot contradict because it makes no per-field claim on a
 *  create). LOAD stores it as 1.5, verbatim, because rewriting a stored number
 *  is not this predicate's business. Reading the agreement above as a property
 *  of every write path is the mistake to avoid here.
 *
 *  ★★★ THE TWO AMOUNT FIELDS DO NOT SHARE A RULE, and reading them as a pair is
 *  the mistake this docstring exists to stop. They were one
 *  `acceptsChangeAmount` and the plan that split them originally said "a change
 *  amount must be an integer" — true of days, false of money, and
 *  `change-edit-modal.tsx` refutes it.
 *
 *  Schedule impact, in DAYS. Integer because that modal clamps this field with
 *  `describeClamp(value, { min: 0, round: 0 })`, and the preview already
 *  demanded an integer before §395, so the writer was the side that disagreed
 *  (§399).
 *
 *  ★★★ "THE FORM CANNOT PRODUCE A FRACTION" IS A CLAIM ABOUT TODAY, NOT ABOUT
 *  THE STORED DATA, and this docstring asserted it flatly for one commit. Until
 *  the commit before this one it was FALSE, four lines from the code it cites:
 *  that `describeClamp` ran ONLY in `onBlur`, and `change-edit-modal.tsx`'s own
 *  comment says "Enter inside a text input submits WITHOUT firing blur" — so
 *  typing `1.5` and pressing Enter saved `1.5`. The clamp now runs on blur AND
 *  on submit, so the form no longer produces one; a database written before
 *  that fix still can.
 *  ★★ THAT USED TO END "…which is exactly why `repairScheduleDays` below exists
 *  rather than a bare drop", and it is no longer the reason for anything on the
 *  load path: a legacy `1.5` is now neither repaired nor dropped there, it is
 *  STORED AS 1.5. The legacy database is still the reason this predicate must
 *  not be mistaken for the loader's rule — it is why the loader has none — but
 *  `repairScheduleDays` now serves model CREATES alone. */
export const acceptsScheduleDays: ChangeFieldGuard = (v) => {
  if (!isCoercibleNumber(v)) return false;
  const n = toNumber(v);
  return Number.isInteger(n) && n >= 0;
};

/** Cost impact, in CURRENCY. Two decimals and capped, because the same modal
 *  clamps this one with `{ min: 0, max: AMOUNT_MAX, round: 2 }`.
 *
 *  ★★★ "THE TWO MOVE IN OPPOSITE DIRECTIONS" IS TRUE ONLY AGAINST §399 AS
 *  FILED, AND NAMING THE BASELINE IS THE POINT. Against the register entry the
 *  preview LOOSENS here while the writer TIGHTENS for days. Against the code
 *  this commit actually edited — parent `3df2e4d0`, where both predicates were
 *  `Number.isFinite(n) && n >= 0` on the writer side AND the preview side —
 *  cost TIGHTENS too, gaining a cap and a precision rule days never had. The
 *  "cost loosens" story is what steered a reader away from looking for a
 *  cost-side LOAD risk, and a legacy over-cap cost was in fact being dropped
 *  silently until `repairCostAmount` below. State the baseline or the framing
 *  hides the exposure.
 *
 *  ★★ The CAP was not in §399 as filed. Neither side had an upper bound while
 *  the form clamps at AMOUNT_MAX, so a model could store a cost a thousand
 *  times larger than a person can type. Same predicate, same edit, same field. */
export const acceptsCostAmount: ChangeFieldGuard = (v) => {
  if (!isCoercibleNumber(v)) return false;
  const n = toNumber(v);
  if (!Number.isFinite(n) || n < 0 || n > AMOUNT_MAX) return false;
  // Two decimals, compared with a magnitude-scaled tolerance rather than with
  // `Math.round(n * 100) / 100 === n`.
  //
  // ★★ DO NOT "SIMPLIFY" THIS TO THE EXACT COMPARISON ON THE STRENGTH OF A
  //  SPOT CHECK, and do not restore the reason that used to be given for it.
  //  The justification written into the plan for this change was that
  //  `1500.55 !== Math.round(1500.55 * 100) / 100` in binary floating point.
  //  That is FALSE — measured in node, they are exactly equal — and so is the
  //  general form of it: over EVERY two-decimal value in [0, 20000] and every
  //  one in [999999000, 1000000000] (both enumerated as `c/100` over the
  //  integer `c`, so 2_000_001 and 100_001 values respectively), the exact
  //  comparison rejects NONE. ★ Quote the ENUMERATION, not the count — "the
  //  100_001 values below AMOUNT_MAX" stood here and named no step, so nobody
  //  could reproduce it. The two forms are empirically indistinguishable here.
  //  What keeps the tolerance is the DIRECTION of the remaining risk, not a
  //  counterexample: `Math.abs(...) < tol` is strictly more permissive than
  //  `=== n`, so it can only ever admit a value the form produces, never refuse
  //  one — and refusing one would be silent data loss on the writer's side. The
  //  scan is evidence about a range; the inequality is a property. Measured
  //  from the other end too: across 20_000_000 three-decimal values, the
  //  tolerance never admits one the exact comparison would have refused, so
  //  the extra permissiveness costs the rule nothing.
  return Math.abs(Math.round(n * 100) / 100 - n) < Number.EPSILON * Math.max(1, Math.abs(n));
};

/** ★★★ ACCEPTANCE AND REPAIR ARE DIFFERENT QUESTIONS, AND THESE ARE NOT A
 *  SECOND SPELLING OF THE TWO PREDICATES ABOVE. The instinct on reading the
 *  four together is to "unify" them. Do not — they answer different questions
 *  about different data:
 *
 *  - A MODEL UPDATE must be REFUSED, so `dropUnacceptedChangeFields` drops the
 *    key and the STORED value survives. The preview shows that same refusal
 *    because it calls the same predicate (§405), which is the whole slice.
 *  - A MODEL CREATE has no stored value to protect, so it is REPAIRED instead:
 *    `sanitizeModelChangeItem` below rounds a model's `1.5` to 2 rather than
 *    losing the field. The create card promises nothing per-field to contradict
 *    — `describeEntityCalls` pushes a create into `plan.creates` verbatim and
 *    runs no `numericFields` check on one, and `chat-proposal-block.tsx` renders
 *    it as entity + title alone — so neither repair nor drop is a divergence
 *    there, and repair keeps the value the model actually asked for.
 *  - EXISTING DATA is left VERBATIM. `sanitizeChangeItem` stores the number a
 *    person saved and neither rounds nor caps it. Rewriting stored data on load
 *    is the defect this trio was reorganised to stop; the reasoning is on that
 *    function, at the two numeric lines.
 *
 *  ★★★ THESE HELPERS ARE NO LONGER REACHED FROM `sanitizeChangeItem`, AND AN
 *  EARLIER SHAPE OF THIS FILE RAN THEM ON EVERY LOAD. Do not wire them back in
 *  "to complete the pattern": five of the six write paths' read side funnel
 *  through that sanitizer, so a repair there is a silent rewrite of five
 *  backends at once. Repair belongs to the wrapper, which only model callers
 *  use.
 *
 *  ★★ A BOOLEAN IS NOT REPAIRED, and that is the one case with no correct
 *  repair: `toNumber(true)` is 1, the exact fabrication §395 refuses. Every
 *  repair is gated on `isCoercibleNumber` before it runs — and so is the
 *  verbatim store, so the fabrication is refused on BOTH paths.
 *
 *  ★★ REPAIR CANNOT WIDEN WHAT LANDS, even though nothing re-gates it any more.
 *  `repairCostAmount` returns a non-negative two-decimal value at or below
 *  AMOUNT_MAX and `repairScheduleDays` returns an integer, so every output is
 *  one the predicates already admit — with the single documented exception of
 *  `-0` from the `[-0.5, 0)` window, whose measurement and justification live in
 *  `sanitize-records.test.ts`. Read that before "fixing" it by symmetry with
 *  `repairCostAmount`'s floor: that reasoning was raised, measured and rejected,
 *  and the leg would not even stop a stored `-0` (`-0 < 0` is false). */
const repairScheduleDays = (v: unknown): number | undefined => {
  if (!isCoercibleNumber(v)) return undefined;
  const n = toNumber(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
};

/** ★★ MIRRORS THE ARITHMETIC IN `sanitizeAmount` (`sanitize-entities.ts`) —
 *  `Math.min(AMOUNT_MAX, Math.round(num * 100) / 100)` — rather than calling it,
 *  and the choice is deliberate rather than an oversight. That function is
 *  private, but exporting it would import its EMPTY-STRING leg with it
 *  (`"" -> undefined`, "an empty CSV/MD cell is absent, not 0"), which this
 *  field does not have: `toNumber("")` is 0, and the change loader stores that
 *  0 — under its OWN verbatim rule now, NOT via `acceptsCostAmount`, which no
 *  longer runs on the load path at all. The predicate admits 0 as well, so the
 *  preview still agrees with the write; `plan.sanitizer-parity.test.ts` pins
 *  that pair with an explicit `""` probe. Adopting the whole function would silently
 *  turn a stored 0 into a dropped key, i.e. a repair commit causing exactly the
 *  loss it exists to prevent. Only the one arithmetic expression is shared, and
 *  a negative stays DROPPED here as it is there. */
const repairCostAmount = (v: unknown): number | undefined => {
  if (!isCoercibleNumber(v)) return undefined;
  const n = toNumber(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(AMOUNT_MAX, Math.round(n * 100) / 100);
};

/**
 * Sanitize a MODEL-authored change, REPAIRING the two numeric fields first.
 *
 * ★★★ THE ONLY DIFFERENCE FROM `sanitizeChangeItem` IS THAT REPAIR, and the
 * split exists because the two functions serve populations with opposite needs.
 * The plain sanitizer's dominant callers are LOADS — five of the six write
 * paths' read side funnel through it — where a number is a person's saved data
 * and must survive untouched. This wrapper's callers are `createChange`
 * (`use-register-tools.ts`) and `proposalToSeed` (`ai-project-proposal.ts`),
 * where the number is a model's suggestion with no stored value behind it, so
 * rounding a `1.5` to 2 keeps the field the model asked for instead of losing it.
 * ★★ Only the FIRST still reaches the repair: `SEED_OFFERED_KEYS` drops every
 * property `PROPOSAL_TOOL` did not offer, and its seed `changes` items offer
 * `title`/`description` alone, so neither amount arrives via `proposalToSeed`.
 * Keep the wrapper — it goes live the day that schema offers a number. Verify:
 *   sed -n '/^          changes: {/,/^          },/p' src/app/ai-project-proposal.ts
 *
 * ★★★ NOT FOR AN UPDATE, and wiring it into one would re-open the defect this
 * branch exists to close. `updateChange` runs `dropUnacceptedChangeFields` and
 * must go on doing so: the AI edit preview refuses a fractional day count
 * through the very same predicate (§405), so repairing there would show the user
 * a refusal and then write a repaired value. A CREATE is safe to repair only
 * because its card promises nothing per-field — `describeEntityCalls` pushes a
 * create into `plan.creates` verbatim with no `numericFields` check, and
 * `chat-proposal-block.tsx` renders it as entity + title alone.
 *
 * ★ A shape with no correct repair has its key REMOVED rather than passed
 * through, so the contract is self-contained: every field this touches is either
 * a repaired number or absent. `sanitizeChangeItem` would refuse those same
 * shapes anyway (`isCoercibleNumber`, finite, `>= 0`), so the two agree on every
 * refusal and differ only on what is repairable.
 */
export function sanitizeModelChangeItem(input: unknown): ChangeItem | null {
  if (!isPlainObject(input)) return sanitizeChangeItem(input);
  const repaired: Record<string, unknown> = { ...input };
  const days = repairScheduleDays(input.scheduleImpactDays);
  if (days === undefined) {
    delete repaired.scheduleImpactDays;
  } else {
    repaired.scheduleImpactDays = days;
  }
  const cost = repairCostAmount(input.costImpact);
  if (cost === undefined) {
    delete repaired.costImpact;
  } else {
    repaired.costImpact = cost;
  }
  return sanitizeChangeItem(repaired);
}

/** ★★★ `status` IS ABSENT ON PURPOSE, and adding it would be a REGRESSION, not
 *  a completion. `updateChange` runs `applyModelChangeStatus` (`change-log.ts`)
 *  after the sanitizer: it gates on the model's RAW status, restores the stored
 *  one when the value is unrecognised, and routes a recognised one through
 *  `applyChangeStatus` so the coupled `decisionDate` moves with it. Dropping the
 *  key here would take that raw value away and turn "the model sent a status" into
 *  "the model sent nothing", skipping the transition. */
const CHANGE_FIELD_GUARDS: Readonly<Record<string, ChangeFieldGuard>> = {
  // ★★★ NOT MODEL-WRITABLE, AND THE ONLY THING THAT MAKES THAT TRUE IS THIS
  //  ENTRY. `knowledgeLinks` appears in NO tool schema (`grep -c knowledgeLinks
  //  src/app/chat-tool-defs.ts` -> 0), but NEITHER strip helper has a whitelist
  //  (`patchWithoutId` on update, `createInputWithoutId` on create), so absence
  //  from the schema protects nothing by itself — the comment above this table says so, and this field was the live instance of it.
  //  ★★ WHAT IT COST: the sanitizer reads the merged `{...existing, ...patch}`,
  //  so a patch value REPLACED the stored links before `sanitizeKnowledgeLinks`
  //  ran; garbage reduced to `[]`, the sparse `if (dl.length)` then omitted the
  //  key, and the stored links were GONE. The preview could not disclose any of
  //  it — `knowledgeLinks` is neither a `diffField` nor a `linkField` — so the
  //  card said nothing while the write destroyed user data.
  //  ★★ MEASURED, not reasoned: `plan.write-path-sweep.test.ts` drove it on all
  //  four registers that carry the field and reported the wipe on every one, for
  //  both an empty array and a non-array string. It is the first thing that
  //  demonstrated a defect this file had documented as a known risk since the
  //  merge-site guards landed.
  //  ★ `() => false` rather than a shape check ON PURPOSE. A predicate that
  //  accepted a well-formed array would still let the model CLEAR the links (a
  //  valid empty array is a legitimate shape), and the card still could not
  //  disclose it. Nothing may reach this field from a model patch until the
  //  descriptor can show what it does.
  knowledgeLinks: () => false,
  type: (v) => typeof v === "string" && CHANGE_TYPE_SET.has(v),
  impact: (v) => typeof v === "string" && CHANGE_IMPACT_SET.has(v),
  raisedDate: acceptsChangeDate,
  // ★★★ NOT MODEL-WRITABLE, AND THIS ROW IS WHAT MAKES THAT TRUE — the same
  //  shape as `knowledgeLinks` above. `decisionDate` was withdrawn from
  //  `changeFields` (`chat-tool-defs.ts`) because it is DERIVED: for every
  //  TRANSITION in the app, only `applyChangeStatus` (`change-log.ts`) may stamp
  //  or clear it, and the edit modal renders it read-only.
  //  ★★ READ THAT QUALIFIER LITERALLY — the TRANSITION is exclusive, the FIELD is
  //  not; `change-log.ts` owns that distinction and the round-trip scope, so do
  //  not restate them here. What belongs here: withdrawing a property from a
  //  schema protects nothing on its own, because NEITHER strip helper has a
  //  whitelist (`patchWithoutId` on update, `createInputWithoutId` on create) —
  //  an undeclared key still reaches the merge on either path. This row is the
  //  guard, on BOTH call sites of `dropUnacceptedChangeFields`.
  //  ★★ THE UPDATE ARM IS THE SHARPER OF THE TWO DEFECTS IT CLOSES.
  //  `applyModelChangeStatus` returns `{...item, status: stored}` when the model
  //  supplies no valid status, leaving `decisionDate` exactly as the merge
  //  produced it — so a model could date a decision on a change that stayed
  //  "Proposed" simply by OMITTING `status`, breaking the invariant
  //  `applyChangeStatus` exists to hold.
  //  ★ `() => false` not a shape check, for `knowledgeLinks`' reason above: a
  //  well-formed date is exactly what must not land.
  decisionDate: () => false,
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

  // ★★★ THESE THREE CALL THE MERGE-SITE GUARDS; THEY DO NOT RESTATE THEM
  //  (open-followups §405). Until this commit `RAID_FIELD_GUARDS` and this
  //  function each held its own copy of the category, status and severity
  //  rules, ~120 lines apart, and no test could see them drift: every
  //  `it.each` row asserts one chosen value against BOTH sides at once, so a
  //  value the two disagree about is exactly the value nobody wrote a row for.
  //  `probability`/`impact` were inverted first (`acceptsRiskScale`); these
  //  are the tail that was left.
  const category: RaidCategory = acceptsRaidCategory(o.category) ? (o.category as RaidCategory) : "R";

  const { statuses } = statusSetForCategory(category);
  const status: RaidStatus =
    acceptsRaidStatus(o.status, category) ? (o.status as RaidStatus) : statuses[0];

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

  if (acceptsRaidSeverity(o.severity)) {
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
  const esc = sanitizeRaidEscalations(o.escalations); if (esc.length) item.escalations = esc; // sparse (§515)

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
  // ★★★ THE BOOLEAN LEG IS THE DEFECT (open-followups §395). `toNumber(true)`
  //  is 1 — inside [1,5] — so a boolean stored a plausible-looking score that
  //  feeds `riskSeverityFromMatrix`, and the PREVIEW coerced identically and
  //  showed it as accepted, which is why it never appeared as a divergence.
  //  `toNumber(false)` is 0 and was already out of range, so only one half of
  //  the boolean pair was ever reachable.
  //  ★ Routed through the SHARED `isCoercibleNumber` rather than restating
  //  `typeof v === "boolean"`, so the boolean rule has one spelling across
  //  every numeric predicate in this file — the same §405 principle that made
  //  the sanitizer call these guards instead of duplicating them.
  if (!isCoercibleNumber(v)) return false;
  const n = toNumber(v);
  return Number.isInteger(n) && n >= 1 && n <= 5;
};

/** The three RAID enum rules, each with ONE spelling.
 *
 *  ★★★ SAME DIRECTION AS `acceptsRiskScale` ABOVE, AND THE DIRECTION IS THE
 *  POINT: `sanitizeRaidItem` calls these, rather than these restating what the
 *  sanitizer does. A merge-site guard that merely AGREES with the sanitizer is
 *  one edit away from disagreeing with it, and the disagreement is invisible —
 *  the preview refuses a value the write accepts, or the reverse, and the card
 *  then describes a write that did not happen.
 *
 *  ★★ THE FIRST TWO TAKE ONE ARGUMENT ON PURPOSE. `RaidFieldGuard` threads the
 *  effective category because `status` is validated against it; `category` and
 *  `severity` are category-INDEPENDENT, so they are typed 1-ary and stay
 *  callable from the sanitizer with no meaningless second argument. A 1-ary
 *  function is assignable to the 2-ary guard type, so the table below is
 *  unaffected. */
export const acceptsRaidCategory = (v: unknown): boolean =>
  typeof v === "string" && RAID_CATEGORY_SET.has(v);

export const acceptsRaidSeverity = (v: unknown): boolean =>
  typeof v === "string" && RAID_SEVERITY_SET.has(v);

/** ★ Category-DEPENDENT, so it keeps the full `RaidFieldGuard` shape: the
 *  status vocabulary differs per category, and `sanitizeRaidItem` validates
 *  against the category it just resolved. */
export const acceptsRaidStatus: RaidFieldGuard = (v, category) =>
  typeof v === "string" && statusSetForCategory(category).set.has(v);

const RAID_FIELD_GUARDS: Readonly<Record<string, RaidFieldGuard>> = {
  // ★★★ NOT MODEL-WRITABLE, AND THE ONLY THING THAT MAKES THAT TRUE IS THIS
  //  ENTRY. `knowledgeLinks` appears in NO tool schema (`grep -c knowledgeLinks
  //  src/app/chat-tool-defs.ts` -> 0), but NEITHER strip helper has a whitelist
  //  (`patchWithoutId` on update, `createInputWithoutId` on create), so absence
  //  from the schema protects nothing by itself — the comment above this table says so, and this field was the live instance of it.
  //  ★★ WHAT IT COST: the sanitizer reads the merged `{...existing, ...patch}`,
  //  so a patch value REPLACED the stored links before `sanitizeKnowledgeLinks`
  //  ran; garbage reduced to `[]`, the sparse `if (dl.length)` then omitted the
  //  key, and the stored links were GONE. The preview could not disclose any of
  //  it — `knowledgeLinks` is neither a `diffField` nor a `linkField` — so the
  //  card said nothing while the write destroyed user data.
  //  ★★ MEASURED, not reasoned: `plan.write-path-sweep.test.ts` drove it on all
  //  four registers that carry the field and reported the wipe on every one, for
  //  both an empty array and a non-array string. It is the first thing that
  //  demonstrated a defect this file had documented as a known risk since the
  //  merge-site guards landed.
  //  ★ `() => false` rather than a shape check ON PURPOSE. A predicate that
  //  accepted a well-formed array would still let the model CLEAR the links (a
  //  valid empty array is a legitimate shape), and the card still could not
  //  disclose it. Nothing may reach this field from a model patch until the
  //  descriptor can show what it does.
  knowledgeLinks: () => false,
  // ★★★ NOT MODEL-WRITABLE. `ownerResourceId` appears in NO tool schema
  //  (`grep -c ownerResourceId src/app/chat-tool-defs.ts` -> 0, control on the
  //  same pattern: `title` 19, `status` 14) — but NEITHER strip helper has a
  //  whitelist (`patchWithoutId` / `createInputWithoutId` both forward it), so absence from the schema protects nothing on its own.
  //  ★★ WHAT IT COST: `fkIdOrUndefined` accepts any finite positive number and
  //  `null` clears the link, so a model patch REPOINTED a RAID item's owner to
  //  a different resource, or unlinked it, with the card silent — the field is
  //  neither a `diffField` nor a `linkField` on raid, so the preview has no
  //  vocabulary for it. Measured by `plan.write-path-sweep.test.ts` as three
  //  violations (4 -> 5, 4 -> undefined, "7" -> 7), filed as §435.
  //  ★ `() => false` rather than a shape check: an accepted well-formed id is
  //  still an owner reassignment the card cannot show. Nothing may reach this
  //  field from a model patch until the descriptor can disclose it.
  ownerResourceId: () => false,
  // ★★ NOT MODEL-WRITABLE (§515): app-written by Escalate. The ONLY model-write guard — deliberately absent from TOKEN_EXCLUDED.raid.
  escalations: () => false,
  category: acceptsRaidCategory,
  status: acceptsRaidStatus,
  severity: acceptsRaidSeverity,
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
 *  NEITHER strip helper has a whitelist — `patchWithoutId` (update) and
 *  `createInputWithoutId` (create) strip `id`, `expectedToken` and
 *  `TOKEN_EXCLUDED.stakeholder` (`localModifiedAt`) and forward the rest — so a
 *  patch carrying them lands, `raci` is overwritten unconditionally by
 *  `coerceRaciMap` (junk wipes the map) and the other two drop on a refused
 *  value. None is a `diffField` or a `linkField`, so the preview shows nothing
 *  either way. Pre-existing and out of this guard's scope, recorded because the
 *  milestone list one entity over made exactly this omission and had to be
 *  corrected for it — an exclusion list that reads as exhaustive and is not is
 *  the false assurance that stops the next audit. ★★ Both strips are load-bearing
 *  here: a denylist with no `localModifiedAt` row, and the field is PRESERVED. */
export const acceptsStakeholderCategory: StakeholderFieldGuard = (v) =>
  typeof v === "string" && STAKEHOLDER_CATEGORY_SET.has(v);
export const acceptsInfluenceInterest: StakeholderFieldGuard = (v) =>
  typeof v === "string" && INFLUENCE_INTEREST_SET.has(v);

const STAKEHOLDER_FIELD_GUARDS: Readonly<Record<string, StakeholderFieldGuard>> = {
  // ★★★ NOT MODEL-WRITABLE, AND THE SWEEP COULD NOT HAVE FOUND IT. `resourceId`
  //  is the FK linking a stakeholder to a Resource. It appears in NO tool schema
  //  (`sed -n '/^const stakeholderFields = {/,/^};/p' src/app/chat-tool-defs.ts`
  //  lists eight keys, none of them this one), it is NOT in
  //  `TOKEN_EXCLUDED.stakeholder` (which is `["localModifiedAt"]` alone), and
  //  `sanitizeStakeholder` STORES it — `toNumber` coerces, so `"7"` lands as 7.
  //  ★★★ WHY NO GATE SAW IT, and this is the durable lesson: the write-path
  //  sweep derives its field axis from the descriptor UNION the seed row's
  //  stored keys (`sweptFields`, `src/test/inline-sweep-fixtures.ts`). This
  //  field was in NEITHER, so the sweep passed over it in silence — it reported
  //  `Tests 37 passed (37)` while the defect was live. A green sweep bounds what
  //  it looked at, never what exists. Seeding `resourceId: 4` on the fixture
  //  turned it into three violations immediately:
  //    stakeholder.resourceId on one more than the stored number: 4 -> 5
  //    stakeholder.resourceId on a negative number:               4 -> undefined
  //    stakeholder.resourceId on a numeric string:                4 -> 7
  //  all three "with NO preview line". The middle one is the damaging direction:
  //  the store is sparse (`if (rid > 0)`) and the sanitizer rebuilds the record,
  //  so a negative or zero value SILENTLY UNLINKS the stakeholder from its
  //  resource behind a card that mentioned nothing. `stakeholder-resource-fk`
  //  is now seeded and axis-listed so this can never go quiet again, and
  //  `plan.model-writable-surface.test.ts` ratchets the whole class.
  //  ★★ Same shape as `raid.ownerResourceId` one entity over, which §435 fixed
  //  in the commit immediately before this one and MISSED here — the register's
  //  "seven fields" was the sweep's count, not the defect's.
  resourceId: () => false,
  // ★★★ NOT MODEL-WRITABLE, and `entity-descriptor.ts` already says so at its
  //  own `stakeholderFields` ("`Stakeholder.raci` IS a relationship, but
  //  `stakeholderFields` does not …"). It appears in NO tool schema
  //  (`grep -c raci src/app/chat-tool-defs.ts` -> 0). The descriptor knowing a
  //  field is unwritable is not a guard — `patchWithoutId` AND `createInputWithoutId` both still forward it, neither having a whitelist.
  //  ★★ WHAT IT COST: `sanitizeStakeholder` rebuilds `raci` from the merged
  //  blob, so ANY unrecognised patch value replaced the stored assignment map
  //  and reduced it to `{}` — every RACI role on that stakeholder erased,
  //  behind a card that showed nothing. Measured as three violations
  //  ({"30":"A"} -> {} on a padded string, the empty string and the number 42),
  //  filed as §435. Same destroy-user-data shape as `knowledgeLinks` below.
  raci: () => false,
  // ★★★ NOT MODEL-WRITABLE, AND THE ONLY THING THAT MAKES THAT TRUE IS THIS
  //  ENTRY. `knowledgeLinks` appears in NO tool schema (`grep -c knowledgeLinks
  //  src/app/chat-tool-defs.ts` -> 0), but NEITHER strip helper has a whitelist
  //  (`patchWithoutId` on update, `createInputWithoutId` on create), so absence
  //  from the schema protects nothing by itself — the comment above this table says so, and this field was the live instance of it.
  //  ★★ WHAT IT COST: the sanitizer reads the merged `{...existing, ...patch}`,
  //  so a patch value REPLACED the stored links before `sanitizeKnowledgeLinks`
  //  ran; garbage reduced to `[]`, the sparse `if (dl.length)` then omitted the
  //  key, and the stored links were GONE. The preview could not disclose any of
  //  it — `knowledgeLinks` is neither a `diffField` nor a `linkField` — so the
  //  card said nothing while the write destroyed user data.
  //  ★★ MEASURED, not reasoned: `plan.write-path-sweep.test.ts` drove it on all
  //  four registers that carry the field and reported the wipe on every one, for
  //  both an empty array and a non-array string. It is the first thing that
  //  demonstrated a defect this file had documented as a known risk since the
  //  merge-site guards landed.
  //  ★ `() => false` rather than a shape check ON PURPOSE. A predicate that
  //  accepted a well-formed array would still let the model CLEAR the links (a
  //  valid empty array is a legitimate shape), and the card still could not
  //  disclose it. Nothing may reach this field from a model patch until the
  //  descriptor can show what it does.
  knowledgeLinks: () => false,
  category: acceptsStakeholderCategory,
  influence: acceptsInfluenceInterest,
  interest: acceptsInfluenceInterest,
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

// --- Resource merge-site guard ---------------------------------------------
//
// ★★★ THE FIFTH DENYLIST TABLE, AND THE REGISTER THAT HAD NONE. `updateResource`
// merged the model's patch straight into `sanitizeResource` with nothing in
// between, which is why FIVE of §435's seven undisclosed fields lived here.
// open-followups §394 predicted this table's arrival and armed an alarm for it:
// `plan.sanitizer-parity.test.ts`'s `resourceReader` carries a SOURCE ASSERTION
// that reds the moment anything is inserted between the model's patch and
// `sanitizeResource`. That assertion going red on this commit is the alarm
// WORKING, not a regression — it means the reader must be recomposed to call
// this guard, exactly as `changeReader` and `stakeholderReader` already do.
//
// ★★ DENYLIST, matching the four tables above rather than the two allowlists
// below: it iterates the TABLE and deletes only refused fields, so every
// resource field NOT named here still reaches the sanitizer untouched. An
// allowlist here would silently drop every legitimately writable field the
// table forgot to name.
type ResourceFieldGuard = (value: unknown) => boolean;

/** Resource fields a model patch may not write, because the card cannot
 *  disclose them.
 *
 *  ★★★ ALL FIVE APPEAR 0 TIMES IN `chat-tool-defs.ts` AND
 *  `chat-tool-defs-documents.ts`, measured 2026-09-08 with a non-vacuity
 *  control on the same pattern (`title` 19, `name` 66, `status` 14,
 *  `category` 11 — so a bare 0 is not a broken regex). Nothing advertises any
 *  of them, so guarding costs no advertised capability. `entity-descriptor.ts`
 *  says as much for `birthday` in its own comments: "stored, but absent from
 *  `ResourceInput`: the tool cannot".
 *
 *  ★★ EACH WAS A REAL WRITE, not a theoretical reach — `plan.write-path-sweep`
 *  drove all five through the real dispatcher and read the stored row back:
 *  `utilizationMode` "hours" -> "percent", `utilization` and `absenceOverride`
 *  and `birthday` cleared outright, `active` false -> undefined. Fourteen of
 *  §435's twenty violations were these five.
 *
 *  ★ `active` was the one §435 hesitated over, on the grounds that a
 *  soft-archive flag's write might be intentional. It is not reachable
 *  intentionally: no schema declares it, so every write of it is a model
 *  guessing at a field it was never offered. */
const RESOURCE_FIELD_GUARDS: Readonly<Record<string, ResourceFieldGuard>> = {
  utilizationMode: () => false,
  utilization: () => false,
  birthday: () => false,
  absenceOverride: () => false,
  active: () => false,
};

export function dropUnacceptedResourceFields<T extends object>(patch: T): T {
  const raw = patch as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const [field, accepts] of Object.entries(RESOURCE_FIELD_GUARDS)) {
    if (!(field in raw) || accepts(raw[field])) continue;
    out ??= { ...raw };
    delete out[field];
  }
  return (out ?? patch) as T;
}

// --- Absence + calendar event merge-site guards -----------------------------
//
// ★★★ THESE TWO ARE ALLOWLISTS, NOT DENYLISTS — the opposite shape from the
// five guard tables above. `MILESTONE_FIELD_GUARDS` / `CHANGE_FIELD_GUARDS` /
// `RAID_FIELD_GUARDS` / `STAKEHOLDER_FIELD_GUARDS` / `RESOURCE_FIELD_GUARDS`
// (★ enumerate rather than trust this line:
// `grep -n "_FIELD_GUARDS: Readonly" src/app/sanitize-records.ts` — the rows
// above this comment are the denylists, the two below it the allowlists) all
// iterate their OWN
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
 *   above, though, the strip is NOT what makes those two unreachable here: this
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

export function sanitizeStakeholder(input: unknown): Stakeholder | null {
  if (!isPlainObject(input)) return null;
  const o = input;
  const id = toNumber(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = sanitizeText(o.name, BUDGET_NAME_MAX);
  if (!name) return null;

  const category = acceptsStakeholderCategory(o.category) ? (o.category as StakeholderCategory) : "Other";
  const influence = acceptsInfluenceInterest(o.influence) ? (o.influence as InfluenceInterest) : "Medium";
  const interest = acceptsInfluenceInterest(o.interest) ? (o.interest as InfluenceInterest) : "Medium";

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
  const email = sanitizeLoadedEmail(o.email, BUDGET_NAME_MAX); if (email) item.email = email;
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
  const email = sanitizeLoadedEmail(input.email);
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

/** Keep a valid IANA timezone string; drop empty/junk/non-string. */
export function sanitizeTimezone(raw: unknown): string | undefined {
  return typeof raw === "string" && isValidTimeZone(raw) ? raw : undefined;
}

/**
 * Full-record sanitizer for inbound ProjectMeta data (file imports, chat
 * tools, form round-trips). Returns null only for a non-object input, a
 * blank `name`, or a non-blank `naceSection`/`deployment` outside its known
 * set — every other key fact may be blank (`""` / `[]`) since O-1.
 */
export function sanitizeProjectMeta(input: unknown): ProjectMeta | null {
  if (!isPlainObject(input)) return null;
  const o = input;

  // ★★ Only `name` is required (O-1). Every other key fact may be blank, and ""
  // means "not set". Returning null here discards the WHOLE project, not the
  // field — so a guard on anything but `name` makes a legitimately incomplete
  // project vanish on its next load from any backend.
  const name = sanitizeText(o.name, BUDGET_NAME_MAX);
  if (!name) return null;
  const code = sanitizeText(o.code, BUDGET_NAME_MAX);
  const projectManager = sanitizeText(o.projectManager, BUDGET_NAME_MAX);
  const customer = sanitizeText(o.customer, BUDGET_NAME_MAX);
  const products = sanitizeText(o.products, BUDGET_NAME_MAX);
  const profitCenter = sanitizeText(o.profitCenter, BUDGET_NAME_MAX);

  // Enum fields: blank is "not set" and is kept. A NON-blank value outside the
  // set is garbage, and still rejects the record — the one guard O-1 keeps.
  const naceSection = sanitizeText(o.naceSection, 4);
  if (naceSection && !NACE_SECTION_SET.has(naceSection)) return null;

  const deploymentRaw = sanitizeText(o.deployment, BUDGET_NAME_MAX);
  if (deploymentRaw && !DEPLOYMENT_SET.has(deploymentRaw)) return null;
  const deployment = deploymentRaw as Deployment | "";

  // Both dates are optional; an unparseable value reads as "" (not set).
  const startDate = sanitizeIsoDate(o.startDate);
  const endDate = sanitizeIsoDate(o.endDate);

  // Key stakeholders (internal / external): any sanitized array, including empty.
  const keyStakeholdersInternal = sanitizeStringArray(o.keyStakeholdersInternal, BUDGET_NAME_MAX);
  const keyStakeholdersExternal = sanitizeStringArray(o.keyStakeholdersExternal, BUDGET_NAME_MAX);

  // regulatory — filter to the known set, de-dupe, collapse "Not applicable". Empty is kept.
  const rawRegArr: unknown[] = Array.isArray(o.regulatory) ? o.regulatory : [];
  const regulatoryFiltered: RegulatoryRequirement[] = [];
  const regulatorySeen = new Set<string>();
  for (const item of rawRegArr) {
    if (typeof item !== "string" || !REGULATORY_SET.has(item)) continue;
    if (regulatorySeen.has(item)) continue;
    regulatorySeen.add(item);
    regulatoryFiltered.push(item as RegulatoryRequirement);
  }
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

  // Build the always-present fields first (sanitizeStakeholder style).
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
 *  non-empty `html` string and a string `updatedAt` are present. Pure/SSR-safe.
 *  ★★ Within REPORT_HTML_MAX raw characters the body is BYTE-IDENTICAL (sanitized
 *  at write time). Over it, sanitizeRichText bounds VISIBLE text at the cap and
 *  degrades to plain text past it, never ending mid-tag or on a lone surrogate
 *  the way the old raw `.slice` could (open-followups §108).
 *  ★★★ OVER-CAP CLASSIFIES ON RENDER_SINK (unanchored "contains a tag
 *  anywhere?"), NOT anchored RICH_SINK ("starts with a rich tag?"): a report
 *  can legitimately OPEN with plain text before its first real tag, which the
 *  anchored test misread as prose and escaped WHOLE into literal
 *  `&lt;h2&gt;`/`&lt;p&gt;` text the next save then persisted (§108 r1).
 *  ★ RESIDUAL TRADE: prose merely MENTIONING a bare tag ("we banned <hr>
 *  rules"), with no real markup elsewhere, now passes through tag-intact
 *  instead of escaped (RENDER_SINK's accepted cost, html-start.ts) — reachable
 *  only via a hand-edited/foreign report, since `onSaveReport` runs
 *  sanitizeRichHtml first and entity-escapes any typed tag; no text is lost. */
function sanitizeMeetingReport(raw: unknown): MeetingReport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rr = raw as Record<string, unknown>;
  if (typeof rr.html !== "string" || rr.html.length === 0) return undefined;
  if (typeof rr.updatedAt !== "string") return undefined;
  const html = rr.html.length <= REPORT_HTML_MAX ? rr.html : sanitizeRichText(rr.html, REPORT_HTML_MAX, RENDER_SINK);
  if (!html) return undefined;
  const out: MeetingReport = { html, updatedAt: rr.updatedAt };
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
