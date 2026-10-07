// src/app/person-reassign.ts: what an AI write that names a DIFFERENT person
// also has to change, so the reassignment is real (§375).
//
// Pure, React-free and i18n-free. ONE function is used by BOTH the writers
// (`use-chat-dispatcher.ts` `updateTask`, `use-register-tools.ts` `updateRaid`
// and `updateAbsence`) and the review-card preview (`inline-ai-edit/plan.ts`),
// so the card cannot show one email and the write store another.
//
// ★★★ WHY THE EMAIL HAS TO MOVE WITH THE NAME. A reassignment normally names
//  the new person and nothing else (`update_task` tells the model only the
//  fields it names are changed), so the row kept the OLD person's address.
//  That address then decided everything downstream: the strict link resolver
//  matched it to the old person (the reassignment stayed invisible, or the row
//  was unlinked instead of linked), inquiry drafts and escalations went to the
//  old person (`effectivePersonEmail` falls back to the stored address), and
//  the load-time backfill (`backfillResourceFks`) re-linked a RAID owner or an
//  absence to the old person on the next reload. Measured on the demo
//  workspace, where every task and RAID owner carries its person's address.
//
// ★★ The new address is the directory person's the new name matches (the
//  STRICT name match `linkPersonForWrite` makes), or blank when it matches
//  nobody or several people. Blank is the honest value: the app knows no
//  address for that person, and the UI pickers write name, email and link
//  together for the same reason.
//
// ★ A write that names the person unchanged, or names an email of its own,
//  derives nothing: the model's own value wins, and an untouched person keeps
//  everything it had.
import { linkPersonForWrite } from "./resource-foundation";
import { isWriteSafeEmail } from "./sanitize-core";
import type { Resource } from "./types";

/** The entities whose rows name a person, and the input keys that name them. */
export const PERSON_FIELDS = {
  task: { name: "assignee", email: "assigneeEmail" },
  raid: { name: "owner", email: "ownerEmail" },
  absence: { name: "assignee", email: "assigneeEmail" },
} as const;

export type PersonEntity = keyof typeof PERSON_FIELDS;

export function isPersonEntity(entity: string): entity is PersonEntity {
  return Object.prototype.hasOwnProperty.call(PERSON_FIELDS, entity);
}

/** True when `input` names a person other than the one `stored` names. Only a
 *  STRING name counts: a non-string is refused or blanked further down, and
 *  deriving from it would preview a change the write does not make. */
export function namesNewPerson(
  entity: PersonEntity,
  input: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>,
): boolean {
  const { name } = PERSON_FIELDS[entity];
  const next = input[name];
  return typeof next === "string" && next.trim() !== String(stored[name] ?? "").trim();
}

/** The address a reassignment to `name` stores: the one directory person the
 *  name matches, or blank.
 *
 *  ★★ Only an address `isWriteSafeEmail` accepts is derived. Directory
 *   addresses are loaded WITHOUT a format check, and the email write guards
 *   refuse a CHANGED address that fails it, so deriving `noah@localhost` made
 *   an approved reassignment throw on a task or an absence, and on a RAID item
 *   store the address the card had listed as rejected (measured by cold
 *   review). Blank is never refused, so a derived value cannot do either. */
export function reassignEmail(name: string, resources: readonly Resource[]): string {
  const id = linkPersonForWrite({ assignee: name }, resources);
  const email = id === null ? "" : (resources.find((r) => r.id === id)?.email ?? "").trim();
  return isWriteSafeEmail(email) ? email : "";
}

/**
 * `input` with the fields a reassignment implies filled in, when it names a new
 * person and leaves them out: the email for every person entity, and for an
 * absence also `resourceId`, which `update_absence` advertises to the model and
 * the card discloses as a link (for a task or RAID owner the link is not a
 * model field, and the writer derives it from the name and this email).
 * Returns `input` itself when nothing is derived.
 */
export function withReassignFields<T extends Readonly<Record<string, unknown>>>(
  entity: PersonEntity,
  input: T,
  stored: Readonly<Record<string, unknown>>,
  resources: readonly Resource[],
): T {
  if (!namesNewPerson(entity, input, stored)) return input;
  const { name, email } = PERSON_FIELDS[entity];
  const nextName = input[name] as string;
  let out: Record<string, unknown> = input;
  if (input[email] === undefined) out = { ...out, [email]: reassignEmail(nextName, resources) };
  if (entity === "absence" && input.resourceId === undefined) {
    out = { ...out, resourceId: linkPersonForWrite({ assignee: nextName, assigneeEmail: out[email] as string }, resources) };
  }
  return out as T;
}
