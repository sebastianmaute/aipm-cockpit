// src/app/markdown-columns.ts
//
// Markdown table column registries — one const per entity, each an ordered
// list of {key/col, label} pairs describing a table's header row (label) and
// the order + accessor (key/col) for each column's value.
//
// A dedicated leaf, owned by neither sibling: markdown-codecs-core.ts (the
// per-entity table ENCODERS) imports every registry here; markdown-codecs-
// decode.ts derives its EVENTS_MD_COLUMNS alias map from the same source
// (see markdownToCalendarEvents there) — importing column metadata out of
// the encoder's own file gave the decoder's alias derivation a less honest
// home than this leaf. Mirrors the gantt-engine.ts / resource-calendar-
// shared.ts precedent: shared vocabulary lives in its own leaf, not in
// whichever sibling happened to need it first.

import type {
  Absence,
  ChangeItem,
  Milestone,
  RaidItem,
  Stakeholder,
  Task,
} from "./types";
import type { CalendarEvent } from "./calendar-event";
import type { DocumentAsset } from "./document-asset";

export const MD_COLUMNS: Array<{ key: keyof Task; label: string }> = [
  { key: "id", label: "ID" },
  { key: "taskName", label: "Task" },
  { key: "assignee", label: "Assignee" },
  { key: "assigneeEmail", label: "Email" },
  { key: "startDate", label: "Start" },
  { key: "dueDate", label: "Due" },
  { key: "lastUpdateDate", label: "Last update" },
  { key: "createdDate", label: "Created" },
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
  { key: "blockers", label: "Blockers" },
  { key: "description", label: "Description" },
  { key: "completedDate", label: "Completed" },
  { key: "inquiriesSent", label: "Inquiries" },
  { key: "group", label: "Group" },
  { key: "labels", label: "Labels" },
  { key: "dependencies", label: "Dependencies" },
  { key: "jiraKey", label: "Jira" },
  { key: "jiraIssueType", label: "JiraType" },
  { key: "lastSyncedAt", label: "LastSynced" },
  { key: "localModifiedAt", label: "LocalModified" },
  { key: "healthOverride", label: "Health" },
  { key: "resourceId", label: "ResourceId" },
  { key: "originalEstimateMinutes", label: "OrigEstimateMin" },
  { key: "timeSpentMinutes", label: "TimeSpentMin" },
  { key: "knowledgeLinks", label: "KnowledgeLinks" },
  { key: "outlookEventId", label: "OutlookEventId" },
  { key: "noteLog", label: "NoteLog" },
];

export const RAID_MD_COLUMNS: Array<{ key: keyof RaidItem; label: string }> = [
  { key: "id", label: "ID" },
  { key: "category", label: "Category" },
  { key: "title", label: "Title" },
  { key: "description", label: "Description" },
  { key: "severity", label: "Severity" },
  { key: "probability", label: "Probability" },
  { key: "impact", label: "Impact" },
  { key: "status", label: "Status" },
  { key: "owner", label: "Owner" },
  { key: "ownerEmail", label: "OwnerEmail" },
  { key: "ownerResourceId", label: "OwnerResourceId" },
  { key: "mitigation", label: "Mitigation" },
  { key: "linkedTaskIds", label: "LinkedTasks" },
  { key: "raisedDate", label: "Raised" },
  { key: "targetDate", label: "Target" },
  { key: "closedDate", label: "Closed" },
  { key: "localModifiedAt", label: "LocalModified" },
  { key: "causedByRaidIds", label: "CausedByIds" },
  { key: "stakeholderIds", label: "StakeholderIds" },
  { key: "knowledgeLinks", label: "KnowledgeLinks" },
  { key: "outlookEventId", label: "OutlookEventId" },
  { key: "inquiriesSent", label: "Inquiries" },
  { key: "noteLog", label: "NoteLog" },
];

export const ABSENCES_MD_COLUMNS: Array<{ key: keyof Absence; label: string }> = [
  { key: "id", label: "ID" },
  { key: "assignee", label: "Assignee" },
  { key: "assigneeEmail", label: "Email" },
  { key: "startDate", label: "Start" },
  { key: "endDate", label: "End" },
  { key: "type", label: "Type" },
  { key: "note", label: "Note" },
  { key: "localModifiedAt", label: "LocalModified" },
  { key: "resourceId", label: "ResourceId" },
  { key: "outlookEventId", label: "OutlookEventId" },
];

// Same 13 fields as EVENTS_CSV_COLUMNS (csv-codecs-core.ts), same order.
// markdown-codecs-decode.ts derives its alias map from this list rather than
// hand-writing one (see markdownToCalendarEvents there).
export const EVENTS_MD_COLUMNS: Array<{ key: keyof CalendarEvent; label: string }> = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "startDate", label: "Start" },
  { key: "startTime", label: "StartTime" },
  { key: "durationMinutes", label: "DurationMin" },
  { key: "location", label: "Location" },
  { key: "notes", label: "Notes" },
  { key: "recurrence", label: "Recurrence" },
  { key: "exceptions", label: "Exceptions" },
  { key: "attendeeResourceIds", label: "Attendees" },
  { key: "sendInvitations", label: "SendInvitations" },
  { key: "localModifiedAt", label: "LocalModified" },
  { key: "outlookEventId", label: "OutlookEventId" },
];

// Same 8 fields as DOCUMENT_ASSETS_CSV_COLUMNS (csv-codecs-core.ts), same
// order — markdown-codecs-decode.ts derives its alias map from this list
// rather than hand-writing one (see the EVENTS_MD_ALIASES precedent there).
export const DOCUMENT_ASSETS_MD_COLUMNS: Array<{ key: keyof DocumentAsset; label: string }> = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "mime", label: "Type" },
  { key: "size", label: "Size" },
  { key: "width", label: "Width" },
  { key: "height", label: "Height" },
  { key: "hash", label: "Hash" },
  { key: "createdAt", label: "Created" },
];

export const SHIFTS_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "assignee", label: "Assignee" },
  { col: "assigneeEmail", label: "Email" },
  { col: "resourceId", label: "ResourceId" },
  { col: "sunHours", label: "Sun" },
  { col: "monHours", label: "Mon" },
  { col: "tueHours", label: "Tue" },
  { col: "wedHours", label: "Wed" },
  { col: "thuHours", label: "Thu" },
  { col: "friHours", label: "Fri" },
  { col: "satHours", label: "Sat" },
  { col: "note", label: "Note" },
  { col: "localModifiedAt", label: "LocalModified" },
];

export const RESOURCES_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "firstName", label: "First" },
  { col: "lastName", label: "Last" },
  { col: "title", label: "Title" },
  { col: "businessPhone", label: "Phone" },
  { col: "location", label: "Location" },
  { col: "department", label: "Department" },
  { col: "email", label: "Email" },
  { col: "company", label: "Company" },
  { col: "birthday", label: "Birthday" },
  { col: "notes", label: "Notes" },
  { col: "roleId", label: "RoleId" },
  { col: "utilizationMode", label: "Mode" },
  { col: "utilization", label: "Utilization" },
  { col: "absenceOverride", label: "AbsenceOverride" },
  { col: "active", label: "Active" },
  { col: "localModifiedAt", label: "LocalModified" },
  { col: "emails", label: "Emails" },
  { col: "isExternal", label: "External" },
];

export const ROLES_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "disciplineId", label: "DisciplineId" },
  { col: "gradeId", label: "GradeId" },
  { col: "internalRate", label: "InternalRate" },
  { col: "externalRate", label: "ExternalRate" },
  { col: "internalRateDay", label: "InternalRateDay" },
  { col: "externalRateDay", label: "ExternalRateDay" },
  { col: "rateBasis", label: "RateBasis" },
  { col: "localModifiedAt", label: "LocalModified" },
  { col: "order", label: "Order" },
];

export const BUDGETS_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "name", label: "Name" },
  { col: "poNumber", label: "PO" },
  { col: "type", label: "Type" },
  { col: "currency", label: "Currency" },
  { col: "fixedPriceAmount", label: "FixedPrice" },
  { col: "startDate", label: "Start" },
  { col: "endDate", label: "End" },
  { col: "successorId", label: "SuccessorId" },
  { col: "status", label: "Status" },
  { col: "closedDate", label: "Closed" },
  { col: "fxRateOverride", label: "FxOverride" },
  { col: "allocations", label: "Allocations" },
  { col: "localModifiedAt", label: "LocalModified" },
  { col: "order", label: "Order" },
  { col: "planningMode", label: "PlanningMode" },
  { col: "disciplineAllocations", label: "DisciplineAllocations" },
  { col: "rateOverrideInternal", label: "RateOverrideInternal" },
  { col: "rateOverrideExternal", label: "RateOverrideExternal" },
  { col: "taskIds", label: "TaskIds" },
  { col: "percentComplete", label: "PercentComplete" },
];

export const REF_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "name", label: "Name" },
  { col: "localModifiedAt", label: "LocalModified" },
];

export const MILESTONES_MD_COLUMNS: Array<{ key: keyof Milestone; label: string }> = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "achievedDate", label: "Achieved" },
  { key: "linkedTaskIds", label: "LinkedTasks" },
  { key: "localModifiedAt", label: "LocalModified" },
  { key: "knowledgeLinks", label: "KnowledgeLinks" },
  { key: "outlookEventId", label: "OutlookEventId" },
];

export const CHANGES_MD_COLUMNS: readonly { key: keyof ChangeItem; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "description", label: "Description" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "impact", label: "Impact" },
  { key: "impactDescription", label: "ImpactDescription" },
  { key: "scheduleImpactDays", label: "ScheduleImpactDays" },
  { key: "costImpact", label: "CostImpact" },
  { key: "requestedBy", label: "RequestedBy" },
  { key: "raisedDate", label: "RaisedDate" },
  { key: "decisionBy", label: "DecisionBy" },
  { key: "decisionDate", label: "DecisionDate" },
  { key: "resolutionNotes", label: "ResolutionNotes" },
  { key: "linkedTaskIds", label: "LinkedTasks" },
  { key: "linkedRaidIds", label: "LinkedRaid" },
  { key: "stakeholderIds", label: "StakeholderIds" },
  { key: "localModifiedAt", label: "LocalModified" },
  { key: "knowledgeLinks", label: "KnowledgeLinks" },
  { key: "outlookEventId", label: "OutlookEventId" },
  { key: "noteLog", label: "NoteLog" },
];

export const STAKEHOLDERS_MD_COLUMNS: readonly { key: keyof Stakeholder; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "organization", label: "Organization" },
  { key: "title", label: "Title" },
  { key: "email", label: "Email" },
  { key: "category", label: "Category" },
  { key: "influence", label: "Influence" },
  { key: "interest", label: "Interest" },
  { key: "notes", label: "Notes" },
  { key: "resourceId", label: "ResourceId" },
  { key: "raci", label: "RACI" },
  { key: "localModifiedAt", label: "LocalModified" },
  { key: "knowledgeLinks", label: "KnowledgeLinks" },
];
