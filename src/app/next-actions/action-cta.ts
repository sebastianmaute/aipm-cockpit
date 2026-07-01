// src/app/next-actions/action-cta.ts
//
// Pure, i18n-free decision layer over a SuggestedAction: which single verb is the
// row's primary call-to-action, and which secondaries fall into the ⋮ overflow.
// Shared by action-row.tsx (compact row) and action-hero-card.tsx (hero). Also the
// single home of the tier -> RAG-token class map so hero/row/panel stay in lockstep
// and all switch under the Mockup/Custom styles.
import type { SuggestedAction, ActionTier } from "./types";

export type PrimaryCtaKind =
  | "assign" | "clearBlocker" | "reschedule" | "rebaseline"
  | "escalate" | "draft" | "markDone" | "open";

export type SecondaryCtaKind = "markDone" | "clearBlocker" | "draft" | "createTask" | "snooze";

/** Which optional handler bundles/flags are wired in for this surface — presence
 *  === capability. Assembled from the props ActionRow/ActionHeroCard already hold. */
export interface ActionCaps {
  assign: boolean;        // assignOwner bundle present
  draft: boolean;         // onDraftMessage present
  escalate: boolean;      // escalate bundle present
  rebaseline: boolean;    // rebaseline bundle present
  snapshotActive: boolean;// rebaseline bundle present AND bundle.snapshotActive
  reschedule: boolean;    // reschedule bundle present
  markDone: boolean;      // onMarkDone present
  clearBlocker: boolean;  // onClearBlocker present
  snooze: boolean;        // onSnooze present
  createTask: boolean;    // onCreateTask present
}

const isOpen = (a: SuggestedAction): boolean => a.cta.kind === "open";
const onPoints = (a: SuggestedAction): boolean => a.cta.kind === "open" && a.cta.view === "open-points";

// Applicability predicates — copied verbatim from action-row.tsx's can* booleans so
// there is ONE definition. ActionRow now consumes these instead of re-deriving.
export function canAssign(a: SuggestedAction, c: ActionCaps): boolean {
  return c.assign && isOpen(a) &&
    ((a.source === "raid" && a.why.key === "actionRaidWhyNoOwner") ||
     (a.source === "task-attention" && a.why.key === "actionTaskWhyUnassigned"));
}
export function canClearBlocker(a: SuggestedAction, c: ActionCaps): boolean {
  return c.clearBlocker && onPoints(a) && a.source === "task-attention" && a.why.key === "actionTaskWhyBlocked";
}
export function canReschedule(a: SuggestedAction, c: ActionCaps): boolean {
  return c.reschedule && a.source === "task-due" && isOpen(a);
}
export function canRebaseline(a: SuggestedAction, c: ActionCaps): boolean {
  const milestone = c.rebaseline && a.source === "milestone" && isOpen(a) &&
    (a.why.key === "actionMilestoneWhyAtRisk" || a.why.key === "actionMilestoneWhyOverdue");
  const snapshot = c.rebaseline && c.snapshotActive && isOpen(a) &&
    ((a.source === "schedule" && a.why.key === "actionScheduleWhySlipping") ||
     (a.source === "budget" && a.why.key === "actionBudgetWhyWorsening"));
  return milestone || snapshot;
}
export function canEscalate(a: SuggestedAction, c: ActionCaps): boolean {
  return c.escalate && a.source === "raid" && a.why.key === "actionRaidWhySeverity" && isOpen(a);
}
export function canDraft(a: SuggestedAction, c: ActionCaps): boolean {
  return c.draft && (a.source === "task-due" || a.source === "stakeholder-comms") && isOpen(a);
}
export function canMarkDone(a: SuggestedAction, c: ActionCaps): boolean {
  return c.markDone && onPoints(a);
}
export function canCreateTask(a: SuggestedAction, c: ActionCaps): boolean {
  return c.createTask && a.source !== "task-due";
}

/** Highest-priority applicable verb; "open" is the always-available fallback. */
export function pickPrimaryCta(a: SuggestedAction, c: ActionCaps): PrimaryCtaKind {
  if (canAssign(a, c)) return "assign";
  if (canClearBlocker(a, c)) return "clearBlocker";
  if (canReschedule(a, c)) return "reschedule";
  if (canRebaseline(a, c)) return "rebaseline";
  if (canEscalate(a, c)) return "escalate";
  if (canDraft(a, c)) return "draft";
  if (canMarkDone(a, c)) return "markDone";
  return "open";
}

/** Menu-able secondaries (NOT the inline popover verbs), in menu order, minus the
 *  one promoted to primary. "snooze" signals the 1h/1d items; the component renders both. */
export function overflowCtas(a: SuggestedAction, c: ActionCaps): SecondaryCtaKind[] {
  const primary = pickPrimaryCta(a, c);
  const out: SecondaryCtaKind[] = [];
  if (canMarkDone(a, c) && primary !== "markDone") out.push("markDone");
  if (canClearBlocker(a, c) && primary !== "clearBlocker") out.push("clearBlocker");
  if (canDraft(a, c) && primary !== "draft") out.push("draft");
  if (canCreateTask(a, c)) out.push("createTask");
  if (c.snooze) out.push("snooze");
  return out;
}

// Tier -> RAG token classes. Concrete `var(--rag-NAME)` strings only — NEVER a single
// arbitrary-value bracket with a pipe/wildcard (Tailwind v4 scans all files; an invalid
// bracket char compiles to broken CSS and 500s globals.css).
export const TIER_RAG: Record<ActionTier, { stripe: string; dot: string; text: string }> = {
  now: { stripe: "border-l-[var(--rag-red)]", dot: "bg-[var(--rag-red)]", text: "text-[var(--rag-red-text)]" },
  soon: { stripe: "border-l-[var(--rag-amber)]", dot: "bg-[var(--rag-amber)]", text: "text-[var(--rag-amber-text)]" },
  monitor: { stripe: "border-l-[var(--rag-green)]", dot: "bg-[var(--rag-green)]", text: "text-[var(--rag-green-text)]" },
};
