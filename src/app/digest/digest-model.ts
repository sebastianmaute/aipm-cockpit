// Pure, i18n-free projection of the already-computed DashboardModel into the
// structured facts the weekly status digest renders/emails. No Date/now — the
// caller passes `today` and `generatedAt`. The digest is a PROJECTION of the
// dashboard model, so it can never disagree with the Dashboard.
import type { DashboardModel } from "../dashboard";
import type { Health } from "../health";
import { isTerminalStatus } from "../raid";
import type { Milestone, RaidItem } from "../types";

/** Prior snapshot for "since last digest" deltas (from the per-device store). */
export interface DigestPrior {
  rag: Health;
  overdue: number;
  openRaid: number;
}

export interface DigestInput {
  model: DashboardModel;
  raid: readonly RaidItem[];
  prior: DigestPrior | null;
}

export interface DigestMilestoneFact {
  id: number;
  name: string;
  date: string;
}

export interface DigestModel {
  rag: Health;
  ragPrev: Health | null;
  overdue: { count: number; delta: number | null };
  milestonesDueSoon: DigestMilestoneFact[];
  openRaid: { count: number; high: number; delta: number | null };
  generatedAt: string;
  /** Optional AI narrative paragraph, prepended when AI is enabled. */
  narrative?: string;
}

const HIGH_SEVERITIES: ReadonlySet<RaidItem["severity"]> = new Set(["High", "Critical"]);

/** Build the digest facts. `today` is the effective-zone today (YYYY-MM-DD);
 *  `generatedAt` is a full ISO instant. Both passed in (purity). */
export function buildDigest(input: DigestInput, today: string, generatedAt: string): DigestModel {
  const { model, raid, prior } = input;
  const overdueCount = model.overdue.length;
  const openRaid = model.openRaidCount;
  // `high` must be a subset of `openRaid` (both open-only) — the card/email
  // render "{count} ({high} high)". Count High/Critical over NON-terminal items
  // only, matching how model.openRaidCount excludes closed RAID.
  const high = raid.filter(
    (r) => !isTerminalStatus(r.status, r.category) && HIGH_SEVERITIES.has(r.severity),
  ).length;
  // Overdue + due-soon milestones are the "coming up / already slipped" set.
  const milestonesDueSoon: DigestMilestoneFact[] = [
    ...model.overdueMilestones,
    ...model.dueSoonMilestones,
  ].map((m: Milestone) => ({ id: m.id, name: m.name, date: m.date }));
  return {
    rag: model.overall.effective,
    ragPrev: prior ? prior.rag : null,
    overdue: { count: overdueCount, delta: prior ? overdueCount - prior.overdue : null },
    milestonesDueSoon,
    openRaid: { count: openRaid, high, delta: prior ? openRaid - prior.openRaid : null },
    generatedAt,
  };
}
