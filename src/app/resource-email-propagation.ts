// Spec Part 7 — when a person's primary email is corrected in the resource
// record, carry the correction to the FK-linked records it was COPIED into.
// Pure and i18n-free; both writers call it (`handleSaveResource` in
// use-resource-directory.ts and AI `updateResource` in use-chat-dispatcher.ts),
// pinned equal by resource-email-propagation.parity.test.tsx.
//
// ★★ Rulings: FK-linked rows only (never an address match — a shared mailbox
//  or an address-book contact must not be rewritten); only rows whose cached
//  email still equals the OLD email (trimmed, case-folded — the convention of
//  `resource-foundation.ts` and `purgeCalendarFor`); Jira-synced tasks skipped;
//  escalations NEVER reached (they record who was actually mailed).
// ★ A stakeholder's email is capped at BUDGET_NAME_MAX (200), below the
//  resource's EMAIL_MAX (320). A longer corrected value is NOT written into a
//  stakeholder row — the load path would cut it into a torn address — so that
//  row keeps its stale copy and is not counted.
import type { Absence, ContactPerson, RaidItem, Resource, Shift, Stakeholder, Task } from "./types";
import { BUDGET_NAME_MAX } from "./sanitize-entities";

export interface ResourceEmailChange { resourceId: number; from: string; to: string }
export interface ArrayPropagation<T> { next: readonly T[]; edited: T[] }

export interface EmailPropagationInput {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  stakeholders: readonly Stakeholder[];
  contactPersons: readonly ContactPerson[];
}

export interface EmailPropagationResult {
  tasks: ArrayPropagation<Task>;
  raid: ArrayPropagation<RaidItem>;
  absences: ArrayPropagation<Absence>;
  shifts: ArrayPropagation<Shift>;
  stakeholders: ArrayPropagation<Stakeholder>;
  contactPersons: { next: readonly ContactPerson[]; changed: number };
  count: number;
}

const fold = (s: string | undefined): string => (s ?? "").trim().toLowerCase();

/** The primary-email change a save makes, or null. ANY trimmed change counts
 *  (a case-only correction included); a blank old email propagates nothing,
 *  because a blank cache must never be filled by this. */
export function resourceEmailChange(before: Resource, after: Resource): ResourceEmailChange | null {
  const from = (before.email ?? "").trim();
  const to = (after.email ?? "").trim();
  if (from === "" || from === to) return null;
  return { resourceId: after.id, from, to };
}

function retarget<T>(
  rows: readonly T[],
  change: ResourceEmailChange,
  linked: (row: T) => boolean,
  email: (row: T) => string | undefined,
  withEmail: (row: T, value: string) => T,
): ArrayPropagation<T> {
  const edited: T[] = [];
  const next = rows.map((row) => {
    if (!linked(row) || fold(email(row)) !== fold(change.from)) return row;
    edited.push(row);
    return withEmail(row, change.to);
  });
  return edited.length === 0 ? { next: rows, edited } : { next, edited };
}

export function retargetTaskEmails(rows: readonly Task[], change: ResourceEmailChange): ArrayPropagation<Task> {
  return retarget(rows, change, (r) => r.resourceId === change.resourceId && !r.jiraKey, (r) => r.assigneeEmail, (r, v) => ({ ...r, assigneeEmail: v }));
}

export function retargetRaidEmails(rows: readonly RaidItem[], change: ResourceEmailChange): ArrayPropagation<RaidItem> {
  return retarget(rows, change, (r) => r.ownerResourceId === change.resourceId, (r) => r.ownerEmail, (r, v) => ({ ...r, ownerEmail: v }));
}

export function retargetAbsenceEmails(rows: readonly Absence[], change: ResourceEmailChange): ArrayPropagation<Absence> {
  return retarget(rows, change, (r) => r.resourceId === change.resourceId, (r) => r.assigneeEmail, (r, v) => ({ ...r, assigneeEmail: v }));
}

export function retargetShiftEmails(rows: readonly Shift[], change: ResourceEmailChange): ArrayPropagation<Shift> {
  return retarget(rows, change, (r) => r.resourceId === change.resourceId, (r) => r.assigneeEmail, (r, v) => ({ ...r, assigneeEmail: v }));
}

export function retargetStakeholderEmails(rows: readonly Stakeholder[], change: ResourceEmailChange): ArrayPropagation<Stakeholder> {
  const fits = change.to.length <= BUDGET_NAME_MAX;
  return retarget(rows, change, (r) => fits && r.resourceId === change.resourceId, (r) => r.email, (r, v) => ({ ...r, email: v }));
}

export function retargetContactPersonEmails(rows: readonly ContactPerson[], change: ResourceEmailChange): { next: readonly ContactPerson[]; changed: number } {
  const out = retarget(rows, change, (r) => r.resourceId === change.resourceId, (r) => r.email, (r, v) => ({ ...r, email: v }));
  return { next: out.next, changed: out.edited.length };
}

export function propagateResourceEmail(change: ResourceEmailChange, input: EmailPropagationInput): EmailPropagationResult {
  const tasks = retargetTaskEmails(input.tasks, change);
  const raid = retargetRaidEmails(input.raid, change);
  const absences = retargetAbsenceEmails(input.absences, change);
  const shifts = retargetShiftEmails(input.shifts, change);
  const stakeholders = retargetStakeholderEmails(input.stakeholders, change);
  const contactPersons = retargetContactPersonEmails(input.contactPersons, change);
  const count = tasks.edited.length + raid.edited.length + absences.edited.length
    + shifts.edited.length + stakeholders.edited.length + contactPersons.changed;
  return { tasks, raid, absences, shifts, stakeholders, contactPersons, count };
}
