// src/app/action-escalate.ts
// Pure escalation logic for the Action Center "Escalate" CTA. No React, no DOM.
// Severity raise applies only to Issue/Assumption/Dependency; Risk severity is
// matrix-derived (prob×impact) so Risks are notify-only, as are already-Critical
// items.
import { RAID_SEVERITIES, type RaidEscalation, type RaidItem, type RaidSeverity, type Resource } from "./types";
import { t, type Lang } from "./i18n";
import { addNote } from "./note-log";
import { plainToHtml } from "./sanitize-html";
import { severityLabel } from "./raid-labels";
import { resourceDisplayName } from "./resource-foundation";
import { stripBreakTags } from "./raid-escalation";

export type EscalationPlan = {
  raisesSeverity: boolean;
  from?: RaidSeverity;
  to?: RaidSeverity;
  reason?: "risk" | "max";
};

/** Next severity level up, or null when already at the top (Critical). */
export function nextSeverity(s: RaidSeverity): RaidSeverity | null {
  const i = RAID_SEVERITIES.indexOf(s);
  return i >= 0 && i < RAID_SEVERITIES.length - 1 ? RAID_SEVERITIES[i + 1] : null;
}

/** Decide what escalating an item does: raise severity (I/A/D, not yet Critical)
 *  or notify-only (Risk = matrix-owned; or already Critical / no severity). */
export function planEscalation(item: RaidItem): EscalationPlan {
  if (item.category === "R") return { raisesSeverity: false, reason: "risk" };
  const from = item.severity;
  const to = from ? nextSeverity(from) : null;
  if (!from || !to) return { raisesSeverity: false, reason: "max" };
  return { raisesSeverity: true, from, to };
}

/** Immutable: set `severity` on the RAID item with `id`. Returns the SAME array
 *  reference (no write) when no item matches `id`. */
export function applyEscalation(
  raid: readonly RaidItem[],
  id: number,
  to: RaidSeverity,
): readonly RaidItem[] {
  if (!raid.some((r) => r.id === id)) return raid;
  return raid.map((r) => (r.id === id ? { ...r, severity: to } : r));
}

/** Pure (uses `t`): the escalation email subject + plain-text body. The
 *  severity-raised sentence is included only when the plan raises severity. */
export function buildEscalationMail(
  lang: Lang,
  item: RaidItem,
  plan: EscalationPlan,
  projectName: string,
): { subject: string; body: string } {
  const subject = t(lang, "escalateMailSubject", item.id, item.title);
  const lines = [t(lang, "escalateMailIntro", item.id, item.title)];
  if (plan.raisesSeverity && plan.from && plan.to) {
    lines.push(t(lang, "escalateMailSeverityRaised", plan.from, plan.to));
  }
  lines.push(t(lang, "escalateMailProject", projectName));
  lines.push(t(lang, "escalateMailClosing"));
  return { subject, body: lines.join("\n\n") };
}

/** The person an escalation mails — the Escalate popover's ResourcePicker value. */
export type EscalationRecipient = { name: string; email: string; resourceId: number | null };

/** Who the note-log echo is attributed to (see `addNote`). */
export type EscalationNoteAuthor = { self: number | null | undefined; authorName?: string };

/** Pure: the structured record of one escalation. The severity step is kept
 *  only when the plan actually raises it; absent = notify-only. */
export function buildEscalationEntry(
  plan: EscalationPlan,
  recipient: EscalationRecipient,
  at: string,
): RaidEscalation {
  // `stripBreakTags` also cleans the note echo, which `describeEscalation` builds from this entry.
  const name = stripBreakTags(recipient.name);
  return {
    at,
    ...(name ? { toName: name } : {}),
    toEmail: recipient.email,
    ...(recipient.resourceId != null ? { toResourceId: recipient.resourceId } : {}),
    ...(plan.raisesSeverity && plan.from && plan.to ? { fromSeverity: plan.from, toSeverity: plan.to } : {}),
  };
}

/** Pure (uses `t`): one-line human text for an escalation — the note-log echo
 *  and the edit modal's Escalations list use the same sentence. */
export function describeEscalation(lang: Lang, e: RaidEscalation): string {
  const who = e.toName ? `${e.toName} <${e.toEmail}>` : e.toEmail;
  return e.fromSeverity && e.toSeverity
    ? t(lang, "raidEscalationNoteRaised", who, severityLabel(e.fromSeverity, lang), severityLabel(e.toSeverity, lang))
    : t(lang, "raidEscalationNoteNotifyOnly", who);
}

/** Immutable: the next RAID item after an escalation — severity raised when the
 *  plan says so, the record appended, a note appended to the running log, and
 *  `localModifiedAt` stamped. `noteText` is translated ONCE by the caller. */
export function buildEscalationRecord(
  item: RaidItem,
  plan: EscalationPlan,
  recipient: EscalationRecipient,
  at: string,
  noteText: string,
  author: EscalationNoteAuthor,
): RaidItem {
  const prior = Array.isArray(item.escalations) ? item.escalations : [];
  return {
    ...item,
    ...(plan.raisesSeverity && plan.to ? { severity: plan.to } : {}),
    escalations: [...prior, buildEscalationEntry(plan, recipient, at)],
    noteLog: addNote(item.noteLog ?? [], {
      html: plainToHtml(noteText),
      text: noteText,
      timestamp: at,
      self: author.self,
      authorName: author.authorName,
    }),
    localModifiedAt: at,
  };
}

/** The `raid.escalated` activity arguments after the id: the severity step, or
 *  the current severity (or "—") on BOTH sides for a notify-only escalation.
 *  Shared by the Escalate CTA and the AI `escalate_raid_item` tool so the two
 *  log identically (§515). Never carries the recipient. */
export function escalationActivityArgs(
  item: Pick<RaidItem, "severity">,
  plan: EscalationPlan,
): [string, string] {
  return [plan.from ?? item.severity ?? "—", plan.to ?? item.severity ?? "—"];
}

/** The note author for an escalation the AI assistant records (§515, user
 *  decision 2026-09-13): the literal label "AI created", translated ONCE at
 *  write time like the note text itself, and NO `self` — attributing it to
 *  `settings.selfResourceId` would credit the user with a line they did not
 *  write. `authorLabel` shows `authorName` first, so no render-time marker is
 *  needed; the activity row's `ai` actor records who acted. */
export function aiEscalationNoteAuthor(lang: Lang): EscalationNoteAuthor {
  return { self: null, authorName: t(lang, "raidNoteAuthorAi") };
}

/** The recipient of an AI escalation chosen by e-mail. Links the ONE directory
 *  resource whose primary or additional address matches (case-insensitive);
 *  zero or several matches link nobody. A model-chosen name wins, else the
 *  linked resource's display name fills it.
 *  ★★ E-mail, never a resource id: a staged plan can remap id ARRAYS only
 *  (`LINK_FIELDS`), so a scalar id minted earlier in the same turn would be
 *  stored dangling — or against a live stranger with the same number. */
export function resolveEscalationRecipient(
  email: string,
  name: string,
  resources: readonly Pick<Resource, "id" | "firstName" | "lastName" | "email" | "emails">[],
): EscalationRecipient {
  const wanted = email.trim().toLowerCase();
  const matches = resources.filter((r) =>
    [r.email, ...(r.emails ?? [])].some((e) => typeof e === "string" && e.trim().toLowerCase() === wanted),
  );
  const linked = matches.length === 1 ? matches[0] : undefined;
  const chosen = name.trim();
  return {
    name: chosen || (linked ? resourceDisplayName(linked) : ""),
    email: email.trim(),
    resourceId: linked ? linked.id : null,
  };
}
