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

/** ★★ `stamp` (M3) is the resource save's own `localModifiedAt`. A retargeted row
 *  changed content, so it is stamped exactly as a direct edit of it would be —
 *  with that save's stamp, never a second clock read. Absent → rows unstamped.
 *  Undo needs nothing extra: `capturePart` restores each row's whole
 *  before-image, prior `localModifiedAt` included. */
export interface ResourceEmailChange { resourceId: number; from: string; to: string; stamp?: string }
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
  contactPersons: ContactPersonPropagation;
  count: number;
}

/** `edited` holds the before-images (the rows as they were), which the undo
 *  fragment needs because a contact person has no id to restore by. */
export interface ContactPersonPropagation { next: readonly ContactPerson[]; edited: ContactPerson[]; changed: number }

const fold = (s: string | undefined): string => (s ?? "").trim().toLowerCase();

/** The primary-email change a save makes, or null. ANY trimmed change counts
 *  (a case-only correction included); a blank old email propagates nothing,
 *  because a blank cache must never be filled by this, and a blank NEW email
 *  propagates nothing either — clearing a person's address is not a
 *  correction, and must never blank the copies linked rows hold. */
export function resourceEmailChange(before: Resource, after: Resource): ResourceEmailChange | null {
  const from = (before.email ?? "").trim();
  const to = (after.email ?? "").trim();
  if (from === "" || to === "" || from === to) return null;
  const stamp = after.localModifiedAt;
  return typeof stamp === "string" && stamp !== "" ? { resourceId: after.id, from, to, stamp } : { resourceId: after.id, from, to };
}

/** The row with the change's save stamp applied, as a direct edit stamps it. */
function stamped<T extends { localModifiedAt?: string }>(row: T, change: ResourceEmailChange): T {
  return change.stamp === undefined ? row : { ...row, localModifiedAt: change.stamp };
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
  return retarget(rows, change, (r) => r.resourceId === change.resourceId && !r.jiraKey, (r) => r.assigneeEmail, (r, v) => stamped({ ...r, assigneeEmail: v }, change));
}

export function retargetRaidEmails(rows: readonly RaidItem[], change: ResourceEmailChange): ArrayPropagation<RaidItem> {
  return retarget(rows, change, (r) => r.ownerResourceId === change.resourceId, (r) => r.ownerEmail, (r, v) => stamped({ ...r, ownerEmail: v }, change));
}

export function retargetAbsenceEmails(rows: readonly Absence[], change: ResourceEmailChange): ArrayPropagation<Absence> {
  return retarget(rows, change, (r) => r.resourceId === change.resourceId, (r) => r.assigneeEmail, (r, v) => stamped({ ...r, assigneeEmail: v }, change));
}

export function retargetShiftEmails(rows: readonly Shift[], change: ResourceEmailChange): ArrayPropagation<Shift> {
  return retarget(rows, change, (r) => r.resourceId === change.resourceId, (r) => r.assigneeEmail, (r, v) => stamped({ ...r, assigneeEmail: v }, change));
}

export function retargetStakeholderEmails(rows: readonly Stakeholder[], change: ResourceEmailChange): ArrayPropagation<Stakeholder> {
  const fits = change.to.length <= BUDGET_NAME_MAX;
  return retarget(rows, change, (r) => fits && r.resourceId === change.resourceId, (r) => r.email, (r, v) => stamped({ ...r, email: v }, change));
}

export function retargetContactPersonEmails(rows: readonly ContactPerson[], change: ResourceEmailChange): ContactPersonPropagation {
  const out = retarget(rows, change, (r) => r.resourceId === change.resourceId, (r) => r.email, (r, v) => ({ ...r, email: v }));
  return { next: out.next, edited: out.edited, changed: out.edited.length };
}

/** The undo of a contact-person retarget. `retarget` matches case- and
 *  space-insensitively, so a row may have held the old address spelled
 *  differently from `change.from` (" Old@X.com "). `ContactPerson` has no id
 *  (§537), so each linked row now holding `change.to` is paired, in order, with
 *  an unconsumed before-image of the SAME name and gets that row's own stored
 *  email back byte-for-byte. A row no before-image pairs with — one linked and
 *  given the new address after the correction — falls back to `change.from`. */
export function restoreContactPersonEmails(
  rows: readonly ContactPerson[],
  change: ResourceEmailChange,
  originals: readonly ContactPerson[],
): readonly ContactPerson[] {
  const reverse: ResourceEmailChange = { resourceId: change.resourceId, from: change.to, to: change.from };
  const consumed = new Set<number>();
  return retarget(rows, reverse, (r) => r.resourceId === change.resourceId, (r) => r.email, (r, fallback) => {
    const i = originals.findIndex((o, idx) => !consumed.has(idx) && o.name === r.name);
    if (i < 0) return { ...r, email: fallback };
    consumed.add(i);
    return { ...r, email: originals[i].email };
  }).next;
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
