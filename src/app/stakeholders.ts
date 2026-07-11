// Pure helpers for the Stakeholder register + RACI. No React, no DOM.
// Sibling to raid.ts / change-log.ts.
import { mintId } from "./id-mint-session";
import type {
  InfluenceInterest, Milestone, RaciRole, Stakeholder, StakeholderCategory,
} from "./types";
import { STAKEHOLDER_CATEGORIES } from "./types";

/** Next id — routes through the session-scoped minter (no id reuse per session). */
export function nextStakeholderId(items: readonly Stakeholder[]): number {
  return mintId("stakeholder", items);
}

export type StakeholderQuadrant =
  | "manage-closely" | "keep-satisfied" | "keep-informed" | "monitor";

const isHigh = (l: InfluenceInterest): boolean => l === "High";

/** 2x2 grid placement. Only "High" is the high bucket; Medium/Low fold to Low. */
export function quadrantFor(
  s: Pick<Stakeholder, "influence" | "interest">,
): StakeholderQuadrant {
  const inf = isHigh(s.influence);
  const intr = isHigh(s.interest);
  if (inf && intr) return "manage-closely";
  if (inf && !intr) return "keep-satisfied";
  if (!inf && intr) return "keep-informed";
  return "monitor";
}

/** Which axes a quadrant asserts as High: [highInfluence, highInterest]. */
export const QUADRANT_TARGET: Record<StakeholderQuadrant, readonly [boolean, boolean]> = {
  "manage-closely": [true, true],
  "keep-satisfied": [true, false],
  "keep-informed": [false, true],
  monitor: [false, false],
};

/** Preserve-Medium: raise to "High" on the high side; on the low side demote a
 *  "High" to "Medium" but leave existing Medium/Low untouched. */
function axisTarget(current: InfluenceInterest, wantHigh: boolean): InfluenceInterest {
  if (wantHigh) return "High";
  return current === "High" ? "Medium" : current;
}

/** Apply a quadrant drop to a stakeholder. Returns a new Stakeholder, or null
 *  when nothing changes (no-op drop) so callers skip a spurious save. */
export function applyQuadrantMove(
  s: Stakeholder,
  quadrant: StakeholderQuadrant,
): Stakeholder | null {
  const [hi, ht] = QUADRANT_TARGET[quadrant];
  const influence = axisTarget(s.influence, hi);
  const interest = axisTarget(s.interest, ht);
  if (influence === s.influence && interest === s.interest) return null;
  return { ...s, influence, interest };
}

export interface RaciCell { stakeholderId: number; role: RaciRole | null }
export interface RaciRow { milestone: Milestone; cells: RaciCell[] }

/** Pivot stakeholders x milestones. Orphan raci keys (deleted milestones) are
 *  ignored because we only iterate existing milestones. */
export function buildRaciMatrix(
  stakeholders: readonly Stakeholder[],
  milestones: readonly Milestone[],
): RaciRow[] {
  return milestones.map((m) => ({
    milestone: m,
    cells: stakeholders.map((s) => ({
      stakeholderId: s.id,
      role: s.raci[String(m.id)] ?? null,
    })),
  }));
}

export function accountableCountByMilestone(
  stakeholders: readonly Stakeholder[],
  milestoneId: number,
): number {
  const key = String(milestoneId);
  let n = 0;
  for (const s of stakeholders) if (s.raci[key] === "A") n += 1;
  return n;
}

export type RaciWarning = "none" | "missing" | "multiple";
export function raciWarningFor(accountableCount: number): RaciWarning {
  if (accountableCount === 0) return "missing";
  if (accountableCount > 1) return "multiple";
  return "none";
}

/** Immutable set/clear of one RACI cell on a stakeholder. */
export function setRaciRole(
  s: Stakeholder,
  milestoneId: number,
  role: RaciRole | null,
): Stakeholder {
  const key = String(milestoneId);
  const raci = { ...s.raci };
  if (role === null) delete raci[key];
  else raci[key] = role;
  return { ...s, raci };
}

export type StakeholderSortKey =
  | "name" | "organization" | "category" | "influence" | "interest";

const LEVEL_RANK: Record<InfluenceInterest, number> = { Low: 1, Medium: 2, High: 3 };

function sortValue(s: Stakeholder, key: StakeholderSortKey): string | number {
  switch (key) {
    case "name": return s.name.toLowerCase();
    case "organization": return (s.organization ?? "").toLowerCase();
    case "category": return (STAKEHOLDER_CATEGORIES as readonly StakeholderCategory[]).indexOf(s.category);
    case "influence": return LEVEL_RANK[s.influence];
    case "interest": return LEVEL_RANK[s.interest];
  }
}

export function compareStakeholder(
  a: Stakeholder, b: Stakeholder, key: StakeholderSortKey, dir: "asc" | "desc",
): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  const cmp = typeof av === "number" && typeof bv === "number"
    ? av - bv
    : String(av).localeCompare(String(bv));
  return dir === "asc" ? cmp : -cmp;
}
