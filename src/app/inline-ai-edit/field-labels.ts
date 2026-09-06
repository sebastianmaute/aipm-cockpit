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

/** Field names that are translatable WITHOUT an entity to qualify them.
 *
 *  ★★★ THIS IS A NARROW EXCEPTION TO THE ENTITY-QUALIFICATION RULE ABOVE, NOT
 *   A SECOND WAY TO LABEL A FIELD. A member belongs here only when the field
 *   reaches a preview surface on a row the descriptor engine has NO entity for,
 *   so `FIELD_LABEL_KEY` can never be consulted for it — today that is
 *   `set_task_dependencies`, whose describer is hand-written precisely because
 *   the tool has no create/update/delete triple (§406). Anything an entity CAN
 *   qualify must stay in `FIELD_LABEL_KEY`, or the qualification the ★★ above
 *   argues for is quietly bypassed.
 *
 *  ★ It changes nothing about the fallback: a field absent from BOTH maps still
 *   renders as its raw property name. */
const ENTITYLESS_FIELD_LABEL_KEY: Readonly<Record<string, TranslationKey>> = {
  dependencies: "dependencies",
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
  if (entity === undefined) {
    const entityless = ENTITYLESS_FIELD_LABEL_KEY[field];
    return entityless === undefined ? field : t(lang, entityless) || field;
  }
  return keyedFieldLabel(lang, entity, field);
}

function keyedFieldLabel(lang: Lang, entity: InlineEntity, field: string): string {
  const key = FIELD_LABEL_KEY[`${entity}.${field}`];
  if (key === undefined) return field;
  return t(lang, key) || field;
}

/** One link diff's rendered label, for all three preview surfaces.
 *
 *  ★★ THE COMPOSITION LIVES HERE RATHER THAN AT THE THREE CALL SITES so the
 *   translated half cannot drift from the subject half, and so a `subject` that
 *   a future producer sets cannot be silently dropped by whichever surface
 *   forgot to compose it — the seam a per-site ternary leaves open.
 *
 *  ★ The separator is an EN DASH (U+2013), the repo's row-label idiom
 *   (`rowLabel` in `row-tokens.ts`). Subject FIRST: it names the row, and the
 *   field label is what varies down the list beneath it.
 *
 *  ★★ A diff with no `subject` renders EXACTLY `fieldLabel`, byte for byte —
 *   which is every `target: "row"` diff the descriptor engine produces, and it
 *   is the surrounding card's OWN row title that qualifies those.
 *   ★★ TWO producers set one, both for a row the surface does not name, and the
 *   list used to say ONE: the hand-written `set_task_dependencies` describer in
 *   `chat-proposal-describe.ts` (§406), whose tool's row title cannot carry its
 *   own task's name, and `pushLinkDiffs` in `plan.ts` on a `target: "create"`
 *   diff (§407), whose row does not exist yet. */
export function linkLabel(
  lang: Lang,
  entity: InlineEntity | undefined,
  link: { field: string; subject?: string },
): string {
  const label = fieldLabel(lang, entity, link.field);
  return link.subject === undefined ? label : `${link.subject} – ${label}`;
}
