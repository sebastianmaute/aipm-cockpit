// src/app/action-escalate.ts
// Pure escalation logic for the Action Center "Escalate" CTA. No React, no DOM.
// Severity raise applies only to Issue/Assumption/Dependency; Risk severity is
// matrix-derived (prob×impact) so Risks are notify-only, as are already-Critical
// items. `buildEscalationMail` (added in a later task) will be the only i18n-aware export.
import { RAID_SEVERITIES, type RaidItem, type RaidSeverity } from "./types";

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
