// src/app/project-field-labels.ts
//
// The project form's label for every project field (§715). PURE: only i18n keys and types.
//
// ★★ Its own module, not inline-ai-edit/field-labels.ts, because activity-message.ts reads
//  PROJECT_META_LABEL_KEY and sits in the sample generator's DOM-free import graph: through
//  field-labels it reached inline-ai-edit/plan.ts and so rich-text-projection, which the
//  DOM-free guard in rich-text-plain.test.ts refuses.
import type { TranslationKey } from "./i18n";
import type { ProjectAiField } from "./project-ai-fields";
import type { ProjectMeta } from "./types";

/** Project field → the label the project form shows for it (§715). A `Record` over `ProjectAiField`, so a
 *  field added to `PROJECT_AI_FIELDS` is a compile error here until the card can name it. */
export const PROJECT_FIELD_LABEL_KEY: Readonly<Record<ProjectAiField, TranslationKey>> = {
  name: "projectName",
  code: "projectCode",
  description: "projectDescription",
  sponsor: "projectSponsor",
  projectManager: "projectManager",
  customer: "projectCustomer",
  products: "projectProducts",
  platform: "projectPlatform",
  profitCenter: "projectProfitCenter",
  quotes: "projectQuotes",
  notes: "projectNotes",
  docRepoLocation: "projectDocRepo",
  startDate: "projectStartDate",
  endDate: "projectEndDate",
  regulatory: "projectRegulatory",
  identityTypes: "projectIdentityTypes",
  deployment: "projectDeployment",
  naceSection: "projectNaceSection",
  identityCount: "projectIdentityCount",
  stakeholderCount: "projectStakeholderCount",
  operatingTimezone: "projectOperatingTimezone",
  jiraUrl: "projectLinkJira",
  salesforceUrl: "projectLinkSalesforce",
  sharepointUrl: "projectLinkSharepoint",
  confluenceUrl: "projectLinkConfluence",
};

/** EVERY `ProjectMeta` key → the project form's label, for the activity line (§715): the form also saves the
 *  keys Claude never sets. A `Record` over `keyof ProjectMeta`, so a new project field is a compile error here
 *  until it is labelled. */
export const PROJECT_META_LABEL_KEY: Readonly<Record<keyof ProjectMeta, TranslationKey>> = {
  ...PROJECT_FIELD_LABEL_KEY,
  contactPersons: "projectContactPersons",
  keyStakeholdersInternal: "projectStakeholdersInternal",
  keyStakeholdersExternal: "projectStakeholdersExternal",
  knowledgeLinks: "projectDocumentLinks",
};
