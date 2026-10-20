// src/app/project-ai-fields.ts
//
// The one list of ProjectMeta fields Claude may read and set, and the judge that
// decides, FIELD BY FIELD, what a model-supplied value becomes. Pure and i18n-free.
//
// ★ `sanitizeProjectMeta` cannot be the judge: it drops the whole record on a bad
// NACE/deployment and truncates silently. Here a bad value refuses ONE field, and a
// value stored in a different shape than offered is reported as "normalised".

import type { ProjectMeta } from "./types";
import {
  REGULATORY_REQUIREMENTS,
  REGULATORY_NOT_APPLICABLE,
  IDENTITY_TYPE_SET,
  DEPLOYMENT_SET,
} from "./project-options";
import { NACE_SECTION_SET } from "./nace-sections";
import { BUDGET_NAME_MAX } from "./sanitize-entities";
import { TEXTAREA_MAX, sanitizeText, sanitizeIsoDate, toNumber } from "./sanitize-core";
import { isSafeHttpUrl } from "./document-link";
import { isValidTimeZone } from "./timezone";

/** The offered keys, in the order the review card lists them. */
export const PROJECT_AI_FIELDS = [
  "name", "code", "description", "sponsor", "projectManager", "customer", "products",
  "platform", "profitCenter", "quotes", "notes", "docRepoLocation",
  "startDate", "endDate",
  "regulatory", "identityTypes", "deployment", "naceSection",
  "identityCount", "stakeholderCount",
  "operatingTimezone",
  "jiraUrl", "salesforceUrl", "sharepointUrl", "confluenceUrl",
] as const satisfies readonly (keyof ProjectMeta)[];

export type ProjectAiField = (typeof PROJECT_AI_FIELDS)[number];

/** Keys Claude never touches, each with the reason it stays a hand edit. */
export const PROJECT_AI_EXCLUDED: Readonly<Record<Exclude<keyof ProjectMeta, ProjectAiField>, string>> = {
  contactPersons: "Contact persons carry personal data and ids; they are edited in the project form.",
  keyStakeholdersInternal: "Legacy list, replaced by the stakeholder register and stakeholderCount.",
  keyStakeholdersExternal: "Legacy list, replaced by the stakeholder register and stakeholderCount.",
  knowledgeLinks: "Linked SharePoint files are picked in the Knowledge view, not typed.",
};

export type FieldVerdict =
  | { kind: "accepted"; value: unknown }
  | { kind: "normalised"; value: unknown; note: string }
  | { kind: "refused"; reason: string };

type DateContext = { startDate: string; endDate: string };

const TEXT_CAPS: Partial<Record<ProjectAiField, number>> = {
  name: BUDGET_NAME_MAX, code: BUDGET_NAME_MAX, sponsor: BUDGET_NAME_MAX,
  projectManager: BUDGET_NAME_MAX, customer: BUDGET_NAME_MAX, products: BUDGET_NAME_MAX,
  platform: BUDGET_NAME_MAX, profitCenter: BUDGET_NAME_MAX, docRepoLocation: BUDGET_NAME_MAX,
  description: TEXTAREA_MAX, quotes: TEXTAREA_MAX, notes: TEXTAREA_MAX,
};
const URL_FIELDS: ReadonlySet<string> = new Set(["jiraUrl", "salesforceUrl", "sharepointUrl", "confluenceUrl"]);
const REGULATORY_SET = new Set<string>(REGULATORY_REQUIREMENTS);

const accept = (value: unknown): FieldVerdict => ({ kind: "accepted", value });
const refuse = (reason: string): FieldVerdict => ({ kind: "refused", reason });

/** Accepted when the stored form equals the raw input, else normalised. */
function verdictFor(raw: unknown, value: unknown, note: string): FieldVerdict {
  return JSON.stringify(raw) === JSON.stringify(value) ? accept(value) : { kind: "normalised", value, note };
}

function judgeText(field: ProjectAiField, raw: unknown, cap: number): FieldVerdict {
  if (typeof raw !== "string") return refuse("Expected text.");
  const value = sanitizeText(raw, cap);
  if (field === "name" && !value) return refuse("The name cannot be blank.");
  const trimmed = raw.trim();
  if (value.length < trimmed.length) return { kind: "normalised", value, note: `Shortened to ${cap} characters.` };
  return verdictFor(raw, value, "Whitespace trimmed.");
}

function judgeUrl(raw: unknown): FieldVerdict {
  if (typeof raw !== "string") return refuse("Expected a web address.");
  const value = raw.trim();
  if (!value) return accept("");
  if (value.length > BUDGET_NAME_MAX) return refuse(`The address is longer than ${BUDGET_NAME_MAX} characters.`);
  if (!isSafeHttpUrl(value)) return refuse("Only http(s) addresses are accepted.");
  return verdictFor(raw, value, "Whitespace trimmed.");
}

function judgeDate(field: "startDate" | "endDate", raw: unknown, ctx: DateContext): FieldVerdict {
  if (typeof raw !== "string") return refuse("Expected a date as YYYY-MM-DD.");
  const value = raw.trim();
  if (!value) return accept("");
  const date = sanitizeIsoDate(value);
  if (!date) return refuse("Not a real calendar date; use YYYY-MM-DD.");
  if (field === "endDate" && ctx.startDate && date < ctx.startDate) return refuse("The end date cannot be before the start date.");
  if (field === "startDate" && ctx.endDate && date > ctx.endDate) return refuse("The start date cannot be after the end date.");
  return verdictFor(raw, date, "Whitespace trimmed.");
}

const QUOTE_CAP = 40;

/** Model input quoted back in a refusal reason, capped so a long value cannot flood the card or the tool result. */
const quoted = (v: unknown): string => {
  const s = String(v);
  return s.length > QUOTE_CAP ? `${s.slice(0, QUOTE_CAP)}…` : s;
};

function judgeEnumArray(raw: unknown, allowed: ReadonlySet<string>, label: string): { items: string[]; error?: string } {
  if (!Array.isArray(raw)) return { items: [], error: "Expected a list." };
  const items: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !allowed.has(item)) return { items: [], error: `Unknown ${label}: ${quoted(item)}.` };
    if (!items.includes(item)) items.push(item);
  }
  return { items };
}

function judgeRegulatory(raw: unknown): FieldVerdict {
  const { items, error } = judgeEnumArray(raw, REGULATORY_SET, "regulation");
  if (error) return refuse(error);
  const collapsed = items.includes(REGULATORY_NOT_APPLICABLE) ? [REGULATORY_NOT_APPLICABLE] : items;
  return verdictFor(raw, collapsed, "Duplicates removed; \"Not applicable\" stands alone.");
}

function judgeIdentityTypes(raw: unknown): FieldVerdict {
  const { items, error } = judgeEnumArray(raw, IDENTITY_TYPE_SET, "identity type");
  return error ? refuse(error) : verdictFor(raw, items, "Duplicates removed.");
}

function judgeEnum(raw: unknown, allowed: ReadonlySet<string>, label: string): FieldVerdict {
  if (typeof raw !== "string") return refuse(`Expected a ${label}.`);
  const value = raw.trim();
  if (value && !allowed.has(value)) return refuse(`"${quoted(value)}" is not a known ${label}.`);
  return verdictFor(raw, value, "Whitespace trimmed.");
}

function judgeCount(raw: unknown): FieldVerdict {
  if (raw === "") return accept("");
  if (typeof raw !== "number" && typeof raw !== "string") return refuse("Expected a whole number.");
  // §761 — a string counts only as plain digits: `Number()` alone reads " " as 0, "0x10" as 16 and "1e3" as 1000.
  if (typeof raw === "string" && !/^\d+$/.test(raw.trim())) return refuse("Expected a whole number of zero or more.");
  const n = toNumber(raw);
  if (!Number.isInteger(n) || n < 0) return refuse("Expected a whole number of zero or more.");
  return accept(n); // a numeric string is read as its number without comment
}

function judgeTimezone(raw: unknown): FieldVerdict {
  if (typeof raw !== "string") return refuse("Expected a timezone name.");
  const value = raw.trim();
  if (!value) return accept("");
  if (!isValidTimeZone(value)) return refuse(`"${quoted(value)}" is not a timezone the app knows (e.g. Europe/Berlin).`);
  return verdictFor(raw, value, "Whitespace trimmed.");
}

/** Judge ONE field. `context` carries the (merged) dates the date rule compares against. */
export function judgeProjectField(field: ProjectAiField, raw: unknown, context: DateContext): FieldVerdict {
  const cap = TEXT_CAPS[field];
  if (cap !== undefined) return judgeText(field, raw, cap);
  if (URL_FIELDS.has(field)) return judgeUrl(raw);
  switch (field) {
    case "startDate":
    case "endDate": return judgeDate(field, raw, context);
    case "regulatory": return judgeRegulatory(raw);
    case "identityTypes": return judgeIdentityTypes(raw);
    case "deployment": return judgeEnum(raw, DEPLOYMENT_SET, "deployment");
    case "naceSection": return judgeEnum(raw, NACE_SECTION_SET, "NACE section");
    case "identityCount":
    case "stakeholderCount": return judgeCount(raw);
    case "operatingTimezone": return judgeTimezone(raw);
    default: return refuse("Not a field Claude may set.");
  }
}

const OFFERED: ReadonlySet<string> = new Set(PROJECT_AI_FIELDS);
const IGNORED_KEYS: ReadonlySet<string> = new Set(["expectedToken"]);
const OPTIONAL_CLEARABLE: ReadonlySet<string> = new Set([
  "description", "sponsor", "platform", "quotes", "notes", "docRepoLocation", "identityCount",
  "stakeholderCount", "operatingTimezone", "jiraUrl", "salesforceUrl", "sharepointUrl", "confluenceUrl",
]);

type PatchRow = { field: ProjectAiField; before: unknown; verdict: FieldVerdict };

/** Write one judged value into a copy of the record; a blank optional field is removed. */
function withField(meta: ProjectMeta, field: ProjectAiField, value: unknown): ProjectMeta {
  const next: Record<string, unknown> = { ...meta };
  if (OPTIONAL_CLEARABLE.has(field) && value === "") delete next[field];
  else next[field] = value;
  return next as ProjectMeta;
}

/**
 * Judge every offered key in `raw` and build the next record from accepted and
 * normalised values only. Fields not passed stay as stored. Dates are judged
 * against the merged pair: end against the (accepted) start, start against the
 * end only when the patch does not pass one.
 */
export function applyProjectPatch(
  stored: ProjectMeta,
  raw: Record<string, unknown>,
): { next: ProjectMeta; rows: PatchRow[]; unknownKeys: string[] } {
  const unknownKeys = Object.keys(raw).filter((k) => !OFFERED.has(k) && !IGNORED_KEYS.has(k));
  const rows: PatchRow[] = [];
  let next = stored;
  let startDate = stored.startDate;
  const endInPatch = Object.prototype.hasOwnProperty.call(raw, "endDate");
  for (const field of PROJECT_AI_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) continue;
    const ctx = { startDate, endDate: field === "startDate" && endInPatch ? "" : stored.endDate };
    const verdict = judgeProjectField(field, raw[field], ctx);
    rows.push({ field, before: stored[field], verdict });
    if (verdict.kind === "refused") continue;
    next = withField(next, field, verdict.value);
    if (field === "startDate") startDate = verdict.value as string;
  }
  // The per-field pass judged a new start against NO end when the patch passed one; if that end
  // was refused, the stored end remains and the pair must still hold.
  const startRow = rows.find((r) => r.field === "startDate");
  if (startRow && startRow.verdict.kind !== "refused" && next.endDate && next.startDate > next.endDate) {
    startRow.verdict = refuse("The start date cannot be after the end date.");
    next = withField(next, "startDate", stored.startDate);
  }
  return { next, rows, unknownKeys };
}
