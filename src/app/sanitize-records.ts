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
  sanitizeDocumentLinks,
} from "./document-link";
import {
  isValidTimeZone,
} from "./timezone";
import {
  TASK_NAME_MAX,
  TEXTAREA_MAX,
  toNumber,
  sanitizeText,
  sanitizeMultiline,
  sanitizeEmail,
  sanitizeIsoDate,
  fkIdOrUndefined,
  isPlainObject,
} from "./sanitize-core";
import {
  BUDGET_NAME_MAX,
  sanitizeIdList,
} from "./sanitize-entities";

/** Accept only well-formed milestones from untrusted JSON. id>0, name+date
 *  required; linkedTaskIds reduced to positive finite ints. */
export function sanitizeMilestone(input: unknown): Milestone | null {
  if (!isPlainObject(input)) return null;
  const o = input;
  const id = toNumber(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = sanitizeText(o.name, BUDGET_NAME_MAX);
  if (!name) return null;
  const date = sanitizeIsoDate(o.date);
  if (!date) return null;
  const linkedTaskIds = Array.isArray(o.linkedTaskIds)
    ? o.linkedTaskIds.map((n) => toNumber(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const m: Milestone = { id: Math.floor(id), name, date, linkedTaskIds };
  const achievedDate = sanitizeIsoDate(o.achievedDate);
  if (achievedDate) m.achievedDate = achievedDate;
  const description = sanitizeText(o.description, TEXTAREA_MAX);
  if (description) m.description = description;
  const localModifiedAt = sanitizeText(o.localModifiedAt, TEXTAREA_MAX);
  if (localModifiedAt) m.localModifiedAt = localModifiedAt;
  const dl = sanitizeDocumentLinks((input as Record<string, unknown>).documentLinks);
  if (dl.length) m.documentLinks = dl;
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
    description: sanitizeText(o.description, TEXTAREA_MAX),
    type,
    status,
    raisedDate: sanitizeIsoDate(o.raisedDate),
    linkedTaskIds: sanitizeIdList(o.linkedTaskIds),
    linkedRaidIds: sanitizeIdList(o.linkedRaidIds),
    stakeholderIds: sanitizeIdList(o.stakeholderIds),
  };
  if (typeof o.impact === "string" && CHANGE_IMPACT_SET.has(o.impact)) item.impact = o.impact as ChangeItem["impact"];
  const impactDesc = sanitizeText(o.impactDescription, TEXTAREA_MAX); if (impactDesc) item.impactDescription = impactDesc;
  const days = toNumber(o.scheduleImpactDays); if (Number.isFinite(days) && days >= 0) item.scheduleImpactDays = days;
  const cost = toNumber(o.costImpact); if (Number.isFinite(cost) && cost >= 0) item.costImpact = cost;
  const reqBy = sanitizeText(o.requestedBy, BUDGET_NAME_MAX); if (reqBy) item.requestedBy = reqBy;
  const decBy = sanitizeText(o.decisionBy, BUDGET_NAME_MAX); if (decBy) item.decisionBy = decBy;
  const decDate = sanitizeIsoDate(o.decisionDate); if (decDate) item.decisionDate = decDate;
  const notes = sanitizeText(o.resolutionNotes, TEXTAREA_MAX); if (notes) item.resolutionNotes = notes;
  const lma = sanitizeText(o.localModifiedAt, TEXTAREA_MAX); if (lma) item.localModifiedAt = lma;
  const dl = sanitizeDocumentLinks((input as Record<string, unknown>).documentLinks);
  if (dl.length) item.documentLinks = dl;
  const oeid = sanitizeText(o.outlookEventId, 1024); if (oeid) item.outlookEventId = oeid;
  return item;
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

  const description = sanitizeMultiline(o.description, TEXTAREA_MAX);
  if (description) item.description = description;
  const mitigation = sanitizeMultiline(o.mitigation, TEXTAREA_MAX);
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

  const prob = toNumber(o.probability);
  if (Number.isInteger(prob) && prob >= 1 && prob <= 5) item.probability = prob as RiskScale;
  const imp = toNumber(o.impact);
  if (Number.isInteger(imp) && imp >= 1 && imp <= 5) item.impact = imp as RiskScale;

  const targetDate = sanitizeIsoDate(o.targetDate);
  if (targetDate) item.targetDate = targetDate;
  const closedDate = sanitizeIsoDate(o.closedDate);
  if (closedDate) item.closedDate = closedDate;
  const lma = sanitizeText(o.localModifiedAt, TEXTAREA_MAX);
  if (lma) item.localModifiedAt = lma;

  const dl = sanitizeDocumentLinks((input as Record<string, unknown>).documentLinks);
  if (dl.length) item.documentLinks = dl;

  const outlookEventId = typeof o.outlookEventId === "string" ? o.outlookEventId.slice(0, 1024) : "";
  if (outlookEventId) item.outlookEventId = outlookEventId;

  return item;
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
  const dl = sanitizeDocumentLinks((input as Record<string, unknown>).documentLinks);
  if (dl.length) item.documentLinks = dl;
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

  // Optional documentLinks — pass through sanitized array (empty → omit).
  const dl = sanitizeDocumentLinks((input as Record<string, unknown>).documentLinks);
  if (dl.length) meta.documentLinks = dl;

  return meta;
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
