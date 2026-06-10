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

/** In-progress form shape for project-meta editing. Required string fields
 *  may be blank while the user is typing; array fields are always arrays. */
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
};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** The project-meta form fields that can carry a validation error. */
export type ProjectErrorField =
  | "name"
  | "code"
  | "projectManager"
  | "customer"
  | "products"
  | "profitCenter"
  | "naceSection"
  | "deployment"
  | "keyStakeholdersInternal"
  | "keyStakeholdersExternal"
  | "regulatory"
  | "startDate"
  | "endDate"
  | "salesforceUrl"
  | "sharepointUrl"
  | "confluenceUrl";

/** i18n message keys used for inline project-meta form errors. */
export type ProjectErrorKey =
  | "errorProjectNameRequired"
  | "errorProjectCodeRequired"
  | "errorProjectManagerRequired"
  | "errorCustomerRequired"
  | "errorProductsRequired"
  | "errorProfitCenterRequired"
  | "errorNaceRequired"
  | "errorDeploymentRequired"
  | "errorStakeholdersInternalRequired"
  | "errorStakeholdersExternalRequired"
  | "errorRegulatoryRequired"
  | "errorStartDateRequired"
  | "errorEndDateRequired"
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

  // Required non-empty (trimmed) string fields.
  if (!draft.name.trim()) errors.name = "errorProjectNameRequired";
  if (!draft.code.trim()) errors.code = "errorProjectCodeRequired";
  if (!draft.projectManager.trim()) errors.projectManager = "errorProjectManagerRequired";
  if (!draft.customer.trim()) errors.customer = "errorCustomerRequired";
  if (!draft.products.trim()) errors.products = "errorProductsRequired";
  if (!draft.profitCenter.trim()) errors.profitCenter = "errorProfitCenterRequired";
  if (!draft.naceSection.trim()) errors.naceSection = "errorNaceRequired";
  if (!draft.deployment.trim()) errors.deployment = "errorDeploymentRequired";

  // Required non-empty arrays.
  if (draft.keyStakeholdersInternal.length === 0)
    errors.keyStakeholdersInternal = "errorStakeholdersInternalRequired";
  if (draft.keyStakeholdersExternal.length === 0)
    errors.keyStakeholdersExternal = "errorStakeholdersExternalRequired";
  if (draft.regulatory.length === 0)
    errors.regulatory = "errorRegulatoryRequired";

  // Date validation.
  const startDate = sanitizeIsoDate(draft.startDate);
  const endDate = sanitizeIsoDate(draft.endDate);

  if (!startDate) {
    errors.startDate = "errorStartDateRequired";
  }
  if (!endDate) {
    errors.endDate = "errorEndDateRequired";
  } else if (startDate && endDate < startDate) {
    errors.endDate = "errorEndBeforeStart";
  }

  // URL validation — blank is allowed; non-blank must be a valid http(s) URL.
  if (draft.salesforceUrl && !isLikelyUrl(draft.salesforceUrl))
    errors.salesforceUrl = "errorInvalidUrl";
  if (draft.sharepointUrl && !isLikelyUrl(draft.sharepointUrl))
    errors.sharepointUrl = "errorInvalidUrl";
  if (draft.confluenceUrl && !isLikelyUrl(draft.confluenceUrl))
    errors.confluenceUrl = "errorInvalidUrl";

  return errors;
}

/** True when the draft has at least one validation error (gates submit). */
export function hasProjectErrors(errors: ProjectFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
