// src/app/export-column-labels.ts — §304: the header label every export table
// prints, per section and field, plus the section titles.
//
// ★★★ HEADERS ARE LABELS; FIELDS STAY KEYS. `ExportSection.columns` is the
//  header row PDF, Word, PowerPoint and Excel print, and it was the raw storage
//  key (`dueDate`, `noteLog`) in every language. The builders still map each
//  row by the storage FIELD; only the header text comes from here. CSV and
//  Markdown never read `columns` — they are storage formats and keep raw keys.
// ★★ Reuse the app's TABLE-header key where the field has a column, then its
//  edit-form key, and an `exportCol*` key only where the app labels the field
//  nowhere. TWO deliberate exceptions, both where the app's label names a
//  different VALUE than the cell holds: the three task effort columns carry raw
//  MINUTES while the table shows formatted hours under "Est."/"Spent", so they
//  get "(min)" keys; and a foreign-key column (`roleId`, `disciplineId`,
//  `gradeId`, a stakeholder's `resourceId`, `successorId`) holds an ID where
//  the app shows the linked record's NAME, so it gets an "… ID" key, like
//  `exportColResourceId`.
// ★ Each map is a total Record over its `as const` column constant, so a new
//  CSV column fails `tsc` here until it has a label. SHIFTS_CSV_COLUMNS is typed
//  `readonly string[]`, so its totality — and the four hand-written field lists
//  below — are pinned by export-column-labels.test.ts instead.

import type { ExportSectionKey } from "./settings-types";
import { t, type Lang, type TranslationKey } from "./i18n";
import type {
  CSV_COLUMNS, RAID_CSV_COLUMNS, MILESTONES_CSV_COLUMNS, CHANGES_CSV_COLUMNS,
  STAKEHOLDERS_CSV_COLUMNS, BUDGETS_CSV_COLUMNS, RESOURCES_CSV_COLUMNS,
  ROLES_CSV_COLUMNS, ABSENCES_CSV_COLUMNS,
} from "./storage";

type LabelsFor<T extends readonly string[]> = Readonly<Record<T[number], TranslationKey>>;

/** The key/value sections (project, status) print a two-column table. */
export const KV_EXPORT_FIELDS = ["field", "value"] as const;
export const KNOWLEDGE_EXPORT_FIELDS = ["name", "type", "url", "tasks"] as const;
export const INSIGHT_EXPORT_FIELDS = ["type", "severity", "status", "data", "occurrences", "lastSeen"] as const;
/** ★ "first occurrence" is a computed column, not a CalendarEvent field. */
export const CALENDAR_EVENT_EXPORT_FIELDS = ["title", "first occurrence", "recurs", "location"] as const;

const TASK_LABELS: Readonly<Record<Exclude<(typeof CSV_COLUMNS)[number], "blockerLog">, TranslationKey>> = {
  id: "id", taskName: "task", assignee: "assignee", assigneeEmail: "fieldAssigneeEmail",
  startDate: "start", dueDate: "due", lastUpdateDate: "lastUpdate", createdDate: "colCreatedDate",
  priority: "priority", status: "colTaskStatus", blockers: "blockers", description: "description",
  completedDate: "completedDate", inquiriesSent: "reportsInquiriesCol", group: "group", labels: "labels",
  dependencies: "dependencies", jiraKey: "exportColJiraKey", jiraIssueType: "exportColJiraIssueType",
  lastSyncedAt: "exportColLastSyncedAt", localModifiedAt: "exportColLocalModifiedAt",
  healthOverride: "healthOverride", resourceId: "exportColResourceId",
  originalEstimateMinutes: "exportColOriginalEstimateMinutes", timeSpentMinutes: "exportColTimeSpentMinutes",
  remainingEstimateMinutes: "exportColRemainingEstimateMinutes", knowledgeLinks: "documentLinks",
  outlookEventId: "exportColOutlookEventId", calendarOptOut: "exportColCalendarOptOut", noteLog: "noteLogTitle",
};

const RAID_LABELS: Readonly<Record<Exclude<(typeof RAID_CSV_COLUMNS)[number], "escalations">, TranslationKey>> = {
  id: "id", category: "raidCategory", title: "raidTitle", description: "raidDescription",
  severity: "raidSeverity", probability: "raidProbability", impact: "raidImpact", status: "raidStatus",
  owner: "raidOwner", ownerEmail: "fieldOwnerEmail", ownerResourceId: "exportColResourceId",
  mitigation: "mitigation", linkedTaskIds: "raidLinkedTasks", raisedDate: "raidRaisedDate",
  targetDate: "raidTargetDate", closedDate: "fieldClosedDate", localModifiedAt: "exportColLocalModifiedAt",
  causedByRaidIds: "raidCausedBy", stakeholderIds: "linkedStakeholders", knowledgeLinks: "documentLinks",
  outlookEventId: "exportColOutlookEventId", calendarOptOut: "exportColCalendarOptOut",
  inquiriesSent: "reportsInquiriesCol", noteLog: "noteLogTitle",
};

const MILESTONE_LABELS: LabelsFor<typeof MILESTONES_CSV_COLUMNS> = {
  id: "id", name: "milestonesColName", date: "milestonesColDate", description: "milestoneDescription",
  achievedDate: "milestonesColAchieved", linkedTaskIds: "milestoneLinkedTasks",
  localModifiedAt: "exportColLocalModifiedAt", knowledgeLinks: "documentLinks",
  outlookEventId: "exportColOutlookEventId", calendarOptOut: "exportColCalendarOptOut",
};

const CHANGE_LABELS: LabelsFor<typeof CHANGES_CSV_COLUMNS> = {
  id: "id", title: "changeFieldTitle", description: "changeFieldDescription", type: "changeFieldType",
  status: "changeFieldStatus", impact: "changeFieldImpact", impactDescription: "changeFieldImpactDescription",
  scheduleImpactDays: "changeFieldScheduleImpact", costImpact: "changeFieldCostImpact",
  requestedBy: "changeFieldRequestedBy", raisedDate: "changeFieldRaisedDate", decisionBy: "changeFieldDecisionBy",
  decisionDate: "changeFieldDecisionDate", resolutionNotes: "changeFieldResolution",
  linkedTaskIds: "changeFieldLinkedTasks", linkedRaidIds: "changeFieldLinkedRaid",
  stakeholderIds: "linkedStakeholders", localModifiedAt: "exportColLocalModifiedAt",
  knowledgeLinks: "documentLinks", outlookEventId: "exportColOutlookEventId",
  calendarOptOut: "exportColCalendarOptOut", noteLog: "noteLogTitle",
};

const STAKEHOLDER_LABELS: LabelsFor<typeof STAKEHOLDERS_CSV_COLUMNS> = {
  id: "id", name: "stakeholderFieldName", organization: "stakeholderFieldOrganization",
  title: "stakeholderFieldTitle", email: "stakeholderFieldEmail", category: "stakeholderFieldCategory",
  influence: "stakeholderFieldInfluence", interest: "stakeholderFieldInterest", notes: "stakeholderFieldNotes",
  resourceId: "exportColLinkedResourceId", raci: "raci", localModifiedAt: "exportColLocalModifiedAt",
  knowledgeLinks: "documentLinks",
};

const BUDGET_LABELS: LabelsFor<typeof BUDGETS_CSV_COLUMNS> = {
  id: "id", name: "name", poNumber: "budgetPoNumber", type: "budgetType", currency: "budgetCurrency",
  fixedPriceAmount: "budgetFixedPriceAmount", startDate: "budgetStartDate", endDate: "budgetEndDate",
  successorId: "exportColSuccessorBucketId", status: "status", closedDate: "fieldClosedDate", createdDate: "colCreatedDate",
  fxRateOverride: "budgetFxOverride", allocations: "budgetAllocations", localModifiedAt: "exportColLocalModifiedAt",
  order: "exportColOrder", planningMode: "exportColPlanningMode",
  disciplineAllocations: "exportColDisciplineAllocations", rateOverrideInternal: "budgetRateOverrideInternal",
  rateOverrideExternal: "budgetRateOverrideExternal", taskIds: "budgetLinkedTasks",
  percentComplete: "budgetPercentComplete",
};

const RESOURCE_LABELS: LabelsFor<typeof RESOURCES_CSV_COLUMNS> = {
  id: "id", firstName: "resourceFirstName", lastName: "resourceLastName", title: "resourceColTitle",
  businessPhone: "resourceColPhone", location: "resourceLocation", department: "resourceColDepartment",
  email: "email", company: "resourceCompany", birthday: "resourceColBirthday", notes: "resourceNotes",
  roleId: "exportColRoleId", utilizationMode: "exportColUtilizationMode", utilization: "utilization",
  absenceOverride: "exportColAbsenceOverride", active: "resourceActiveLabel",
  localModifiedAt: "exportColLocalModifiedAt", emails: "resourceEmailsLabel", isExternal: "resourceExternal",
};

const ROLE_LABELS: LabelsFor<typeof ROLES_CSV_COLUMNS> = {
  id: "id", disciplineId: "exportColDisciplineId", gradeId: "exportColGradeId", internalRate: "rolesInternalRate",
  externalRate: "rolesExternalRate", internalRateDay: "rolesInternalRateDay",
  externalRateDay: "rolesExternalRateDay", rateBasis: "rolesRateBasis",
  localModifiedAt: "exportColLocalModifiedAt", order: "exportColOrder",
};

const ABSENCE_LABELS: LabelsFor<typeof ABSENCES_CSV_COLUMNS> = {
  id: "id", assignee: "absenceAssignee", assigneeEmail: "absenceAssigneeEmail", startDate: "absenceStart",
  endDate: "absenceEnd", type: "absenceType", note: "absenceNote", localModifiedAt: "exportColLocalModifiedAt",
  resourceId: "exportColResourceId", outlookEventId: "exportColOutlookEventId",
  calendarOptOut: "exportColCalendarOptOut",
};

/** ★ `SHIFTS_CSV_COLUMNS` is `readonly string[]`, so tsc cannot check this one
 *  is total — the label test does. */
const SHIFT_LABELS: Readonly<Record<string, TranslationKey>> = {
  id: "id", assignee: "shiftAssignee", assigneeEmail: "shiftAssigneeEmail", resourceId: "exportColResourceId",
  sunHours: "shiftDaySun", monHours: "shiftDayMon", tueHours: "shiftDayTue", wedHours: "shiftDayWed",
  thuHours: "shiftDayThu", friHours: "shiftDayFri", satHours: "shiftDaySat", note: "shiftNote",
  localModifiedAt: "exportColLocalModifiedAt",
};

const KV_LABELS: LabelsFor<typeof KV_EXPORT_FIELDS> = { field: "exportColField", value: "exportColValue" };

export const EXPORT_COLUMN_LABEL_KEYS: Readonly<Record<ExportSectionKey, Readonly<Record<string, TranslationKey>>>> = {
  project: KV_LABELS,
  status: KV_LABELS,
  tasks: TASK_LABELS,
  raid: RAID_LABELS,
  milestones: MILESTONE_LABELS,
  changes: CHANGE_LABELS,
  stakeholders: STAKEHOLDER_LABELS,
  budgets: BUDGET_LABELS,
  resources: RESOURCE_LABELS,
  roles: ROLE_LABELS,
  absences: ABSENCE_LABELS,
  shifts: SHIFT_LABELS,
  knowledgeItems: {
    name: "documentsManualName", type: "documentsManualKind", url: "exportColUrl", tasks: "knowledgeLinkedTasks",
  } satisfies LabelsFor<typeof KNOWLEDGE_EXPORT_FIELDS>,
  insights: {
    type: "type", severity: "exportColSeverity", status: "status", data: "exportColDetails",
    occurrences: "exportColOccurrences", lastSeen: "exportColLastSeen",
  } satisfies LabelsFor<typeof INSIGHT_EXPORT_FIELDS>,
  calendarEvents: {
    title: "title", "first occurrence": "calendarEventFirstOccurrence", recurs: "calendarEventRepeat",
    location: "calendarEventLocation",
  } satisfies LabelsFor<typeof CALENDAR_EVENT_EXPORT_FIELDS>,
};

/** §304 — every section heading. Six were English literals ("Budgets",
 *  "Roles", "Absences", "Shifts", "Project Status", "Insights"); they reuse the
 *  Settings → Export labels. */
export const EXPORT_SECTION_TITLE_KEYS: Readonly<Record<ExportSectionKey, TranslationKey>> = {
  project: "exportLabelProject", tasks: "tasks", raid: "tabRaid", changes: "navChanges",
  milestones: "navMilestones", stakeholders: "navStakeholders", budgets: "exportLabelBudgets",
  resources: "tabResources", roles: "exportLabelRoles", absences: "exportLabelAbsences",
  shifts: "exportLabelShifts", calendarEvents: "exportLabelCalendarEvents", status: "exportLabelStatus",
  knowledgeItems: "exportLabelKnowledgeItems", insights: "exportLabelInsights",
};

/** §304 — the status section's FIRST COLUMN names a ProjectStatus field, one
 *  per row; the dashboard's own override labels name them. */
export const STATUS_ROW_LABEL_KEYS: Readonly<Record<string, TranslationKey>> = {
  ragOverride: "dashboardOverall", scheduleOverride: "dashboardSubSchedule",
  budgetOverride: "dashboardSubBudget", scopeOverride: "dashboardSubScope",
  narrative: "exportColNarrative", narrativeUpdatedAt: "exportColNarrativeUpdatedAt",
};

/** The header label for one field of one section. An unmapped field falls back
 *  to its raw key — the label test fails on every such fallback, so this is a
 *  visible gap, never a silent one. */
export function exportColumnLabel(section: ExportSectionKey, field: string, lang: Lang): string {
  const key: TranslationKey | undefined = EXPORT_COLUMN_LABEL_KEYS[section][field];
  return key === undefined ? field : t(lang, key);
}

export function exportColumnLabels(section: ExportSectionKey, fields: readonly string[], lang: Lang): string[] {
  return fields.map((f) => exportColumnLabel(section, f, lang));
}
