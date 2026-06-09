// Pure stakeholder communication-reminder engine. No React, no DOM, no I/O.
// Maps each stakeholder to the items they should be nudged to communicate about,
// driven by their influence/interest quadrant policy and the items explicitly
// linked to them (milestones via RACI, RAID/changes via stakeholderIds).
//
// Sibling to stakeholders.ts / raid-review.ts / change-log.ts. The `reasonKey`
// values are i18n keys consumed by the notification surface (Task 14); this
// module only emits the string keys.
import { isPendingChange } from "./change-log";
import { quadrantFor, type StakeholderQuadrant } from "./stakeholders";
import type {
  ChangeItem, Milestone, RaidItem, RaidSeverity, RaidStatus, Stakeholder,
} from "./types";

export type CommsSource = "milestone" | "raid" | "change";

export interface StakeholderCommsReminder {
  stakeholderId: number;
  stakeholderName: string;
  quadrant: StakeholderQuadrant;
  itemKind: CommsSource;
  itemId: number;
  itemTitle: string;
  reasonKey: string;
  priority: number;
}

export interface CommsFlags {
  stakeholdersEnabled: boolean;
  milestonesEnabled: boolean;
  raidEnabled: boolean;
  changesEnabled: boolean;
}

interface CommsArgs {
  stakeholders: readonly Stakeholder[];
  milestones: readonly Milestone[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  today: string; // YYYY-MM-DD
  flags: CommsFlags;
  leadDaysByQuadrant?: Record<StakeholderQuadrant, number>;
}

// Severity ranking — mirrors the real RaidSeverity union in types.ts.
const SEVERITY_RANK: Record<RaidSeverity, number> = {
  Low: 1, Medium: 2, High: 3, Critical: 4,
};

// Flat terminal-status set. raid-review.ts keeps an identical private `TERMINAL`
// const (it is not exported), so this is a deliberate DRY duplicate — keep the
// two in sync. We treat any of these as "resolved, do not nudge" regardless of
// category (unlike raid.ts's category-aware isTerminalStatus).
const RAID_TERMINAL: ReadonlySet<RaidStatus> = new Set<RaidStatus>([
  "Closed", "Resolved", "Delivered", "Validated", "Invalidated",
]);

interface QuadrantPolicy {
  leadDays: number;
  sources: readonly CommsSource[];
  minRaidSeverity?: RaidSeverity;
  milestonesOverdueOnly?: boolean;
  priority: number;
}

const POLICY: Record<StakeholderQuadrant, QuadrantPolicy> = {
  "manage-closely": {
    leadDays: 14,
    sources: ["milestone", "raid", "change"],
    minRaidSeverity: "Medium",
    priority: 4,
  },
  "keep-satisfied": {
    leadDays: 7,
    sources: ["milestone", "raid", "change"],
    minRaidSeverity: "High",
    priority: 3,
  },
  "keep-informed": {
    leadDays: 7,
    sources: ["milestone", "change"],
    priority: 2,
  },
  monitor: {
    leadDays: 3,
    sources: ["milestone"],
    milestonesOverdueOnly: true,
    priority: 1,
  },
};

/** Whole-day difference (a - b) for two YYYY-MM-DD dates; negative if a < b. */
function dayDiff(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round((da - db) / 86_400_000);
}

function hasSource(policy: QuadrantPolicy, source: CommsSource): boolean {
  return policy.sources.includes(source);
}

function milestoneReminders(
  s: Stakeholder,
  quadrant: StakeholderQuadrant,
  policy: QuadrantPolicy,
  milestones: readonly Milestone[],
  today: string,
): StakeholderCommsReminder[] {
  const out: StakeholderCommsReminder[] = [];
  for (const m of milestones) {
    if (!s.raci[String(m.id)]) continue;
    if (m.achievedDate) continue;
    const overdue = m.date < today;
    const upcoming = !overdue && dayDiff(m.date, today) <= policy.leadDays;
    if (policy.milestonesOverdueOnly) {
      if (!overdue) continue;
    } else if (!overdue && !upcoming) {
      continue;
    }
    out.push({
      stakeholderId: s.id,
      stakeholderName: s.name,
      quadrant,
      itemKind: "milestone",
      itemId: m.id,
      itemTitle: m.name,
      reasonKey: overdue ? "stakeholderCommsMilestoneOverdue" : "stakeholderCommsMilestoneDue",
      priority: policy.priority,
    });
  }
  return out;
}

function raidReminders(
  s: Stakeholder,
  quadrant: StakeholderQuadrant,
  policy: QuadrantPolicy,
  raid: readonly RaidItem[],
  today: string,
): StakeholderCommsReminder[] {
  const out: StakeholderCommsReminder[] = [];
  const minRank = policy.minRaidSeverity ? SEVERITY_RANK[policy.minRaidSeverity] : Infinity;
  for (const r of raid) {
    if (!(r.stakeholderIds ?? []).includes(s.id)) continue;
    if (RAID_TERMINAL.has(r.status)) continue;
    const sevRank = r.severity ? SEVERITY_RANK[r.severity] : 0;
    const overdue = !!r.targetDate && r.targetDate < today;
    if (sevRank < minRank && !overdue) continue;
    out.push({
      stakeholderId: s.id,
      stakeholderName: s.name,
      quadrant,
      itemKind: "raid",
      itemId: r.id,
      itemTitle: r.title,
      reasonKey: overdue ? "stakeholderCommsRaidOverdue" : "stakeholderCommsRaidSevere",
      priority: policy.priority,
    });
  }
  return out;
}

function changeReminders(
  s: Stakeholder,
  quadrant: StakeholderQuadrant,
  policy: QuadrantPolicy,
  changes: readonly ChangeItem[],
): StakeholderCommsReminder[] {
  const out: StakeholderCommsReminder[] = [];
  for (const c of changes) {
    if (!(c.stakeholderIds ?? []).includes(s.id)) continue;
    if (!isPendingChange(c.status)) continue;
    out.push({
      stakeholderId: s.id,
      stakeholderName: s.name,
      quadrant,
      itemKind: "change",
      itemId: c.id,
      itemTitle: c.title,
      reasonKey: "stakeholderCommsChangePending",
      priority: policy.priority,
    });
  }
  return out;
}

export function getStakeholderCommsItems(args: CommsArgs): StakeholderCommsReminder[] {
  const { stakeholders, milestones, raid, changes, today, flags, leadDaysByQuadrant } = args;
  if (!flags.stakeholdersEnabled || stakeholders.length === 0) return [];

  const out: StakeholderCommsReminder[] = [];
  for (const s of stakeholders) {
    const quadrant = quadrantFor(s);
    const basePolicy = POLICY[quadrant];
    const policy: QuadrantPolicy = leadDaysByQuadrant
      ? { ...basePolicy, leadDays: leadDaysByQuadrant[quadrant] ?? basePolicy.leadDays }
      : basePolicy;

    if (flags.milestonesEnabled && hasSource(policy, "milestone")) {
      out.push(...milestoneReminders(s, quadrant, policy, milestones, today));
    }
    if (flags.raidEnabled && hasSource(policy, "raid")) {
      out.push(...raidReminders(s, quadrant, policy, raid, today));
    }
    if (flags.changesEnabled && hasSource(policy, "change")) {
      out.push(...changeReminders(s, quadrant, policy, changes));
    }
  }

  return out.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.stakeholderName.localeCompare(b.stakeholderName);
  });
}
