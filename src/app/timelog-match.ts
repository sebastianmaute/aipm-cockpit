// src/app/timelog-match.ts — pure, i18n-free matching. Manual links always win.
import type { Resource, BudgetBucket } from "./types";
import type { TimelogUser, TimelogLinks, TimelogUserLink, TimelogProjectLink } from "./timelog-types";

const norm = (s: string): string => s.trim().toLowerCase();

/** A Timelog user worth showing in the matching UI: active AND identifiable.
 *  The org directory (`/v1/user`) includes inactive/system rows with empty
 *  name + email — those render as blank lines and can't be matched to anything,
 *  so drop them from the People table. */
export function isDisplayableUser(u: TimelogUser): boolean {
  if (!u.isActive) return false;
  return !!(u.firstName.trim() || u.lastName.trim() || u.email.trim());
}

export function displayableUsers(users: readonly TimelogUser[]): TimelogUser[] {
  return users.filter(isDisplayableUser);
}

/** §699 section 10 — v2 `EmployeeInitials` → TimeLog user id over the WHOLE
 *  directory, inactive users included: a person deactivated after a month was
 *  closed must not read as having deleted every booking (their rows would
 *  otherwise become the `userId: 0` sentinel, which the roll drops).
 *  ★★ On an initials clash a displayable (active) user wins, so every row that
 *  resolved before still resolves to the same person; among equals the later
 *  directory entry wins, as before. */
export function initialsToUserId(users: readonly TimelogUser[]): Map<string, number> {
  const hidden = users.filter((u) => !isDisplayableUser(u));
  const shown = users.filter(isDisplayableUser);
  return new Map(
    [...hidden, ...shown].filter((u) => u.initials.trim()).map((u) => [u.initials.trim().toLowerCase(), u.userId] as const),
  );
}

/** Whether a person can be matched to a Timelog user at all: a non-blank primary OR additional
 *  email, since `matchByEmail` reads both. The one rule behind the resource form's required email
 *  and the directory's "no email" marker (§708). */
export function hasMatchableEmail(r: Pick<Resource, "email" | "emails">): boolean {
  return [r.email, ...(r.emails ?? [])].some((e) => (e ?? "").trim() !== "");
}

/** The resource a Timelog email belongs to: a PRIMARY-email match beats an
 *  extra-email (`Resource.emails`) match, and each pass is case-insensitive and
 *  trimmed (§708). Two passes rather than one scan, so the answer never depends
 *  on array order. A blank email matches nothing — blank entries in either list
 *  are skipped, never compared. */
function matchByEmail(email: string, resources: readonly Resource[]): Resource | undefined {
  const wanted = norm(email);
  if (!wanted) return undefined;
  return (
    resources.find((r) => r.email !== undefined && norm(r.email) === wanted) ??
    resources.find((r) => (r.emails ?? []).some((e) => norm(e) === wanted))
  );
}

export function autoMatchUsers(
  tlUsers: readonly TimelogUser[],
  resources: readonly Resource[],
  existing: TimelogLinks,
): TimelogUserLink[] {
  const manual = existing.userLinks.filter((l) => l.manual);
  const pinned = new Set(manual.map((l) => l.timelogUserId));
  const out: TimelogUserLink[] = [...manual];
  for (const u of tlUsers) {
    if (pinned.has(u.userId)) continue;
    let match = matchByEmail(u.email, resources);
    if (!match && u.initials) {
      const ini = norm(u.initials);
      if (ini) match = resources.find((r) => norm(`${r.firstName[0] ?? ""}${r.lastName[0] ?? ""}`) === ini);
    }
    if (!match) {
      const userName = norm(`${u.firstName} ${u.lastName}`);
      if (userName) match = resources.find((r) => norm(`${r.firstName} ${r.lastName}`) === userName);
    }
    if (match) out.push({ timelogUserId: u.userId, resourceId: match.id, manual: false });
  }
  return out;
}

/** Resolve a free-text customer NAME (e.g. ProjectMeta.customer) to a TimeLog
 *  customer by case-folded exact name match. Returns the unique hit, or null on
 *  no match / blank name / an ambiguous >1 match (never guess). Generic so it
 *  stays decoupled from the api-layer TimelogCustomer type (no import cycle). */
export function resolveCustomerByName<T extends { id: number; name: string }>(
  customers: readonly T[],
  name: string | undefined,
): T | null {
  const q = norm(name ?? "");
  if (!q) return null;
  const hits = customers.filter((c) => norm(c.name) === q);
  return hits.length === 1 ? hits[0] : null;
}

export type TimelogProjectRef = { id: number; name: string; no: string };

/** A TimeLog project as a row label: its name, then its project number when it has one. Names repeat across customers; the number tells them apart (§316). The " · " separator keeps a bare-digit number from reading like a row token's "(2)". */
export function timelogProjectLabel(p: TimelogProjectRef): string {
  return p.no ? `${p.name} · ${p.no}` : p.name;
}

export function autoMatchProjects(
  tlProjects: readonly TimelogProjectRef[],
  buckets: readonly BudgetBucket[],
  existing: TimelogLinks,
): TimelogProjectLink[] {
  const manual = existing.projectLinks.filter((l) => l.manual);
  const pinned = new Set(manual.map((l) => l.timelogProjectId));
  const out: TimelogProjectLink[] = [...manual];
  for (const p of tlProjects) {
    if (pinned.has(p.id)) continue;
    const pName = norm(p.name);
    let match = pName ? buckets.find((b) => norm(b.name) === pName) : undefined;
    if (!match && p.no) match = buckets.find((b) => b.poNumber && norm(b.poNumber) === norm(p.no));
    if (match) out.push({ timelogProjectId: p.id, bucketId: match.id, manual: false });
  }
  return out;
}
