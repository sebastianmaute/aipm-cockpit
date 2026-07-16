// src/app/raid-inquiry.ts
//
// Pure helpers for the RAID owner "Send inquiry" flow — mirrors the task
// status-inquiry (see use-task-row-handlers `onSendInquiry`). No React, no
// side effects: email resolution + mailto: URL building only. The React
// handler (window.location + functional setRaid bump) lives in
// use-resource-planner.
import { buildMailtoUrl } from "./mailto";
import { greetingName } from "./contacts";
import { t, type Lang } from "./i18n";
import { effectivePersonEmail } from "./resource-foundation";
import type { RaidItem, Resource } from "./types";

/** Resolve the outbound email for a RAID item's owner. The linked resource's
 *  LIVE email wins over the cached `ownerEmail` (which goes stale after a
 *  rename/re-link) — mirrors the task inquiry's `effectivePersonEmail` use.
 *  Returns "" (trimmed) when nothing usable is on file. */
export function resolveRaidOwnerEmail(
  item: Pick<RaidItem, "ownerEmail" | "ownerResourceId">,
  resourcesById: ReadonlyMap<number, Pick<Resource, "email">>,
): string {
  return effectivePersonEmail(item.ownerEmail ?? "", item.ownerResourceId, resourcesById).trim();
}

/** Build the `mailto:` URL for a RAID owner status inquiry, mirroring the task
 *  inquiry's subject/body shape (RAID fields: title, target date, raised). */
export function buildRaidInquiryMailto(item: RaidItem, email: string, lang: Lang): string {
  const greeting = greetingName(item.owner ?? "") || (item.owner ?? "");
  const subject = t(lang, "raidEmailSubject", item.id, item.title);
  const body = t(
    lang,
    "raidEmailBodyTemplate",
    greeting,
    item.id,
    item.title,
    item.targetDate ?? "—",
    item.raisedDate ?? "—",
  );
  return buildMailtoUrl(email, subject, body);
}
