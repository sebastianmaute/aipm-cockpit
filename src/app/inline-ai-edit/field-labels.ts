// src/app/inline-ai-edit/field-labels.ts
//
// Readable, translated names for the fields an AI edit preview renders.
//
// PURE. It imports `../i18n` — that is its whole job — plus the descriptor map
// it is enumerated against. No React, no DOM, no workspace.
//
// ★ WHY IT EXISTS: all three preview surfaces (the chat approval card, the
//  inline "Ask Claude" popover, the insight recommendation modal) rendered the
//  RAW PROPERTY NAME — `linkedTaskIds`, `assigneeEmail`, `scheduleImpactDays`.
//  On the two surfaces that WRITE what they show, a name the user cannot read
//  is a line they cannot check.
import { type Lang, type TranslationKey, t } from "../i18n";
import { type InlineEntity } from "./entity-descriptor";

/** `${entity}.${field}` → the i18n key naming that field to a user.
 *
 *  ★★ ENTITY-QUALIFIED because the same field name means different things:
 *   `title` is a job title on a resource and a person's role on a stakeholder;
 *   `impact` is a rating on both raid and change but each register labels it
 *   through its own form key. The same qualification rule `RICH_FIELDS` in
 *   `plan.ts` already follows, and for the same reason.
 *
 *  ★ Most entries REUSE a key the entity forms already ship in EN and DE —
 *   preferring the key that entity's OWN form shows, so a preview line reads
 *   the way the edit modal does. Only three names had no label anywhere
 *   (`fieldAssigneeEmail`, `fieldOwnerEmail`, `fieldClosedDate`); a label map
 *   is not a reason to duplicate strings that already exist.
 *
 *  ★★ COMPLETENESS IS NOT ENFORCED BY THE TYPE. `Record<string, …>` accepts a
 *   map with holes and `fieldLabel` falls back to the raw name, so a field
 *   added to a descriptor's `diffFields` goes on rendering as a property name
 *   with nothing red. `field-labels.test.ts` enumerates `INLINE_DESCRIPTORS`
 *   against this map — that test is the only detector. */
export const FIELD_LABEL_KEY: Record<string, TranslationKey> = {
  // task — the shared field labels the task form uses.
  "task.taskName": "taskName",
  "task.assignee": "assignee",
  "task.assigneeEmail": "fieldAssigneeEmail",
  "task.dueDate": "dueDate",
  "task.status": "status",
  "task.priority": "priority",
  "task.description": "description",
  "task.blockers": "blockers",
  "task.group": "group",
  "task.labels": "labels",
  "task.lastUpdateDate": "lastUpdateDate",

  // raid
  "raid.category": "category",
  "raid.title": "title",
  "raid.status": "status",
  "raid.description": "description",
  "raid.mitigation": "mitigation",
  "raid.owner": "owner",
  "raid.ownerEmail": "fieldOwnerEmail",
  "raid.severity": "raidSeverity",
  "raid.probability": "raidProbability",
  "raid.impact": "impact",
  "raid.raisedDate": "raisedDate",
  "raid.targetDate": "targetDate",
  "raid.closedDate": "fieldClosedDate",
  "raid.linkedTaskIds": "linkedTasks",
  "raid.causedByRaidIds": "raidCausedBy",
  "raid.stakeholderIds": "linkedStakeholders",

  // change — the change modal ships a dedicated label for every one of these.
  "change.title": "changeFieldTitle",
  "change.description": "changeFieldDescription",
  "change.type": "changeFieldType",
  "change.status": "changeFieldStatus",
  "change.impact": "changeFieldImpact",
  "change.impactDescription": "changeFieldImpactDescription",
  "change.scheduleImpactDays": "changeFieldScheduleImpact",
  "change.costImpact": "changeFieldCostImpact",
  "change.requestedBy": "changeFieldRequestedBy",
  "change.raisedDate": "changeFieldRaisedDate",
  "change.decisionBy": "changeFieldDecisionBy",
  "change.decisionDate": "changeFieldDecisionDate",
  "change.resolutionNotes": "changeFieldResolution",
  "change.linkedTaskIds": "changeFieldLinkedTasks",
  "change.linkedRaidIds": "changeFieldLinkedRaid",
  "change.stakeholderIds": "linkedStakeholders",

  // milestone
  "milestone.name": "milestoneName",
  "milestone.date": "milestoneDate",
  "milestone.description": "milestoneDescription",
  "milestone.achievedDate": "milestoneAchieved",
  "milestone.linkedTaskIds": "milestoneLinkedTasks",

  // stakeholder
  "stakeholder.name": "stakeholderFieldName",
  "stakeholder.organization": "stakeholderFieldOrganization",
  "stakeholder.title": "stakeholderFieldTitle",
  "stakeholder.email": "stakeholderFieldEmail",
  "stakeholder.category": "stakeholderFieldCategory",
  "stakeholder.influence": "stakeholderFieldInfluence",
  "stakeholder.interest": "stakeholderFieldInterest",
  "stakeholder.notes": "stakeholderFieldNotes",

  // resource — ★ `title` here is the JOB title, which is exactly why this map
  // is keyed by entity and not by field name.
  "resource.firstName": "resourceFirstName",
  "resource.lastName": "resourceLastName",
  "resource.title": "resourceJobTitle",
  "resource.email": "resourceEmail",
  "resource.department": "resourceDepartment",
  "resource.company": "resourceCompany",
  "resource.location": "resourceLocation",
  "resource.businessPhone": "resourcePhone",
  "resource.isExternal": "resourceExternal",
  "resource.notes": "resourceNotes",
  "resource.emails": "resourceEmailsLabel",
  "resource.roleId": "role",
};

/** The user-facing name of one previewed field.
 *
 *  ★★★ THE FALLBACK IS THE RAW FIELD NAME, NEVER "" AND NEVER THE i18n KEY.
 *   A blank label on an approval card is strictly worse than a property name:
 *   the line still shows a before → after, so the user is asked to approve a
 *   change to something unnamed. `entity` is optional because the chat card
 *   resolves it from the tool name, and a staged call with no
 *   `INLINE_DESCRIPTORS` entity (every `*_document` tool) has none. */
export function fieldLabel(lang: Lang, entity: InlineEntity | undefined, field: string): string {
  if (entity === undefined) return field;
  const key = FIELD_LABEL_KEY[`${entity}.${field}`];
  if (key === undefined) return field;
  return t(lang, key) || field;
}
