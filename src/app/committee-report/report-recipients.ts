// src/app/committee-report/report-recipients.ts — pure, i18n-free resolver that
// maps a steering committee's member resource ids to their email addresses.
import type { Resource, SteeringCommittee } from "../types";

/**
 * Resolve the email addresses of a steering committee's members.
 *
 * Maps each `memberResourceIds` id to that resource's trimmed `email`, skipping
 * members with no email (or not present in the directory), de-duplicating
 * case-insensitively while preserving first-seen order.
 */
export function committeeMemberEmails(
  committee: SteeringCommittee,
  resources: readonly Resource[],
): string[] {
  const byId = new Map<number, Resource>();
  for (const r of resources) byId.set(r.id, r);

  const seen = new Set<string>();
  const emails: string[] = [];
  for (const id of committee.memberResourceIds) {
    const email = byId.get(id)?.email?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  return emails;
}
