// src/app/project-validation.ts
//
// Pure, per-field validation for the project-meta form. Single source of truth
// shared by the submit handler, inline per-field error display, and submit
// gating (Save button's disabled state). Returns i18n message KEYS keyed by
// form field — no rendering, no i18n resolution, no React here.

import { type IdentityType, type Deployment, type RegulatoryRequirement, type ContactPerson } from "./types";
import { sanitizeIsoDate } from "./sanitize";

// ---------------------------------------------------------------------------
// Form draft type
// ---------------------------------------------------------------------------

/** In-progress form shape for project-meta editing. Only `name` is required
 *  (O-1); every other string may stay blank and every array may stay empty. */
export type ProjectDraft = {
  // Identity
  name: string;
  code: string;
  // People
  projectManager: string;
  keyStakeholdersInternal: string[];
  keyStakeholdersExternal: string[];
  // Customer
  customer: string;
  naceSection: string;
  products: string;
  deployment: Deployment | "";
  // Dates
  startDate: string;
  endDate: string;
  // Finance
  profitCenter: string;
  // Regulatory / identity
  regulatory: RegulatoryRequirement[];
  identityTypes: IdentityType[];
  // People (optional array)
  contactPersons: ContactPerson[];
  // URLs (optional; blank is allowed)
  salesforceUrl: string;
  sharepointUrl: string;
  confluenceUrl: string;
  jiraUrl: string;
};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** The project-meta form fields that can carry a validation error. */
export type ProjectErrorField =
  | "name"
  | "endDate"
  | "salesforceUrl"
  | "sharepointUrl"
  | "confluenceUrl"
  | "jiraUrl";

/** i18n message keys used for inline project-meta form errors. */
export type ProjectErrorKey =
  | "errorProjectNameRequired"
  | "errorEndBeforeStart"
  | "errorInvalidUrl";

export type ProjectFieldErrors = Partial<Record<ProjectErrorField, ProjectErrorKey>>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns true when `v` is a non-blank http(s) URL; false otherwise. */
function isLikelyUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Validation function
// ---------------------------------------------------------------------------

/**
 * Validate a project-meta form draft. Returns a map of field → i18n error key
 * for every invalid field; an empty object means the draft is valid.
 */
export function validateProjectMeta(draft: ProjectDraft): ProjectFieldErrors {
  const errors: ProjectFieldErrors = {};

  // Only the name is required (O-1). Every other key fact may stay blank.
  if (!draft.name.trim()) errors.name = "errorProjectNameRequired";

  // Date validation — both optional.
  const startDate = sanitizeIsoDate(draft.startDate);
  const endDate = sanitizeIsoDate(draft.endDate);

  // End date is optional; when present it must not precede the start date.
  if (endDate && startDate && endDate < startDate) {
    errors.endDate = "errorEndBeforeStart";
  }

  // URL validation — blank is allowed; non-blank must be a valid http(s) URL.
  if (draft.salesforceUrl && !isLikelyUrl(draft.salesforceUrl))
    errors.salesforceUrl = "errorInvalidUrl";
  if (draft.sharepointUrl && !isLikelyUrl(draft.sharepointUrl))
    errors.sharepointUrl = "errorInvalidUrl";
  if (draft.confluenceUrl && !isLikelyUrl(draft.confluenceUrl))
    errors.confluenceUrl = "errorInvalidUrl";
  if (draft.jiraUrl && !isLikelyUrl(draft.jiraUrl))
    errors.jiraUrl = "errorInvalidUrl";

  return errors;
}

/** True when the draft has at least one validation error (gates submit). */
export function hasProjectErrors(errors: ProjectFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
