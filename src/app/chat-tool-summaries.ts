// PURE entity → tool-summary projections, extracted from chat-tools.ts.
//
// ★ Extracted for the file-size ratchet: chat-tools.ts sat at 797 of the 800
//   cap (the gate counts `wc -l` + 1, so that WAS the gate's number) and the
//   B2b slice needed to add a `getSnapshot()` field. These eight functions are
//   the most cohesive unit in the file — no dispatcher access, no i18n, no
//   state, one input each.
//
// ★ They stay re-exported from chat-tools.ts so no existing import breaks.
//
// ★ The `import type` from ./chat-tools is TYPE-ONLY and must stay that way —
//   chat-tools.ts imports nothing from here at runtime today, but a type-only
//   edge is erased by the compiler, so this direction can never create a cycle.
import type {
  RaidItem,
  ChangeItem,
  Milestone,
  Stakeholder,
  Resource,
  BudgetBucket,
} from "./types";
import { type KnowledgeItem, linkKindOf } from "./document-link";
import { type CalendarEvent } from "./calendar-event";
import type {
  RaidSummary,
  ChangeSummary,
  MilestoneSummary,
  StakeholderSummary,
  ResourceSummary,
  KnowledgeSummary,
  CalendarEventSummary,
  BudgetBucketSummary,
} from "./chat-tools";

export function toRaidSummary(item: RaidItem): RaidSummary {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    status: item.status,
    severity: item.severity,
    owner: item.owner,
    stakeholderIds: item.stakeholderIds ?? [],
  };
}

export function toChangeSummary(item: ChangeItem): ChangeSummary {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    impact: item.impact,
    decisionDate: item.decisionDate,
    stakeholderIds: item.stakeholderIds ?? [],
  };
}

export function toMilestoneSummary(item: Milestone): MilestoneSummary {
  return {
    id: item.id,
    name: item.name,
    date: item.date,
    achievedDate: item.achievedDate,
  };
}

export function toStakeholderSummary(item: Stakeholder): StakeholderSummary {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    influence: item.influence,
    interest: item.interest,
    organization: item.organization,
    email: item.email,
  };
}

export function toResourceSummary(item: Resource): ResourceSummary {
  return {
    id: item.id,
    firstName: item.firstName,
    lastName: item.lastName,
    email: item.email,
    emails: item.emails,
    title: item.title,
    department: item.department,
    isExternal: item.isExternal,
    roleId: item.roleId,
  };
}

export function toKnowledgeSummary(item: KnowledgeItem): KnowledgeSummary {
  return {
    id: item.id,
    name: item.name,
    url: item.url,
    linkKind: linkKindOf(item),
    taskIds: item.taskIds ?? [],
  };
}

export function toCalendarEventSummary(event: CalendarEvent): CalendarEventSummary {
  return {
    id: event.id,
    title: event.title,
    startDate: event.startDate,
    startTime: event.startTime,
    durationMinutes: event.durationMinutes,
    location: event.location,
    notes: event.notes,
    attendeeResourceIds: event.attendeeResourceIds ?? [],
    recurrence: event.recurrence,
    exceptions: event.exceptions ?? [],
  };
}

export function toBudgetBucketSummary(bucket: BudgetBucket): BudgetBucketSummary {
  return {
    id: bucket.id,
    name: bucket.name,
    status: bucket.status,
    startDate: bucket.startDate,
    endDate: bucket.endDate,
    allocations: bucket.allocations.map((a) => ({
      roleId: a.roleId,
      budgetHours: a.budgetHours,
    })),
  };
}
