// src/app/raid-escalation.ts
//
// Pure, DOM-free validation + cell codec for `RaidItem.escalations` (§515).
// Lives outside sanitize-records.ts because that file sits AT the size-ratchet
// LIMIT. The cell codec mirrors `encodeNoteLog` / `decodeNoteLog`: JSON in one
// cell, and "" when empty so legacy rows stay byte-identical.
// Also holds `requireEscalationRecipient`, the AI `escalate_raid_item` tool's
// boundary check, because it must share this sanitizer's recipient caps.
// ★ JSON and IndexedDB load RAID rows WITHOUT `sanitizeRaidItem`, so readers
//   must not trust the stored value — go through `lastEscalation` or
//   `sanitizeRaidEscalations`.
// ★ The Markdown `<br>` wipe this file used to guard against (see
//   `stripBreakTags` below) is now fixed at the ROOT in `mdEscape`/`mdUnescape`
//   (markdown-codecs-core.ts), which escapes a literal `<br…>` so it round-trips
//   verbatim instead of decoding into a real newline. `isEscalationEmail` and
//   `stripBreakTags` stay as defence in depth: an address or name holding
//   `<`/`>` has no legitimate use here, whatever the codec layer now tolerates.
// ★ `isEscalationEmail` is the LOAD predicate; writers use `isEscalationWriteEmail`.
import { isValidEmail, isWriteSafeEmail, normalizeEmailShape } from "./sanitize-core";
import { RAID_SEVERITIES, type RaidEscalation, type RaidItem, type RaidSeverity } from "./types";

/** Newest entries win when a hand-edited file carries more than this. */
export const RAID_ESCALATIONS_MAX = 100;
/** Caps shared with the AI `escalate_raid_item` boundary check (§515), so a
 *  recipient the tool accepts is one this sanitizer keeps verbatim. */
export const RAID_ESCALATION_NAME_MAX = 200;
export const RAID_ESCALATION_EMAIL_MAX = 320;
const NAME_MAX = RAID_ESCALATION_NAME_MAX;
const EMAIL_MAX = RAID_ESCALATION_EMAIL_MAX;
const AT_MAX = 40;
const SEVERITY_SET: ReadonlySet<string> = new Set(RAID_SEVERITIES);

/** A valid e-mail address (`isValidEmail`) that also carries no `<`/`>` (§515,
 *  defence in depth). Mirrors the `toName` bracket rejection just below —
 *  neither field has any legitimate use for either character, and rejecting
 *  them here means an escalation record never NEEDS the Markdown `<br>` fix
 *  in the first place. Do NOT change `isValidEmail` itself: it has many
 *  unrelated callers this stricter rule must not affect. */
export function isEscalationEmail(s: string): boolean {
  return isValidEmail(s) && !/[<>]/.test(s);
}

/** ★★ THE WRITE FORM of `isEscalationEmail`, and the split is the point.
 *  `isEscalationEmail` above stays the LOAD predicate (`sanitizeEntry`), so no
 *  stored escalation starts being dropped. Every WRITER — `requireEscalationRecipient`
 *  (AI `escalate_raid_item`), `escalate-popover.tsx` `canConfirm` and the
 *  escalate handler in `use-action-center-handlers.ts` — asks THIS, which also
 *  refuses "," and ";" (the one email write rule, `isWriteSafeEmail`). */
export function isEscalationWriteEmail(s: string): boolean {
  return isWriteSafeEmail(s) && !/[<>]/.test(s);
}

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
  if (!email || !isEscalationWriteEmail(email) || email.length > EMAIL_MAX) {
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
  // A name has no use for either bracket (defence in depth — see
  // `isEscalationEmail`'s docstring for why the Markdown round trip no longer
  // depends on this).
  if (/[<>]/.test(name)) {
    throw new Error('toName must not contain "<" or ">"');
  }
  return { email, name };
}

const BREAK_TAG = /\s*<br\b[^>]*>\s*/gi;

/** A recipient name with every `<br…>` tag replaced by one space, trimmed (§515).
 *  ★★ Originally written because `mdUnescape` turned a literal `<br>` inside a
 *   Markdown cell into a real newline, which landed inside this JSON-in-cell
 *   column's JSON string, threw `JSON.parse`, and lost the WHOLE escalation
 *   history — not just the one name. That root cause is now fixed in
 *   `mdEscape`/`mdUnescape` (markdown-codecs-core.ts): a literal `<br…>` is
 *   escaped and round-trips verbatim instead of decoding into a newline. This
 *   function is kept as defence in depth and for display hygiene — a `<br>` in
 *   a recipient name has no legitimate use either way. The human Escalate path
 *   (`buildEscalationEntry`) and this sanitizer both call it.
 *  ★ One pass is enough: the greedy `[^>]*` runs to the first `>`, and every
 *   join inserts a space, so no `<br>` can re-form across a replacement. */
export function stripBreakTags(name: string): string {
  return name.replace(BREAK_TAG, " ").trim();
}

function severityOrUndefined(v: unknown): RaidSeverity | undefined {
  return typeof v === "string" && SEVERITY_SET.has(v) ? (v as RaidSeverity) : undefined;
}

function sanitizeEntry(raw: unknown): RaidEscalation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const at = typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? o.at.slice(0, AT_MAX) : "";
  // Ruling Q5: Name <addr> is unwrapped BEFORE isEscalationEmail judges it.
  const toEmail = typeof o.toEmail === "string" ? normalizeEmailShape(o.toEmail.trim()).slice(0, EMAIL_MAX) : "";
  // isEscalationEmail, not a bare "@" check: rejects a malformed address AND
  // one holding "<"/">" (§515 defence in depth — mirrors the `toName` bracket
  // rejection in `requireEscalationRecipient` above). Deliberate: every writer
  // of an escalation record — the human Escalate handler and the AI tool,
  // both before and after this check existed — already requires a valid
  // e-mail address, so this can only drop a hand-edited or externally
  // imported entry that never came from this app (a malformed address such as
  // "ops@localhost", or a bracket address written by this branch's own
  // earlier, unreleased commits). It never drops a record this app produced.
  if (!at || !isEscalationEmail(toEmail)) return null;
  const toName = typeof o.toName === "string" ? stripBreakTags(o.toName).slice(0, NAME_MAX) : "";
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
