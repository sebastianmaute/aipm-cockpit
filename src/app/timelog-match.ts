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
    let match: Resource | undefined;
    if (u.email) match = resources.find((r) => r.email && norm(r.email) === norm(u.email));
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
