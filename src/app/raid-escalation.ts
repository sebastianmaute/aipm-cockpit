// src/app/raid-escalation.ts
//
// Pure, DOM-free validation + cell codec for `RaidItem.escalations` (§515).
// Lives outside sanitize-records.ts because that file sits AT the size-ratchet
// LIMIT. The cell codec mirrors `encodeNoteLog` / `decodeNoteLog`: JSON in one
// cell, and "" when empty so legacy rows stay byte-identical.
// ★ JSON and IndexedDB load RAID rows WITHOUT `sanitizeRaidItem`, so readers
//   must not trust the stored value — go through `lastEscalation` or
//   `sanitizeRaidEscalations`.
import { isValidEmail } from "./sanitize-core";
import { RAID_SEVERITIES, type RaidEscalation, type RaidItem, type RaidSeverity } from "./types";

/** Newest entries win when a hand-edited file carries more than this. */
export const RAID_ESCALATIONS_MAX = 100;
/** Caps shared with the AI `escalate_raid_item` boundary check (§515), so a
 *  recipient the tool accepts is one this sanitizer keeps verbatim. */
export const RAID_ESCALATION_NAME_MAX = 200;
export const RAID_ESCALATION_EMAIL_MAX = 320;
const NAME_MAX = RAID_ESCALATION_NAME_MAX;
const EMAIL_MAX = RAID_ESCALATION_EMAIL_MAX;

/** The recipient of an `escalate_raid_item` call, validated at the TOOL
 *  BOUNDARY (§515). Throws a model-facing message for any value the escalation
 *  record could not store verbatim. It returns ONLY these two fields, which is
 *  what keeps the tool append-only: no other model key (a raw `escalations`,
 *  a `severity`, a `toResourceId`) can reach the writer.
 *  ★ Unlocalized on purpose, like every other `throw` in `runTool`.
 *  ★★ Deliberately NOT in `chat-tools-updates.ts`: `tool-input-coverage.test.ts`
 *   scans that file's every `input.<name>` read against `update_task`'s schema,
 *   so `toEmail`/`toName` there would be misreported as update_task inputs. */
export function requireEscalationRecipient(input: Record<string, unknown>): { email: string; name: string } {
  const email = typeof input.toEmail === "string" ? input.toEmail.trim() : "";
  if (!email || !isValidEmail(email) || email.length > EMAIL_MAX) {
    throw new Error(`toEmail must be a valid email address of at most ${EMAIL_MAX} characters`);
  }
  const rawName = input.toName;
  if (rawName !== undefined && rawName !== null && typeof rawName !== "string") {
    throw new Error("toName must be a string when given");
  }
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name.length > NAME_MAX) {
    throw new Error(`toName must be at most ${NAME_MAX} characters`);
  }
  return { email, name };
}
const AT_MAX = 40;
const SEVERITY_SET: ReadonlySet<string> = new Set(RAID_SEVERITIES);

function severityOrUndefined(v: unknown): RaidSeverity | undefined {
  return typeof v === "string" && SEVERITY_SET.has(v) ? (v as RaidSeverity) : undefined;
}

function sanitizeEntry(raw: unknown): RaidEscalation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const at = typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? o.at.slice(0, AT_MAX) : "";
  const toEmail = typeof o.toEmail === "string" ? o.toEmail.trim().slice(0, EMAIL_MAX) : "";
  if (!at || !toEmail.includes("@")) return null;
  const toName = typeof o.toName === "string" ? o.toName.trim().slice(0, NAME_MAX) : "";
  const toResourceId =
    typeof o.toResourceId === "number" && Number.isInteger(o.toResourceId) && o.toResourceId > 0
      ? o.toResourceId
      : undefined;
  const fromSeverity = severityOrUndefined(o.fromSeverity);
  const toSeverity = severityOrUndefined(o.toSeverity);
  return {
    at,
    ...(toName ? { toName } : {}),
    toEmail,
    ...(toResourceId !== undefined ? { toResourceId } : {}),
    // A severity STEP needs both ends; a lone half is dropped rather than
    // rendered as a raise from or to nothing.
    ...(fromSeverity && toSeverity ? { fromSeverity, toSeverity } : {}),
  };
}

export function sanitizeRaidEscalations(raw: unknown): RaidEscalation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeEntry)
    .filter((e): e is RaidEscalation => e !== null)
    .slice(-RAID_ESCALATIONS_MAX);
}

export function encodeRaidEscalations(list: readonly RaidEscalation[] | undefined): string {
  return list && list.length ? JSON.stringify(list) : "";
}

export function decodeRaidEscalations(cell: string | null | undefined): RaidEscalation[] {
  if (!cell) return [];
  try {
    return sanitizeRaidEscalations(JSON.parse(cell));
  } catch {
    return [];
  }
}

/** The newest escalation, re-validated, or undefined. */
export function lastEscalation(item: Pick<RaidItem, "escalations">): RaidEscalation | undefined {
  const list: unknown = item.escalations;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return sanitizeRaidEscalations([list[list.length - 1]])[0];
}
