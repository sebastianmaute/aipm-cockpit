// src/app/modal-fields.ts
import type { TranslationKey } from "./i18n";

export type FieldTier = "simple" | "advanced" | "full";

export interface ModalField {
  /** Stable id, unique within its modal. Used as the persisted key and the guard arg. */
  id: string;
  /** Existing i18n key for the field's label (reused for the cog checklist). */
  labelKey: TranslationKey;
  /** Lowest tier in which the field appears; it also shows in every higher tier. */
  tier: FieldTier;
  /** Required/validated fields are always shown and locked in the cog. */
  required?: boolean;
}

export type ModalId =
  | "task" | "raid" | "change" | "milestone"
  | "stakeholder" | "resource" | "absence" | "budget";

export const MODAL_IDS: readonly ModalId[] = [
  "task", "raid", "change", "milestone",
  "stakeholder", "resource", "absence", "budget",
] as const;

// Tiers nest: a "simple" field shows in S/A/F; "advanced" in A/F; "full" in F only.
export const MODAL_FIELDS: Record<ModalId, readonly ModalField[]> = {
  task: [
    { id: "taskName", labelKey: "taskName", tier: "simple", required: true },
    { id: "assignee", labelKey: "assignee", tier: "simple" },
    { id: "dueDate", labelKey: "dueDate", tier: "simple" },
    { id: "notes", labelKey: "notes", tier: "simple" },
    { id: "priority", labelKey: "priority", tier: "advanced" },
    { id: "startDate", labelKey: "startDate", tier: "advanced" },
    { id: "estimate", labelKey: "taskOriginalEstimate", tier: "advanced" },
    { id: "labels", labelKey: "labels", tier: "advanced" },
    { id: "dependencies", labelKey: "dependencies", tier: "advanced" },
    { id: "blockers", labelKey: "blockers", tier: "advanced" },
    { id: "health", labelKey: "health", tier: "advanced" },
    { id: "email", labelKey: "email", tier: "full" },
    { id: "timeSpent", labelKey: "taskTimeSpent", tier: "full" },
    { id: "lastUpdate", labelKey: "lastUpdate", tier: "full" },
    { id: "healthOverride", labelKey: "healthOverride", tier: "full" },
  ],
  raid: [
    { id: "title", labelKey: "title", tier: "simple", required: true },
    { id: "category", labelKey: "category", tier: "simple" },
    { id: "status", labelKey: "status", tier: "simple" },
    { id: "owner", labelKey: "owner", tier: "simple" },
    { id: "description", labelKey: "description", tier: "simple" },
    { id: "scoring", labelKey: "raidScoring", tier: "advanced" },
    { id: "mitigation", labelKey: "mitigation", tier: "advanced" },
    { id: "targetDate", labelKey: "targetDate", tier: "advanced" },
    { id: "linkedTasks", labelKey: "linkedTasks", tier: "advanced" },
    { id: "riskMatrix", labelKey: "riskMatrix", tier: "full" },
    { id: "raisedDate", labelKey: "raisedDate", tier: "full" },
    { id: "linkedRaid", labelKey: "linkedRaid", tier: "full" },
    { id: "linkedStakeholders", labelKey: "linkedStakeholders", tier: "full" },
  ],
  change: [
    { id: "title", labelKey: "title", tier: "simple", required: true },
    { id: "type", labelKey: "type", tier: "simple" },
    { id: "status", labelKey: "status", tier: "simple" },
    { id: "description", labelKey: "description", tier: "simple" },
    { id: "impact", labelKey: "impact", tier: "advanced" },
    { id: "requestor", labelKey: "requestor", tier: "advanced" },
    { id: "deltas", labelKey: "changeDeltas", tier: "advanced" },
    { id: "decisionDate", labelKey: "decisionDate", tier: "advanced" },
    { id: "links", labelKey: "linkedItems", tier: "full" },
  ],
  milestone: [
    { id: "name", labelKey: "name", tier: "simple", required: true },
    { id: "targetDate", labelKey: "targetDate", tier: "simple" },
    { id: "description", labelKey: "description", tier: "advanced" },
    { id: "achievedDate", labelKey: "achievedDate", tier: "advanced" },
    { id: "linkedTasks", labelKey: "linkedTasks", tier: "advanced" },
    { id: "documentLinks", labelKey: "documentLinks", tier: "full" },
  ],
  stakeholder: [
    { id: "name", labelKey: "name", tier: "simple", required: true },
    { id: "organization", labelKey: "organization", tier: "simple" },
    { id: "category", labelKey: "category", tier: "simple" },
    { id: "contact", labelKey: "titleEmail", tier: "advanced" },
    { id: "influenceInterest", labelKey: "influenceInterest", tier: "advanced" },
    { id: "notes", labelKey: "notes", tier: "full" },
    { id: "raci", labelKey: "raci", tier: "full" },
  ],
  resource: [
    { id: "name", labelKey: "resourceFirstName", tier: "simple", required: true },
    { id: "email", labelKey: "resourceEmail", tier: "simple" },
    { id: "jobTitle", labelKey: "resourceJobTitle", tier: "advanced" },
    { id: "company", labelKey: "resourceCompany", tier: "advanced" },
    { id: "department", labelKey: "resourceDepartment", tier: "advanced" },
    { id: "location", labelKey: "resourceLocation", tier: "full" },
    { id: "businessPhone", labelKey: "resourcePhone", tier: "full" },
    { id: "birthday", labelKey: "resourceBirthday", tier: "full" },
    { id: "notes", labelKey: "resourceNotes", tier: "full" },
  ],
  absence: [
    { id: "resource", labelKey: "resource", tier: "simple", required: true },
    { id: "dates", labelKey: "dateRange", tier: "simple" },
    { id: "reason", labelKey: "reason", tier: "advanced" },
    { id: "cover", labelKey: "cover", tier: "advanced" },
    { id: "coverEmail", labelKey: "coverEmail", tier: "full" },
    { id: "notes", labelKey: "notes", tier: "full" },
  ],
  budget: [
    { id: "name", labelKey: "name", tier: "simple", required: true },
    { id: "funding", labelKey: "funding", tier: "simple" },
    { id: "period", labelKey: "period", tier: "advanced" },
    { id: "burnRate", labelKey: "burnRate", tier: "advanced" },
    { id: "planningFlags", labelKey: "planningDetail", tier: "full" },
  ],
};
