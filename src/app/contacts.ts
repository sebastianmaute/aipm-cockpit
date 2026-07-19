// Persisted "address book" of previously-used (assignee name → email) pairs.
//
// Lives in localStorage at CONTACTS_KEY independent of the tasks list, so:
//   • Suggestions survive task deletion / Clear all / Jira sync churn.
//   • A user can explicitly remove a remembered contact from the dropdown
//     (× on a suggestion) without it reappearing the next time they edit a
//     task whose assignee happens to match.
//
// Keying is by normalized name (case-folded + trimmed) so trivial casing
// variations don't pollute the store. The display name is preserved as the
// value's `name` field.

import type { Task } from "./types";
import { readDeviceJson, writeDeviceJson } from "./device-store";
import {
  isPlainObject,
  isValidEmail,
  sanitizeAssignee,
  sanitizeEmail,
} from "./sanitize";

/**
 * First-name-style greeting for an assignee. Returns "" when blank; falls
 * back to the email local-part (capitalized) for email-style assignees;
 * otherwise returns the first whitespace-delimited token (typical
 * "Firstname Lastname" -> "Firstname").
 */
export function greetingName(assignee: string): string {
  const trimmed = assignee.trim();
  if (!trimmed) return "";
  if (isValidEmail(trimmed)) {
    const local = trimmed.split("@")[0];
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return trimmed.split(/\s+/)[0];
}

const CONTACTS_KEY = "aipm-cockpit:contacts";
const CONTACTS_MAX = 500;

export type Contact = {
  /** Display form (preserved casing / whitespace as last entered). */
  name: string;
  /** May be empty when the user has only ever entered the name. */
  email: string;
};

/** Internal representation: keyed by normalized name → Contact. */
export type ContactsMap = Record<string, Contact>;

function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

export function loadContacts(): ContactsMap {
  const parsed = readDeviceJson<unknown>(CONTACTS_KEY, null);
  if (!isPlainObject(parsed)) return {};
  const out: ContactsMap = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof k !== "string") continue;
    if (!isPlainObject(v)) continue;
    const name = sanitizeAssignee(v.name);
    const email = sanitizeEmail(v.email);
    if (!name) continue;
    out[normalizeKey(name)] = { name, email };
  }
  return out;
}

export function saveContacts(c: ContactsMap): void {
  writeDeviceJson(CONTACTS_KEY, c);
}

/**
 * Insert or update a contact. Returns a new object (immutable update) so
 * callers can pass it directly into `setState`.
 *
 * Rules:
 *   • Empty name → no-op (nothing useful to remember).
 *   • If a contact for this name already exists and the new email is empty,
 *     keep the existing email (don't blank out a known address).
 *   • Otherwise overwrite both name (preserves new casing) and email.
 *   • Caps at CONTACTS_MAX entries (oldest insertion order is preserved
 *     because objects iterate in insertion order; we'd need a stricter
 *     LRU policy if churn outpaces the cap — not the case for a personal
 *     task manager).
 */
export function upsertContact(
  c: ContactsMap,
  rawName: string,
  rawEmail: string,
): ContactsMap {
  const name = sanitizeAssignee(rawName);
  const email = sanitizeEmail(rawEmail);
  if (!name) return c;
  const key = normalizeKey(name);
  const existing = c[key];
  const next: Contact = {
    name,
    email: email || existing?.email || "",
  };
  if (existing && existing.name === next.name && existing.email === next.email) {
    return c; // No-op: avoid pointless re-render / save.
  }
  const out: ContactsMap = { ...c, [key]: next };
  // Soft cap: if we blew past the limit, drop the first-inserted entry.
  const keys = Object.keys(out);
  if (keys.length > CONTACTS_MAX) {
    delete out[keys[0]];
  }
  return out;
}

export function removeContact(c: ContactsMap, name: string): ContactsMap {
  const key = normalizeKey(name);
  if (!(key in c)) return c;
  const out = { ...c };
  delete out[key];
  return out;
}

/**
 * Seed the contacts map from the tasks list. Used on first hydration when
 * the user has been creating tasks before this feature existed — every
 * (assignee, email) pair already on disk gets pre-populated so the user
 * doesn't have to retype them on the next new task.
 */
export function seedContactsFromTasks(
  current: ContactsMap,
  tasks: readonly Task[],
): ContactsMap {
  let next = current;
  for (const t of tasks) {
    if (!t.assignee) continue;
    next = upsertContact(next, t.assignee, t.assigneeEmail ?? "");
  }
  return next;
}

/** Sort + return as an array suitable for dropdown rendering. */
export function listContacts(c: ContactsMap): Contact[] {
  return Object.values(c).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
